import { afterEach, describe, expect, it } from "vitest";
import { isRiskFinding } from "@/lib/ai/schemas";
import { riskAgent } from "@/lib/orchestrator/agents/riskAgent";
import { _resetProvidersForTests, registerProvider } from "@/lib/ai/providers/registry";
import { createTaskMockProvider } from "./testSupport/taskMockProvider";
import { makeAgentContext } from "./testSupport/fixtures";

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

    const result = await riskAgent.run(makeAgentContext());
    expect(result.finding.agentKey).toBe("risk");
    if (isRiskFinding(result.finding)) {
      expect(result.finding.escalationRecommended).toBe(true);
      expect(result.finding.targetTeam).toBe("trust_and_safety");
      expect(result.finding.severity).toBe("critical");
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
