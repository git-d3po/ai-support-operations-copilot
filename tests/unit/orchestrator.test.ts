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

/**
 * Orchestrator-level regression for the failed-payment live finding (DECISIONS.md,
 * "failed_payment is Billing-owned at resolution"): the classifier added a
 * `technical` domain to a failed-payment ticket, so BOTH Billing and Technical
 * ran, and Technical's `auto_resolvable` used to override Billing's
 * payment-failed flag. These drive the whole pipeline (classification ->
 * selection -> agents -> resolution -> response) with both agents really
 * running, which no earlier test did. Routing is asserted unchanged: Technical
 * still runs; only which finding governs the outcome differs.
 */
describe("runOrchestration: failed_payment with both Billing and Technical running", () => {
  const BILLING_SUMMARY = "Payment failed (insufficient funds); customer says the card was updated.";

  const responses = (technical: { summary: string; flags: string[] }, replyCheck?: (userMessage: string) => void) => ({
    ticket_classification: JSON.stringify({
      intent: "failed_payment",
      domains: ["billing", "technical"],
      sentiment: "neutral",
      confidence: 0.95,
      summary: "Payment failed; customer has already updated their card.",
      keyEvidence: ["payment failed", "updated my card on file"],
    }),
    billing_agent_finding: JSON.stringify({
      agentKey: "billing",
      summary: BILLING_SUMMARY,
      evidence: ["Most recent failed charge: insufficient_funds"],
      confidence: 0.95,
      policyReferences: [],
      flags: ["payment_failed_awaiting_customer_action"],
    }),
    technical_agent_finding: JSON.stringify({
      agentKey: "technical",
      summary: technical.summary,
      evidence: ["Invoices & Billing FAQ: failed charges are retried on days 1, 3 and 7"],
      confidence: 0.9,
      policyReferences: [],
      flags: technical.flags,
    }),
    response_agent_reply: (request: { messages: { content: string }[] }) => {
      replyCheck?.(request.messages.at(-1)?.content ?? "");
      return JSON.stringify({ body: "Thanks for updating your card.", tone: "neutral", nextSteps: [] });
    },
  });

  const run = () =>
    runOrchestration({
      ticketId: "test-ticket",
      ticketSummary: "Payment failed — updated my card, please retry",
      conversation: [{ author: "customer", body: "My payment failed. I've already updated my card on file — do I need to do anything else?" }],
      accountContext: makeAccountContext(),
    });

  it("Technical auto_resolvable no longer overrides Billing: reply_and_monitor, with both agents run", async () => {
    let responseSawAction = "";
    registerProvider(
      "anthropic",
      createTaskMockProvider(
        responses(
          { summary: "Standard retry flow: failed charges are retried on days 1, 3 and 7.", flags: ["auto_resolvable"] },
          (userMessage) => {
            responseSawAction = userMessage;
          },
        ),
      ),
    );

    const outcome = await run();

    // Routing is unchanged: the classifier's technical domain still runs Technical.
    expect(outcome.agentsInvoked).toEqual(["billing", "technical", "response"]);
    expect(outcome.agentResults.map((r) => r.finding.agentKey)).toEqual(["billing", "technical", "response"]);
    // Both findings were produced and are the ones under test.
    const technical = outcome.agentResults.find((r) => r.finding.agentKey === "technical")!.finding;
    expect(technical.flags).toContain("auto_resolvable");
    // Billing owns the outcome.
    expect(outcome.resolution.action).toBe("reply_and_monitor");
    expect(outcome.resolution.summary).toBe(BILLING_SUMMARY);
    expect(outcome.resolution.requiresHumanReview).toBe(false);
    expect(outcome.escalation).toBeNull();
    // The Response agent drafted from the Billing-owned resolution, not auto_resolve.
    expect(responseSawAction).toContain("action=reply_and_monitor");
  });

  it("Technical requires_escalation still escalates to engineering, with both agents run", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider(
        responses({
          summary: "Documented defect blocks payment updates; the workaround was already tried.",
          flags: ["known_issue_workaround_already_tried", "requires_escalation"],
        }),
      ),
    );

    const outcome = await run();

    expect(outcome.agentsInvoked).toEqual(["billing", "technical", "response"]);
    expect(outcome.resolution.action).toBe("escalate");
    expect(outcome.resolution.requiresHumanReview).toBe(true);
    expect(outcome.escalation?.targetTeam).toBe("engineering");
  });

  it("gives the same outcome as a classifier that returned only billing (Technical not run)", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        ...responses({ summary: "unused", flags: [] }),
        ticket_classification: JSON.stringify({
          intent: "failed_payment",
          domains: ["billing"],
          sentiment: "neutral",
          confidence: 0.95,
          summary: "Payment failed; customer has already updated their card.",
          keyEvidence: ["payment failed"],
        }),
      }),
    );

    const outcome = await run();

    expect(outcome.agentsInvoked).toEqual(["billing", "response"]);
    expect(outcome.resolution.action).toBe("reply_and_monitor");
    expect(outcome.resolution.summary).toBe(BILLING_SUMMARY);
    expect(outcome.escalation).toBeNull();
  });

  /**
   * The two fixes together (DECISIONS.md, "Billing and Technical do not parse
   * policy citations" and "failed_payment: a degraded Billing finding escalates").
   * A live run saw Billing's finding degrade because of a malformed citation
   * alone; on this ticket that would have let Technical's auto_resolvable decide.
   */
  function billingAnswerCounting(billing: Record<string, unknown>) {
    let calls = 0;
    const answers = {
      ...responses({ summary: "Standard retry flow: failed charges are retried on days 1, 3 and 7.", flags: ["auto_resolvable"] }),
      billing_agent_finding: () => {
        calls++;
        return JSON.stringify(billing);
      },
    };
    return { answers, calls: () => calls };
  }

  it("a malformed Billing citation no longer degrades Billing, so its payment-failed finding still decides", async () => {
    const billing = billingAnswerCounting({
      agentKey: "billing",
      summary: BILLING_SUMMARY,
      evidence: ["Most recent failed charge: insufficient_funds"],
      confidence: 0.95,
      policyReferences: [{ policy: "none" }],
      flags: ["payment_failed_awaiting_customer_action"],
    });
    registerProvider("anthropic", createTaskMockProvider(billing.answers));

    const outcome = await run();

    expect(outcome.agentsInvoked).toEqual(["billing", "technical", "response"]);
    const billingFinding = outcome.agentResults.find((r) => r.finding.agentKey === "billing")!.finding;
    expect(billingFinding.flags).toEqual(["payment_failed_awaiting_customer_action"]);
    expect(billingFinding.policyReferences).toEqual([]);
    expect(billing.calls()).toBe(1);
    expect(outcome.agentResults.find((r) => r.finding.agentKey === "technical")!.finding.flags).toContain("auto_resolvable");
    // Billing owns the outcome (rule 6b); Technical's auto_resolvable does not override it.
    expect(outcome.resolution.action).toBe("reply_and_monitor");
    expect(outcome.resolution.summary).toBe(BILLING_SUMMARY);
    expect(outcome.escalation).toBeNull();
  });

  it("a Billing finding that genuinely degrades escalates for human review instead of letting Technical auto-resolve", async () => {
    const billing = billingAnswerCounting({
      agentKey: "billing",
      summary: BILLING_SUMMARY,
      evidence: ["Most recent failed charge: insufficient_funds"],
      confidence: 7, // a substantive field out of range: a real schema failure, on both attempts
      flags: ["payment_failed_awaiting_customer_action"],
    });
    registerProvider("anthropic", createTaskMockProvider(billing.answers));

    const outcome = await run();

    expect(outcome.agentsInvoked).toEqual(["billing", "technical", "response"]);
    expect(outcome.agentResults.find((r) => r.finding.agentKey === "billing")!.finding.flags).toEqual(["agent_failed"]);
    expect(billing.calls()).toBe(2);
    expect(outcome.agentResults.find((r) => r.finding.agentKey === "technical")!.finding.flags).toContain("auto_resolvable");
    expect(outcome.resolution.action).toBe("escalate");
    expect(outcome.resolution.requiresHumanReview).toBe(true);
    expect(outcome.escalation?.targetTeam).toBe("senior_support");
  });
});
