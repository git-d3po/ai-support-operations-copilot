import { describe, expect, it } from "vitest";
import { citedPolicies } from "@/lib/ai/citedPolicies";
import type { AgentFinding, PolicyAgentFinding, RiskAgentFinding } from "@/lib/ai/schemas";

/** The ticket page's "Policy cited" fact: which findings count as policy grounding, and in what order. */
const REFUND = { slug: "refund-policy", title: "Refund Policy" };
const DUPLICATE = { slug: "duplicate-charge-policy", title: "Duplicate Charge Policy" };
const SECURITY = { slug: "account-security-policy", title: "Account Security Policy" };
const ESCALATION = { slug: "escalation-policy", title: "Escalation Policy" };

const base = { summary: "s", evidence: [], confidence: 0.9, flags: [] };

function policy(applicable: typeof REFUND | null, policyReferences: (typeof REFUND)[]): PolicyAgentFinding {
  return {
    ...base,
    agentKey: "policy",
    policyReferences,
    policyDecision: applicable
      ? { applicablePolicy: applicable, decision: "approve", justification: "j", conditionsMet: [], conditionsUnmet: [] }
      : null,
  };
}

function risk(policyReferences: (typeof REFUND)[]): RiskAgentFinding {
  return {
    ...base,
    agentKey: "risk",
    policyReferences,
    escalationRecommended: true,
    escalationReason: "r",
    targetTeam: "trust_and_safety",
    severity: "critical",
  };
}

function plain(agentKey: "billing" | "technical" | "response", policyReferences: (typeof REFUND)[]): AgentFinding {
  return { ...base, agentKey, policyReferences };
}

describe("citedPolicies", () => {
  it("returns the Policy decision's applicable policy first, then its other references, once each", () => {
    const steps = [{ agentKey: "policy", finding: policy(REFUND, [DUPLICATE, REFUND]) }];
    expect(citedPolicies(steps)).toEqual([REFUND, DUPLICATE]);
  });

  it("includes the Risk agent's references, after the Policy agent's, whatever order the steps are stored in", () => {
    const steps = [
      { agentKey: "risk", finding: risk([SECURITY, ESCALATION, REFUND]) },
      { agentKey: "policy", finding: policy(REFUND, []) },
    ];
    expect(citedPolicies(steps)).toEqual([REFUND, SECURITY, ESCALATION]);
    expect(citedPolicies([...steps].reverse())).toEqual([REFUND, SECURITY, ESCALATION]);
  });

  it("ignores Billing, Technical and Response findings, even when they hold a non-empty citation list", () => {
    const steps = [
      { agentKey: "billing", finding: plain("billing", [REFUND]) },
      { agentKey: "technical", finding: plain("technical", [DUPLICATE]) },
      { agentKey: "response", finding: plain("response", [SECURITY]) },
    ];
    expect(citedPolicies(steps)).toEqual([]);
    expect(citedPolicies([...steps, { agentKey: "risk", finding: risk([ESCALATION]) }])).toEqual([ESCALATION]);
  });

  it("still returns a Policy finding's references when it reached no decision", () => {
    expect(citedPolicies([{ agentKey: "policy", finding: policy(null, [REFUND]) }])).toEqual([REFUND]);
  });

  it("returns nothing when no qualifying finding cites a policy", () => {
    expect(citedPolicies([])).toEqual([]);
    expect(
      citedPolicies([
        { agentKey: "classifier", finding: { intent: "technical_issue" } },
        { agentKey: "policy", finding: null },
        { agentKey: "policy", finding: policy(null, []) },
        { agentKey: "risk", finding: risk([]) },
      ]),
    ).toEqual([]);
  });
});
