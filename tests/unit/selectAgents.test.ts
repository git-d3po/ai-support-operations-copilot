import { describe, expect, it } from "vitest";
import { selectAgents } from "@/lib/orchestrator/selectAgents";
import type { TicketClassification } from "@/lib/ai/schemas";
import { SCENARIOS } from "../../prisma/data/scenarios";

/**
 * Each case below is a hand-constructed TicketClassification representing
 * what a correct classifier would plausibly produce for the corresponding
 * curated scenario in prisma/data/scenarios.ts — asserting that dynamic
 * agent selection reaches the same `expectedAgents` the evaluation suite
 * scores against. This is what "the orchestrator dynamically selects
 * agents, not invoke-all" means as a testable property, not just prose.
 */
function classification(overrides: Partial<TicketClassification>): TicketClassification {
  return {
    intent: "general_inquiry",
    domains: [],
    sentiment: "neutral",
    confidence: 0.9,
    summary: "test",
    keyEvidence: [],
    ...overrides,
  };
}

describe("selectAgents", () => {
  it("password reset: only technical + response", () => {
    const result = selectAgents(
      classification({ intent: "password_reset", domains: ["technical"] }),
    );
    expect(result).toEqual(
      SCENARIOS.find((s) => s.key === "password-reset")!.expectedOutcome.expectedAgents,
    );
  });

  it("duplicate charge: billing + policy + response, when classifier flags both domains", () => {
    const result = selectAgents(
      classification({ intent: "duplicate_charge", domains: ["billing", "policy"] }),
    );
    expect(result).toEqual(
      SCENARIOS.find((s) => s.key === "duplicate-billing")!.expectedOutcome.expectedAgents,
    );
  });

  it("refund request always pulls in policy, even if the classifier only flagged billing", () => {
    const result = selectAgents(classification({ intent: "refund_request", domains: ["billing"] }));
    expect(result).toEqual(["billing", "policy", "response"]);
  });

  it("failed payment: billing + response only", () => {
    const result = selectAgents(classification({ intent: "failed_payment", domains: ["billing"] }));
    expect(result).toEqual(
      SCENARIOS.find((s) => s.key === "failed-payment")!.expectedOutcome.expectedAgents,
    );
  });

  it("known technical issue: technical + response only, no risk/billing invoked", () => {
    const result = selectAgents(classification({ intent: "technical_issue", domains: ["technical"] }));
    expect(result).toEqual(
      SCENARIOS.find((s) => s.key === "known-technical-issue")!.expectedOutcome.expectedAgents,
    );
    expect(result).not.toContain("risk");
    expect(result).not.toContain("billing");
  });

  it("technical issue with urgent sentiment pulls in risk even though the classifier only flagged technical", () => {
    const result = selectAgents(
      classification({ intent: "technical_issue", domains: ["technical"], sentiment: "urgent" }),
    );
    expect(result).toEqual(
      SCENARIOS.find((s) => s.key === "technical-escalation")!.expectedOutcome.expectedAgents,
    );
  });

  it("account security always pulls in risk", () => {
    const result = selectAgents(classification({ intent: "account_security", domains: [] }));
    expect(result).toEqual(
      SCENARIOS.find((s) => s.key === "suspicious-activity")!.expectedOutcome.expectedAgents,
    );
  });

  it("ambiguous / general inquiry with no domains: response only", () => {
    const result = selectAgents(classification({ intent: "general_inquiry", domains: [] }));
    expect(result).toEqual(
      SCENARIOS.find((s) => s.key === "ambiguous-request")!.expectedOutcome.expectedAgents,
    );
  });

  it("multi-domain ticket invokes every relevant specialist, and nothing else", () => {
    const result = selectAgents(
      classification({
        intent: "billing_question",
        domains: ["billing", "policy", "technical"],
      }),
    );
    expect(result).toEqual(
      SCENARIOS.find((s) => s.key === "multi-domain")!.expectedOutcome.expectedAgents,
    );
    expect(result).not.toContain("risk");
  });

  it("cancellation always pulls in both risk and policy", () => {
    const result = selectAgents(classification({ intent: "cancellation", domains: [] }));
    expect(result).toEqual(["policy", "risk", "response"]);
  });

  it("never invokes every agent for a narrow single-domain ticket", () => {
    const result = selectAgents(classification({ intent: "password_reset", domains: ["technical"] }));
    expect(result.length).toBeLessThan(5);
  });

  it("output order is always billing, policy, technical, risk, response", () => {
    const result = selectAgents(
      classification({ intent: "billing_question", domains: ["technical", "billing", "policy"] }),
    );
    expect(result).toEqual(["billing", "policy", "technical", "response"]);
  });
});
