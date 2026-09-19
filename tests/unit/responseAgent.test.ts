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

  describe("refund-authorization contract", () => {
    const NO_REFUND_RESOLUTION = {
      action: "reply_and_close" as const,
      summary: "Resolved based on specialist agent findings.",
      confidence: 0.99,
      requiresHumanReview: false,
    };
    const OVER_PROMISE = JSON.stringify({
      body: "We confirmed the duplicate charge and we're processing a refund now.",
      tone: "apologetic",
      nextSteps: ["Refund is being processed"],
    });
    const SAFE = JSON.stringify({
      body: "Thanks for flagging this. We're reviewing the duplicate charge and will follow up with next steps.",
      tone: "apologetic",
      nextSteps: ["A team member will follow up"],
    });

    it("states the authorized commitments in the prompt, derived from the resolution", async () => {
      const seen: string[] = [];
      registerProvider(
        "anthropic",
        createTaskMockProvider({
          response_agent_reply: (request) => {
            seen.push(request.messages.at(-1)!.content);
            return SAFE;
          },
        }),
      );
      await responseAgent.run(makeAgentContext({ resolution: NO_REFUND_RESOLUTION, escalation: null }));
      expect(seen[0]).toContain("NO refund is authorized");

      seen.length = 0;
      await responseAgent.run(makeAgentContext({ resolution: RESOLUTION, escalation: null }));
      expect(seen[0]).toContain("a refund IS authorized");
    });

    it("retries with the reason fed back when a non-refund resolution gets an over-promising draft, then accepts a compliant one", async () => {
      const prompts: string[] = [];
      registerProvider(
        "anthropic",
        createTaskMockProvider({
          response_agent_reply: [
            (request) => (prompts.push(request.messages.at(-1)!.content), OVER_PROMISE),
            (request) => (prompts.push(request.messages.at(-1)!.content), SAFE),
          ],
        }),
      );

      const result = await responseAgent.run(makeAgentContext({ resolution: NO_REFUND_RESOLUTION, escalation: null }));

      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toContain("does not authorize");
      expect(result.response?.body).toContain("reviewing the duplicate charge");
      expect(result.finding.flags).not.toContain("agent_failed");
    });

    it("never persists an over-promise: persistent violation degrades to the safe fallback", async () => {
      registerProvider("anthropic", createTaskMockProvider({ response_agent_reply: OVER_PROMISE }));

      const result = await responseAgent.run(makeAgentContext({ resolution: NO_REFUND_RESOLUTION, escalation: null }));

      expect(result.finding.flags).toContain("agent_failed");
      expect(result.response?.body).not.toMatch(/refund/i);
      expect(result.response?.nextSteps.join(" ")).not.toMatch(/refund/i);
    });

    it("does not restrict a refund confirmation when the resolution is refund_customer", async () => {
      registerProvider("anthropic", createTaskMockProvider({ response_agent_reply: OVER_PROMISE }));

      const result = await responseAgent.run(makeAgentContext({ resolution: RESOLUTION, escalation: null }));

      expect(result.finding.flags).not.toContain("agent_failed");
      expect(result.response?.body).toContain("processing a refund");
    });
  });
});
