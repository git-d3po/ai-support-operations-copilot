import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidAiModeError } from "@/lib/ai/mode";
import { AnthropicProvider } from "@/lib/ai/providers/anthropic";
import { DemoProvider } from "@/lib/ai/providers/demoProvider";
import { MockProvider } from "@/lib/ai/providers/mock";
import { _resetProvidersForTests, getProvider, registerProvider } from "@/lib/ai/providers/registry";
import { REAL_PROVIDER_KEYS } from "@/lib/ai/providers/provenance";

/**
 * Which provider fills the "anthropic" slot is decided by AI_MODE alone:
 * unset or live keeps the real provider (existing behavior); demo selects the
 * scripted DemoProvider and never constructs the real one.
 */
const originalMode = process.env.AI_MODE;
const originalKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  delete process.env.AI_MODE;
  _resetProvidersForTests();
});

afterEach(() => {
  if (originalMode === undefined) delete process.env.AI_MODE;
  else process.env.AI_MODE = originalMode;
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
  _resetProvidersForTests();
});

describe("live mode keeps the existing behavior", () => {
  it("selects AnthropicProvider when AI_MODE is unset", () => {
    expect(getProvider("anthropic")).toBeInstanceOf(AnthropicProvider);
    expect(getProvider("anthropic").key).toBe("anthropic");
  });

  it("selects AnthropicProvider when AI_MODE=live", () => {
    process.env.AI_MODE = "live";
    expect(getProvider("anthropic")).toBeInstanceOf(AnthropicProvider);
  });

  it("selects AnthropicProvider for a blank AI_MODE", () => {
    process.env.AI_MODE = "";
    expect(getProvider("anthropic")).toBeInstanceOf(AnthropicProvider);
  });

  it("still lets a test register a MockProvider in the anthropic slot", () => {
    const mock = new MockProvider({ text: "x", inputTokens: 1, outputTokens: 1 });
    registerProvider("anthropic", mock);
    expect(getProvider("anthropic")).toBe(mock);
  });

  it("caches the provider instance", () => {
    expect(getProvider("anthropic")).toBe(getProvider("anthropic"));
  });
});

describe("demo mode selects the DemoProvider", () => {
  beforeEach(() => {
    process.env.AI_MODE = "demo";
  });

  it("returns a DemoProvider whose key is exactly 'demo'", () => {
    const provider = getProvider("anthropic");
    expect(provider).toBeInstanceOf(DemoProvider);
    expect(provider).not.toBeInstanceOf(AnthropicProvider);
    expect(provider.key).toBe("demo");
  });

  it("returns the DemoProvider even when an API key is present in the environment", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-present-but-must-be-ignored";
    expect(getProvider("anthropic")).toBeInstanceOf(DemoProvider);
  });

  it("does not hand out a real AnthropicProvider that was cached before demo mode was read", () => {
    delete process.env.AI_MODE;
    const real = getProvider("anthropic");
    expect(real).toBeInstanceOf(AnthropicProvider);
    process.env.AI_MODE = "demo";
    const now = getProvider("anthropic");
    expect(now).not.toBe(real);
    expect(now).toBeInstanceOf(DemoProvider);
  });

  it("still honors an explicitly registered non-Anthropic provider (test injection)", () => {
    const mock = new MockProvider({ text: "x", inputTokens: 1, outputTokens: 1 });
    registerProvider("anthropic", mock);
    expect(getProvider("anthropic")).toBe(mock);
  });

  it("decides what is 'real' by the shared provenance rule, not by the name 'anthropic'", () => {
    // A cached provider the rule treats as simulated is kept, whatever it is called...
    const simulated = { key: "custom-scripted", complete: async () => ({ text: "x", inputTokens: 0, outputTokens: 0 }) };
    registerProvider("anthropic", simulated);
    expect(getProvider("anthropic")).toBe(simulated);

    // ...and a cached provider the rule treats as real is dropped in demo mode, including a real
    // provider that does not exist yet (only a rule-based guard covers it; a hardcoded "anthropic" would not).
    const keys = REAL_PROVIDER_KEYS as string[];
    keys.push("future-real-provider");
    try {
      const futureReal = { key: "future-real-provider", complete: async () => ({ text: "x", inputTokens: 0, outputTokens: 0 }) };
      registerProvider("anthropic", futureReal);
      expect(getProvider("anthropic")).not.toBe(futureReal);
      expect(getProvider("anthropic")).toBeInstanceOf(DemoProvider);
    } finally {
      keys.pop();
    }
  });
});

describe("an invalid AI_MODE is refused, never treated as live", () => {
  it.each(["Demo", "true", "prod"])("throws for AI_MODE=%s", (value) => {
    process.env.AI_MODE = value;
    expect(() => getProvider("anthropic")).toThrow(InvalidAiModeError);
  });
});

describe("the mock key still has no default provider", () => {
  it("throws unless one is registered", () => {
    expect(() => getProvider("mock")).toThrow(/No "mock" provider registered/);
  });
});
