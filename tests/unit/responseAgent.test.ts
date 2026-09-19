import { afterEach, describe, expect, it } from "vitest";
import { responseAgent } from "@/lib/orchestrator/agents/responseAgent";
import { _resetProvidersForTests, registerProvider } from "@/lib/ai/providers/registry";
import { createTaskMockProvider } from "./testSupport/taskMockProvider";
import { makeAgentContext } from "./testSupport/fixtures";

afterEach(() => {
  _resetProvidersForTests();
});

const RESOLUTION = {
  action: "refund_customer" as const,
  summary: "Confirmed duplicate charge, refunding in full.",
  confidence: 0.95,
  requiresHumanReview: false,
};

describe("responseAgent", () => {
  it("drafts a customer response reflecting the given resolution", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        response_agent_reply: JSON.stringify({
          body: "We found the duplicate charge and have refunded it in full.",
          tone: "empathetic",
          nextSteps: ["Refund appears within 5-10 business days"],
        }),
      }),
    );

    const result = await responseAgent.run(
      makeAgentContext({ resolution: RESOLUTION, escalation: null }),
    );

    expect(result.response?.body).toContain("refunded");
    expect(result.finding.flags).not.toContain("agent_failed");
  });

  it("falls back to a safe generic response when drafting fails", async () => {
    registerProvider("anthropic", createTaskMockProvider({ response_agent_reply: "not json" }));

    const result = await responseAgent.run(
      makeAgentContext({ resolution: RESOLUTION, escalation: null }),
    );

    expect(result.response).toBeDefined();
    expect(result.finding.flags).toContain("agent_failed");
    expect(result.finding.confidence).toBe(0);
  });

  it("throws if invoked without a resolution decision (programmer error, not a runtime user path)", async () => {
    registerProvider("anthropic", createTaskMockProvider({ response_agent_reply: "{}" }));
    await expect(responseAgent.run(makeAgentContext())).rejects.toThrow(/requires a resolution/);
  });
});
