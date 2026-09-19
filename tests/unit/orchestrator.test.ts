import { afterEach, describe, expect, it } from "vitest";
import { runOrchestration } from "@/lib/orchestrator/orchestrator";
import { _resetProvidersForTests, registerProvider } from "@/lib/ai/providers/registry";
import { createTaskMockProvider } from "./testSupport/taskMockProvider";
import { makeAccountContext } from "./testSupport/fixtures";

afterEach(() => {
  _resetProvidersForTests();
});

// The Policy agent's citation is only trusted if the cited slug was
// actually retrieved for that call (see policyAgent.ts's grounding
// enforcement, AUDIT.md Audit #3) — these tests' account context must
// include the policy they expect the mock to "cite."
const DUPLICATE_CHARGE_POLICY = {
  slug: "duplicate-charge-policy",
  title: "Duplicate Charge Policy",
  category: "billing",
  body: "Two identical charges on the same invoice within 48 hours are refunded in full.",
};

const DUPLICATE_BILLING_RESPONSES = {
  ticket_classification: JSON.stringify({
    intent: "duplicate_charge",
    domains: ["billing", "policy"],
    sentiment: "frustrated",
    confidence: 0.9,
    summary: "Customer reports a duplicate charge.",
    keyEvidence: ["charged twice"],
  }),
  billing_agent_finding: JSON.stringify({
    agentKey: "billing",
    summary: "Confirmed duplicate charge.",
    evidence: ["two $399 charges, same invoice, 10h apart"],
    confidence: 0.95,
    policyReferences: [],
    flags: ["duplicate_charge_confirmed"],
  }),
  policy_agent_finding: JSON.stringify({
    agentKey: "policy",
    summary: "Duplicate charge policy applies; refund approved.",
    evidence: [],
    confidence: 0.95,
    policyReferences: [{ slug: "duplicate-charge-policy", title: "Duplicate Charge Policy" }],
    flags: [],
    policyDecision: {
      applicablePolicy: { slug: "duplicate-charge-policy", title: "Duplicate Charge Policy" },
      decision: "approve",
      justification: "Confirmed duplicate per policy.",
      conditionsMet: ["same amount", "within 48 hours"],
      conditionsUnmet: [],
    },
  }),
  response_agent_reply: JSON.stringify({
    body: "We confirmed the duplicate charge and have refunded it in full.",
    tone: "empathetic",
    nextSteps: [],
  }),
};

describe("runOrchestration (real pipeline, MockProvider)", () => {
  // Regression for the first live smoke test: the real classifier returned
  // domains ["billing"] (no "policy") for a duplicate charge. The pipeline
  // must still run Policy and reach refund_customer — routing can't depend
  // on the classifier volunteering "policy" for this intent.
  it("duplicate charge still reaches Policy and refund_customer when the classifier flags only billing", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        ...DUPLICATE_BILLING_RESPONSES,
        ticket_classification: JSON.stringify({
          intent: "duplicate_charge",
          domains: ["billing"],
          sentiment: "neutral",
          confidence: 0.98,
          summary: "Customer was charged twice and requests a refund.",
          keyEvidence: ["charged $399.00 twice"],
        }),
      }),
    );

    const outcome = await runOrchestration({
      ticketId: "test-ticket",
      ticketSummary: "Charged twice this billing cycle",
      conversation: [{ author: "customer", body: "I was charged twice for $399." }],
      accountContext: makeAccountContext({ policies: [DUPLICATE_CHARGE_POLICY] }),
    });

    expect(outcome.agentsInvoked).toEqual(["billing", "policy", "response"]);
    expect(outcome.resolution.action).toBe("refund_customer");
  });

  it("runs classification -> selection -> agents -> resolution -> response end to end", async () => {
    registerProvider("anthropic", createTaskMockProvider(DUPLICATE_BILLING_RESPONSES));

    const outcome = await runOrchestration({
      ticketId: "test-ticket",
      ticketSummary: "Charged twice this billing cycle",
      conversation: [{ author: "customer", body: "I was charged twice for $399." }],
      accountContext: makeAccountContext({ policies: [DUPLICATE_CHARGE_POLICY] }),
    });

    expect(outcome.classification.intent).toBe("duplicate_charge");
    expect(outcome.classificationFailed).toBe(false);
    expect(outcome.agentsInvoked).toEqual(["billing", "policy", "response"]);
    expect(outcome.agentResults.map((r) => r.finding.agentKey)).toEqual(["billing", "policy", "response"]);
    expect(outcome.resolution.action).toBe("refund_customer");
    expect(outcome.escalation).toBeNull();
    expect(outcome.response?.body).toContain("refunded");
  });

  it("gives the Response agent the resolution decision, not just raw findings", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        ...DUPLICATE_BILLING_RESPONSES,
        response_agent_reply: (request) => {
          // The resolution/escalation must already be in the prompt by the
          // time the Response agent is called — proves response runs after
          // resolveOutcome(), not as a parallel/uniform pipeline step.
          const userMessage = request.messages.at(-1)?.content ?? "";
          if (!userMessage.includes("action=refund_customer")) {
            throw new Error("Response agent did not receive the resolution decision");
          }
          return JSON.stringify({ body: "ok", tone: "neutral", nextSteps: [] });
        },
      }),
    );

    const outcome = await runOrchestration({
      ticketId: "test-ticket",
      ticketSummary: "Charged twice this billing cycle",
      conversation: [],
      accountContext: makeAccountContext({ policies: [DUPLICATE_CHARGE_POLICY] }),
    });

    expect(outcome.response?.body).toBe("ok");
  });

  // Regression for the first live evaluation of the corrected password-reset
  // scenario: the real classifier returned domains [] for a plain
  // forgotten-password ticket, so Technical never ran and the run resolved as
  // reply_and_monitor ("no specialist ran") instead of auto_resolve.
  it("password reset still reaches Technical and auto_resolve when the classifier returns no domains", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        ticket_classification: JSON.stringify({
          intent: "password_reset",
          domains: [],
          sentiment: "neutral",
          confidence: 0.99,
          summary: "Customer forgot their password.",
          keyEvidence: ["Forgot my password"],
        }),
        technical_agent_finding: JSON.stringify({
          agentKey: "technical",
          summary: "Routine password reset; the standard self-service flow applies.",
          evidence: ["Customer reports only a forgotten password"],
          confidence: 0.9,
          policyReferences: [],
          flags: ["auto_resolvable"],
        }),
        response_agent_reply: JSON.stringify({ body: "You can reset it from the sign-in page.", tone: "neutral", nextSteps: [] }),
      }),
    );

    const outcome = await runOrchestration({
      ticketId: "test-ticket",
      ticketSummary: "Forgot my password — can't log in",
      conversation: [{ author: "customer", body: "I forgot my password and can't log in. Can you help me reset it?" }],
      accountContext: makeAccountContext(),
    });

    expect(outcome.agentsInvoked).toEqual(["technical", "response"]);
    expect(outcome.resolution.action).toBe("auto_resolve");
    expect(outcome.escalation).toBeNull();
  });

  // A technical ticket must still reach Technical (and therefore its escalation
  // rule) when the classifier returns no domains; otherwise resolution falls
  // through to the "no specialist ran" default, reply_and_monitor.
  it("technical issue still reaches Technical and escalates when the classifier returns no domains", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        ticket_classification: JSON.stringify({
          intent: "technical_issue",
          domains: [],
          sentiment: "neutral",
          confidence: 0.95,
          summary: "Automations still not firing after the documented workaround.",
          keyEvidence: ["automations are still not firing"],
        }),
        technical_agent_finding: JSON.stringify({
          agentKey: "technical",
          summary: "Known issue; the documented workaround was already tried and failed.",
          evidence: ["Customer split the board as documented; automations still not firing"],
          confidence: 0.85,
          policyReferences: [],
          flags: ["known_issue_workaround_already_tried", "requires_escalation"],
        }),
        response_agent_reply: JSON.stringify({ body: "We're escalating this to the right team.", tone: "neutral", nextSteps: [] }),
      }),
    );

    const outcome = await runOrchestration({
      ticketId: "test-ticket",
      ticketSummary: "Automations still broken after splitting the board",
      conversation: [{ author: "customer", body: "We split the board as described but automations still are not firing." }],
      accountContext: makeAccountContext(),
    });

    expect(outcome.agentsInvoked).toEqual(["technical", "response"]);
    expect(outcome.resolution.action).toBe("escalate");
    expect(outcome.escalation?.targetTeam).toBe("engineering");
  });

  // The Account Security Policy requires suspected compromise to always escalate
  // to Trust & Safety. That must not depend on the Risk agent's judgment: here
  // Risk (mock) declines to recommend escalation, yet the run must still escalate.
  it("account_security still escalates to Trust & Safety when Risk does not recommend escalation", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        ticket_classification: JSON.stringify({
          intent: "account_security",
          domains: [],
          sentiment: "neutral",
          confidence: 0.93,
          summary: "Customer reports an API key they did not create.",
          keyEvidence: ["API key none of us created"],
        }),
        risk_agent_finding: JSON.stringify({
          agentKey: "risk",
          summary: "No further risk indicators beyond the report itself.",
          evidence: ["Account risk score is low"],
          confidence: 0.9,
          policyReferences: [],
          flags: [],
          escalationRecommended: false,
          escalationReason: null,
          targetTeam: null,
          severity: null,
        }),
        response_agent_reply: JSON.stringify({ body: "We're escalating this to the right team.", tone: "neutral", nextSteps: [] }),
      }),
    );

    const outcome = await runOrchestration({
      ticketId: "test-ticket",
      ticketSummary: "Unrecognized API key on our account",
      conversation: [{ author: "customer", body: "There's an API key in our settings none of us created." }],
      accountContext: makeAccountContext(),
    });

    expect(outcome.agentsInvoked).toEqual(["risk", "response"]);
    expect(outcome.resolution.action).toBe("escalate");
    expect(outcome.resolution.requiresHumanReview).toBe(true);
    expect(outcome.escalation?.targetTeam).toBe("trust_and_safety");
    expect(outcome.escalation?.reason).toContain("account-security-policy");
  });

  it("never invokes every agent for a narrow ticket (dynamic selection still holds with real classification)", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        ticket_classification: JSON.stringify({
          intent: "password_reset",
          domains: ["technical"],
          sentiment: "neutral",
          confidence: 0.9,
          summary: "Password reset request.",
          keyEvidence: [],
        }),
        technical_agent_finding: JSON.stringify({
          agentKey: "technical",
          summary: "Standard reset flow applies.",
          evidence: [],
          confidence: 0.9,
          policyReferences: [],
          flags: ["auto_resolvable"],
        }),
        response_agent_reply: JSON.stringify({ body: "Reset link sent.", tone: "neutral", nextSteps: [] }),
      }),
    );

    const outcome = await runOrchestration({
      ticketId: "test-ticket",
      ticketSummary: "Can't log in",
      conversation: [],
      accountContext: makeAccountContext(),
    });

    expect(outcome.agentsInvoked).toEqual(["technical", "response"]);
    expect(outcome.agentsInvoked).not.toContain("billing");
    expect(outcome.agentsInvoked).not.toContain("risk");
    expect(outcome.resolution.action).toBe("auto_resolve");
  });

  it("still drafts an (escalation-appropriate) response when classification fails", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        ticket_classification: "not json",
        response_agent_reply: JSON.stringify({
          body: "Thanks for reaching out — we're taking a closer look and will follow up shortly.",
          tone: "empathetic",
          nextSteps: [],
        }),
      }),
    );

    const outcome = await runOrchestration({
      ticketId: "test-ticket",
      ticketSummary: "x",
      conversation: [],
      accountContext: makeAccountContext(),
    });

    expect(outcome.classificationFailed).toBe(true);
    expect(outcome.resolution.action).toBe("escalate");
    expect(outcome.escalation?.required).toBe(true);
  });
});
