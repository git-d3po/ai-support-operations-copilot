import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests the Anthropic provider's response-mapping logic and error handling
 * without any real network call — the SDK's `messages.create` is mocked.
 * This is the only test file allowed to mock `@anthropic-ai/sdk`, matching
 * `anthropic.ts` being the only file allowed to import it.
 */

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  // A constructor function (not an arrow function) so `new Anthropic(...)`
  // in anthropic.ts works against this mock.
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return { messages: { create: createMock } };
  }),
}));

describe("AnthropicProvider", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    createMock.mockReset();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("throws a clear, actionable error when ANTHROPIC_API_KEY is not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { AnthropicProvider } = await import("@/lib/ai/providers/anthropic");
    const provider = new AnthropicProvider();

    await expect(
      provider.complete({ model: "claude-sonnet-5", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("maps a successful response's text and usage into a CompletionResult", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "Hello, " }, { type: "text", text: "world." }],
      usage: { input_tokens: 42, output_tokens: 17 },
    });

    const { AnthropicProvider } = await import("@/lib/ai/providers/anthropic");
    const provider = new AnthropicProvider();
    const result = await provider.complete({
      model: "claude-sonnet-5",
      system: "Be concise.",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result).toEqual({ text: "Hello, world.", inputTokens: 42, outputTokens: 17 });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-5", system: "Be concise." }),
    );
  });

  it("sends an explicit max_tokens budget, and lets a caller override it", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    createMock.mockResolvedValue({ content: [], usage: { input_tokens: 1, output_tokens: 1 } });

    const { AnthropicProvider } = await import("@/lib/ai/providers/anthropic");
    const { DEFAULT_MAX_OUTPUT_TOKENS } = await import("@/lib/ai/providers/types");
    const provider = new AnthropicProvider();

    await provider.complete({ model: "claude-sonnet-5", messages: [] });
    expect(createMock).toHaveBeenLastCalledWith(expect.objectContaining({ max_tokens: DEFAULT_MAX_OUTPUT_TOKENS }));
    expect(DEFAULT_MAX_OUTPUT_TOKENS).toBe(2048);

    await provider.complete({ model: "claude-sonnet-5", messages: [], maxTokens: 300 });
    expect(createMock).toHaveBeenLastCalledWith(expect.objectContaining({ max_tokens: 300 }));
  });

  it("ignores non-text content blocks when assembling the response text", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    createMock.mockResolvedValue({
      content: [
        { type: "tool_use", id: "x", name: "noop", input: {} },
        { type: "text", text: "final answer" },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const { AnthropicProvider } = await import("@/lib/ai/providers/anthropic");
    const provider = new AnthropicProvider();
    const result = await provider.complete({ model: "claude-sonnet-5", messages: [] });

    expect(result.text).toBe("final answer");
  });
});
