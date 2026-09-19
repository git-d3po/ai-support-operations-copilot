import { afterEach, describe, expect, it } from "vitest";
import { technicalAgent } from "@/lib/orchestrator/agents/technicalAgent";
import { _resetProvidersForTests, registerProvider } from "@/lib/ai/providers/registry";
import { createTaskMockProvider } from "./testSupport/taskMockProvider";
import { makeAgentContext } from "./testSupport/fixtures";

afterEach(() => {
  _resetProvidersForTests();
});

describe("technicalAgent", () => {
  it("returns a known-issue-with-workaround finding", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        technical_agent_finding: JSON.stringify({
          agentKey: "technical",
          summary: "Matches the known large-board automation timeout issue (ENG-4821).",
          evidence: ["Board has ~2,500 cards, matches documented threshold"],
          confidence: 0.85,
          policyReferences: [],
          flags: ["known_issue_workaround_available"],
        }),
      }),
    );

    const result = await technicalAgent.run(makeAgentContext());
    expect(result.finding.flags).toContain("known_issue_workaround_available");
  });

  it("returns requires_escalation when the workaround already failed", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        technical_agent_finding: JSON.stringify({
          agentKey: "technical",
          summary: "Workaround already attempted and failed; needs engineering.",
          evidence: ["Customer confirmed board was already split"],
          confidence: 0.8,
          policyReferences: [],
          flags: ["known_issue_workaround_already_tried", "requires_escalation"],
        }),
      }),
    );

    const result = await technicalAgent.run(makeAgentContext());
    expect(result.finding.flags).toContain("requires_escalation");
  });

  it("falls back to a degraded finding on malformed output", async () => {
    registerProvider("anthropic", createTaskMockProvider({ technical_agent_finding: "nope" }));
    const result = await technicalAgent.run(makeAgentContext());
    expect(result.finding.flags).toContain("agent_failed");
    expect(result.finding.confidence).toBe(0);
  });
});
