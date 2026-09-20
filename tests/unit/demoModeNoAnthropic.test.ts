import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The invariant public Demo Mode depends on: with AI_MODE=demo, the Anthropic
 * SDK is never constructed and never called, even when an API key is present
 * in the environment. The SDK is mocked here so a regression would be caught
 * without any real call; a live-mode control proves the spies do detect a call.
 * This is the only test file allowed to mock the SDK besides anthropicProvider.test.ts.
 */
const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return { messages: { create: createMock } };
  }),
}));

import Anthropic from "@anthropic-ai/sdk";
import { _resetProvidersForTests, getProvider } from "@/lib/ai/providers/registry";
import { runOrchestration } from "@/lib/orchestrator/orchestrator";
import { POLICIES } from "../../prisma/data/policies";
import { SCENARIOS } from "../../prisma/data/scenarios";
import { makeAccountContext } from "./testSupport/fixtures";

const originalMode = process.env.AI_MODE;
const originalKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  vi.mocked(Anthropic).mockClear();
  createMock.mockReset();
  _resetProvidersForTests();
});

afterEach(() => {
  if (originalMode === undefined) delete process.env.AI_MODE;
  else process.env.AI_MODE = originalMode;
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
  _resetProvidersForTests();
});

async function runScenario(key: string) {
  const scenario = SCENARIOS.find((s) => s.key === key)!;
  return runOrchestration({
    ticketId: `test-${key}`,
    ticketSummary: scenario.ticket.subject,
    conversation: scenario.messages.map((m) => ({ author: m.author, body: m.body })),
    // Policies must be present: the Policy agent's citation is only trusted when it names a policy that was retrieved.
    accountContext: makeAccountContext({
      policies: POLICIES.map((p) => ({ slug: p.slug, title: p.title, category: p.category, body: p.body })),
    }),
  });
}

describe("Demo Mode makes zero Anthropic calls", () => {
  it("with an API key present, a full pipeline run never constructs or calls the SDK", async () => {
    process.env.AI_MODE = "demo";
    process.env.ANTHROPIC_API_KEY = "sk-test-present-but-must-be-ignored";

    for (const key of ["duplicate-billing", "suspicious-activity", "technical-escalation", "ambiguous-request"]) {
      const outcome = await runScenario(key);
      expect(outcome.classificationMetrics.provider).toBe("demo");
    }

    expect(vi.mocked(Anthropic)).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("with no API key at all, a full pipeline run still succeeds", async () => {
    process.env.AI_MODE = "demo";
    delete process.env.ANTHROPIC_API_KEY;
    const outcome = await runScenario("duplicate-billing");
    expect(outcome.resolution.action).toBe("refund_customer");
    expect(vi.mocked(Anthropic)).not.toHaveBeenCalled();
  });

  it("does not even construct AnthropicProvider (and so the SDK) when the provider is only resolved", () => {
    process.env.AI_MODE = "demo";
    process.env.ANTHROPIC_API_KEY = "sk-test-present-but-must-be-ignored";
    getProvider("anthropic");
    expect(vi.mocked(Anthropic)).not.toHaveBeenCalled();
  });

  it("CONTROL: in live mode the same spies DO see the SDK being used (so the assertions above can fail)", async () => {
    delete process.env.AI_MODE;
    process.env.ANTHROPIC_API_KEY = "sk-test-fake-key";
    createMock.mockResolvedValue({ content: [{ type: "text", text: "hello" }], usage: { input_tokens: 1, output_tokens: 1 } });

    const result = await getProvider("anthropic").complete({ model: "claude-haiku-4-5-20251001", messages: [{ role: "user", content: "hi" }] });

    expect(result.text).toBe("hello");
    expect(vi.mocked(Anthropic)).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
