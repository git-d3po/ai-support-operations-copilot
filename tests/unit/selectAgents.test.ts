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

  // Regression: the first live smoke test (duplicate-billing) had the real
  // classifier return domains ["billing"] only. Routing must not depend on
  // the classifier also listing "policy" for this intent.
  it("duplicate charge routes to billing + policy even when the classifier flags only billing", () => {
    const result = selectAgents(classification({ intent: "duplicate_charge", domains: ["billing"] }));
    expect(result).toEqual(["billing", "policy", "response"]);
  });

  it("duplicate charge routes to billing + policy even when the classifier flags no domains", () => {
    const result = selectAgents(classification({ intent: "duplicate_charge", domains: [] }));
    expect(result).toEqual(["billing", "policy", "response"]);
  });

  it("duplicate charge does not add risk or technical on its own", () => {
    const result = selectAgents(classification({ intent: "duplicate_charge", domains: ["billing"] }));
    expect(result).not.toContain("risk");
    expect(result).not.toContain("technical");
  });

  it("failed payment does NOT pull in policy (no policy decision is needed to monitor a retry)", () => {
    const result = selectAgents(classification({ intent: "failed_payment", domains: [] }));
    expect(result).not.toContain("policy");
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

// Regression for the first live evaluation of the corrected password-reset
// scenario: the real classifier returned intent "password_reset" with
// domains [] (the prompt allows an empty list), so Technical never ran and
// resolution fell through to reply_and_monitor. The existing password-reset
// tests above all supplied domains ["technical"], which is why it went
// unnoticed. Technical coverage for this intent must not depend on the model.
describe("selectAgents: deterministic Technical coverage for password_reset", () => {
  it("includes technical, then response, even when the classifier returns no domains", () => {
    const result = selectAgents(classification({ intent: "password_reset", domains: [] }));
    expect(result).toEqual(["technical", "response"]);
    expect(result).toEqual(
      SCENARIOS.find((s) => s.key === "password-reset")!.expectedOutcome.expectedAgents,
    );
  });

  it("does not duplicate technical when the classifier also lists it", () => {
    const result = selectAgents(classification({ intent: "password_reset", domains: ["technical"] }));
    expect(result).toEqual(["technical", "response"]);
    expect(result.filter((key) => key === "technical")).toHaveLength(1);
  });

  it("does not add policy, billing, or risk to a routine password reset", () => {
    const result = selectAgents(classification({ intent: "password_reset", domains: [] }));
    for (const key of ["policy", "billing", "risk"] as const) {
      expect(result).not.toContain(key);
    }
  });

  it("keeps the stable order and still honors extra classifier domains and the sentiment override", () => {
    expect(selectAgents(classification({ intent: "password_reset", domains: ["billing"] }))).toEqual([
      "billing",
      "technical",
      "response",
    ]);
    expect(selectAgents(classification({ intent: "password_reset", domains: ["risk"] }))).toEqual([
      "technical",
      "risk",
      "response",
    ]);
    expect(
      selectAgents(classification({ intent: "password_reset", domains: [], sentiment: "urgent" })),
    ).toEqual(["technical", "risk", "response"]);
  });

  it("always ends with response", () => {
    expect(selectAgents(classification({ intent: "password_reset", domains: [] })).at(-1)).toBe("response");
  });

  // The existing critical routing contracts, restated at the same inputs the
  // rest of this file already uses, so this change can't quietly disturb them.
  it.each([
    ["duplicate_charge", ["billing"], ["billing", "policy", "response"]],
    ["refund_request", ["billing"], ["billing", "policy", "response"]],
    ["cancellation", [], ["policy", "risk", "response"]],
    ["failed_payment", ["billing"], ["billing", "response"]],
  ] as const)("%s routing is unchanged", (intent, domains, expected) => {
    expect(selectAgents(classification({ intent, domains: [...domains] }))).toEqual([...expected]);
  });

  it("does not leak technical into other intents that carry no technical domain", () => {
    // technical_issue is deliberately not asserted here: like password_reset it
    // still depends on the classifier's domains (an open item, see DECISIONS.md).
    const intents = [
      "duplicate_charge",
      "refund_request",
      "failed_payment",
      "billing_question",
      "account_security",
      "cancellation",
      "feature_question",
      "general_inquiry",
    ] as const;
    for (const intent of intents) {
      expect(selectAgents(classification({ intent, domains: [] }))).not.toContain("technical");
    }
  });
});
