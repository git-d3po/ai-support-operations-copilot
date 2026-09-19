import { afterEach, describe, expect, it } from "vitest";
import { runOrchestration } from "@/lib/orchestrator/orchestrator";
import { _resetProvidersForTests, registerProvider } from "@/lib/ai/providers/registry";
import { createTaskMockProvider } from "./testSupport/taskMockProvider";
import { makeAccountContext } from "./testSupport/fixtures";

afterEach(() => {
  _resetProvidersForTests();
});

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
  it("runs classification -> selection -> agents -> resolution -> response end to end", async () => {
    registerProvider("anthropic", createTaskMockProvider(DUPLICATE_BILLING_RESPONSES));

    const outcome = await runOrchestration({
      ticketId: "test-ticket",
      ticketSummary: "Charged twice this billing cycle",
      conversation: [{ author: "customer", body: "I was charged twice for $399." }],
      accountContext: makeAccountContext(),
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
      accountContext: makeAccountContext(),
    });

    expect(outcome.response?.body).toBe("ok");
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
