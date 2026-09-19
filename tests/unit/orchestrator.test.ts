import { describe, expect, it } from "vitest";
import { runOrchestration } from "@/lib/orchestrator/orchestrator";

describe("runOrchestration (foundation phase: stub agents, real control flow)", () => {
  it("runs the full pipeline shape: classification -> selection -> agents -> resolution", async () => {
    const outcome = await runOrchestration({
      ticketId: "test-ticket",
      ticketSummary: "test",
      conversation: [{ author: "customer", body: "test" }],
      accountContext: null,
    });

    expect(outcome.classification).toBeDefined();
    expect(outcome.agentsInvoked.length).toBeGreaterThan(0);
    expect(outcome.agentsInvoked).toContain("response");
    expect(outcome.agentResults).toHaveLength(outcome.agentsInvoked.length);
    expect(outcome.resolution.action).toBeDefined();
  });

  it("every invoked agent's finding.agentKey matches the agent it came from", async () => {
    const outcome = await runOrchestration({
      ticketId: "test-ticket",
      ticketSummary: "test",
      conversation: [],
      accountContext: null,
    });

    for (const [index, key] of outcome.agentsInvoked.entries()) {
      expect(outcome.agentResults[index].finding.agentKey).toBe(key);
    }
  });

  it("does not escalate when no agent flags requires_escalation", async () => {
    const outcome = await runOrchestration({
      ticketId: "test-ticket",
      ticketSummary: "test",
      conversation: [],
      accountContext: null,
    });

    expect(outcome.escalation).toBeNull();
  });
});
