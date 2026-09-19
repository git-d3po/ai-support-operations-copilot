import { describe, expect, it } from "vitest";
import {
  AgentFindingSchema,
  CustomerResponseSchema,
  EscalationDecisionSchema,
  EvaluationExpectedOutcomeSchema,
  PolicyDecisionSchema,
  ResolutionDecisionSchema,
  TicketClassificationSchema,
} from "@/lib/ai/schemas";
import { SCENARIOS } from "../../prisma/data/scenarios";

describe("TicketClassificationSchema", () => {
  it("accepts a well-formed classification", () => {
    const result = TicketClassificationSchema.safeParse({
      intent: "refund_request",
      domains: ["billing", "policy"],
      sentiment: "neutral",
      confidence: 0.87,
      summary: "Customer requests a refund for an accidental upgrade.",
      keyEvidence: ["Charge occurred 5 days ago", "No logins since the charge"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty domains array (ambiguous tickets touch no specialist domain)", () => {
    const result = TicketClassificationSchema.safeParse({
      intent: "general_inquiry",
      domains: [],
      sentiment: "neutral",
      confidence: 0.4,
      summary: "Vague follow-up with no clear topic.",
      keyEvidence: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown intent", () => {
    const result = TicketClassificationSchema.safeParse({
      intent: "not_a_real_intent",
      domains: [],
      sentiment: "neutral",
      confidence: 0.4,
      summary: "x",
      keyEvidence: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence outside [0, 1]", () => {
    const result = TicketClassificationSchema.safeParse({
      intent: "general_inquiry",
      domains: [],
      sentiment: "neutral",
      confidence: 1.4,
      summary: "x",
      keyEvidence: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects 'response' as a domain (response is not a specialist investigation domain)", () => {
    const result = TicketClassificationSchema.safeParse({
      intent: "general_inquiry",
      domains: ["response"],
      sentiment: "neutral",
      confidence: 0.5,
      summary: "x",
      keyEvidence: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("AgentFindingSchema", () => {
  it("defaults policyReferences and flags to empty arrays", () => {
    const result = AgentFindingSchema.parse({
      agentKey: "billing",
      summary: "No issues found.",
      evidence: [],
      confidence: 0.6,
    });
    expect(result.policyReferences).toEqual([]);
    expect(result.flags).toEqual([]);
  });
});

describe("EscalationDecisionSchema", () => {
  it("requires `required` to be literally true", () => {
    const result = EscalationDecisionSchema.safeParse({
      required: false,
      reason: "x",
      targetTeam: "engineering",
      severity: "low",
    });
    expect(result.success).toBe(false);
  });
});

describe("PolicyDecisionSchema and CustomerResponseSchema and ResolutionDecisionSchema", () => {
  it("accept minimal valid payloads", () => {
    expect(
      PolicyDecisionSchema.safeParse({
        applicablePolicy: { slug: "refund-policy", title: "Refund Policy" },
        decision: "approve",
        justification: "Within the refund window.",
      }).success,
    ).toBe(true);

    expect(
      CustomerResponseSchema.safeParse({
        body: "Thanks for reaching out — here's what's happening...",
        tone: "empathetic",
      }).success,
    ).toBe(true);

    expect(
      ResolutionDecisionSchema.safeParse({
        action: "refund_customer",
        summary: "Confirmed duplicate charge, refunding in full.",
        confidence: 0.95,
        requiresHumanReview: false,
      }).success,
    ).toBe(true);
  });
});

describe("EvaluationExpectedOutcomeSchema", () => {
  it("validates every curated scenario's expected outcome", () => {
    for (const scenario of SCENARIOS) {
      const result = EvaluationExpectedOutcomeSchema.safeParse(scenario.expectedOutcome);
      expect(result.success, `scenario ${scenario.key} should have a valid expected outcome`).toBe(true);
    }
  });
});
