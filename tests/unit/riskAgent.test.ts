import { afterEach, describe, expect, it } from "vitest";
import { isRiskFinding } from "@/lib/ai/schemas";
import { riskAgent } from "@/lib/orchestrator/agents/riskAgent";
import { _resetProvidersForTests, registerProvider } from "@/lib/ai/providers/registry";
import { createTaskMockProvider } from "./testSupport/taskMockProvider";
import { makeAccountContext, makeAgentContext, makeClassification } from "./testSupport/fixtures";

const ACCOUNT_SECURITY_POLICY = {
  slug: "account-security-policy",
  title: "Account Security Policy",
  category: "security",
  body: "Suspected compromise must always escalate to Trust & Safety.",
};

afterEach(() => {
  _resetProvidersForTests();
});

describe("riskAgent", () => {
  it("recommends escalation with a target team and severity", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        risk_agent_finding: JSON.stringify({
          agentKey: "risk",
          summary: "Unrecognized login and API key — suspected compromise.",
          evidence: ["Login from unfamiliar location", "Unrecognized API key"],
          confidence: 0.9,
          policyReferences: [{ slug: "account-security-policy", title: "Account Security Policy" }],
          flags: [],
          escalationRecommended: true,
          escalationReason: "Suspected account compromise per Account Security Policy.",
          targetTeam: "trust_and_safety",
          severity: "critical",
        }),
      }),
    );

    const result = await riskAgent.run(
      makeAgentContext({
        classification: makeClassification({ intent: "account_security" }),
        accountContext: makeAccountContext({ policies: [ACCOUNT_SECURITY_POLICY] }),
      }),
    );
    expect(result.finding.agentKey).toBe("risk");
    if (isRiskFinding(result.finding)) {
      expect(result.finding.escalationRecommended).toBe(true);
      expect(result.finding.targetTeam).toBe("trust_and_safety");
      expect(result.finding.severity).toBe("critical");
      // Grounded (the policy was actually retrieved and shown for this
      // call, via `alwaysInclude` in riskAgent.ts) — citation survives.
      expect(result.finding.policyReferences).toEqual([
        { slug: "account-security-policy", title: "Account Security Policy" },
      ]);
    }
  });

  it("strips a policy citation that was never actually retrieved for this call", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        risk_agent_finding: JSON.stringify({
          agentKey: "risk",
          summary: "Escalating based on a policy I'm inventing.",
          evidence: [],
          confidence: 0.8,
          policyReferences: [{ slug: "made-up-policy", title: "Policy That Was Never Retrieved" }],
          flags: [],
          escalationRecommended: true,
          escalationReason: "x",
          targetTeam: "senior_support",
          severity: "medium",
        }),
      }),
    );

    // Default fixture accountContext has no policies at all, so
    // riskAgent's own `alwaysInclude` list has nothing real to match —
    // nothing is genuinely retrieved for this call.
    const result = await riskAgent.run(makeAgentContext());
    if (isRiskFinding(result.finding)) {
      expect(result.finding.policyReferences).toEqual([]);
      // The escalation decision itself isn't citation-dependent, so it's
      // preserved even though the citation was discarded.
      expect(result.finding.escalationRecommended).toBe(true);
    }
  });

  it("does not escalate when nothing warrants it", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        risk_agent_finding: JSON.stringify({
          agentKey: "risk",
          summary: "No risk signals found.",
          evidence: [],
          confidence: 0.8,
          policyReferences: [],
          flags: [],
          escalationRecommended: false,
          escalationReason: null,
          targetTeam: null,
          severity: null,
        }),
      }),
    );

    const result = await riskAgent.run(makeAgentContext());
    if (isRiskFinding(result.finding)) {
      expect(result.finding.escalationRecommended).toBe(false);
    }
  });

  it("fails safe: recommends escalation when risk assessment itself fails", async () => {
    registerProvider("anthropic", createTaskMockProvider({ risk_agent_finding: "not json" }));

    const result = await riskAgent.run(makeAgentContext());
    expect(result.finding.agentKey).toBe("risk");
    if (isRiskFinding(result.finding)) {
      expect(result.finding.escalationRecommended).toBe(true);
    }
    expect(result.finding.flags).toContain("agent_failed");
  });
});
