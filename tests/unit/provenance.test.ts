import { describe, expect, it } from "vitest";
import { DEMO_PROVIDER_KEY, REAL_PROVIDER_KEYS, anyProviderSimulated, isSimulatedProvider } from "@/lib/ai/providers/provenance";
import { DemoProvider } from "@/lib/ai/providers/demoProvider";
import { MockProvider } from "@/lib/ai/providers/mock";
import { AnthropicProvider } from "@/lib/ai/providers/anthropic";

describe("isSimulatedProvider (the one definition of simulated provenance)", () => {
  it("treats the demo provider as simulated, by an explicit rule", () => {
    expect(DEMO_PROVIDER_KEY).toBe("demo");
    expect(isSimulatedProvider("demo")).toBe(true);
    expect(isSimulatedProvider(DEMO_PROVIDER_KEY)).toBe(true);
  });

  it("treats the test/dry-run mock provider as simulated", () => {
    expect(isSimulatedProvider("mock")).toBe(true);
  });

  it("treats the real Anthropic provider as real", () => {
    expect(REAL_PROVIDER_KEYS).toContain("anthropic");
    expect(isSimulatedProvider("anthropic")).toBe(false);
  });

  it("fails closed: a provider nobody has listed as real is simulated (it cannot inflate real metrics by default)", () => {
    expect(isSimulatedProvider("openai")).toBe(true);
    expect(isSimulatedProvider("")).toBe(true);
    expect(isSimulatedProvider("Anthropic")).toBe(true); // exact key only
  });

  it("agrees with every actual provider class's own key", () => {
    expect(isSimulatedProvider(new DemoProvider().key)).toBe(true);
    expect(isSimulatedProvider(new MockProvider({ text: "", inputTokens: 0, outputTokens: 0 }).key)).toBe(true);
    expect(isSimulatedProvider(new AnthropicProvider().key)).toBe(false);
  });

  it("uses no scattered string comparison: the real-provider allowlist is the only place a provider becomes real", () => {
    expect([...REAL_PROVIDER_KEYS]).toEqual(["anthropic"]);
  });
});

describe("anyProviderSimulated (a run is real only if every call was)", () => {
  it("is false only when every provider is real", () => {
    expect(anyProviderSimulated(["anthropic", "anthropic", "anthropic"])).toBe(false);
    expect(anyProviderSimulated([])).toBe(false);
  });

  it("is true when any call was simulated, including a single demo call among real ones", () => {
    expect(anyProviderSimulated(["anthropic", "demo"])).toBe(true);
    expect(anyProviderSimulated(["demo", "demo"])).toBe(true);
    expect(anyProviderSimulated(["anthropic", "mock", "anthropic"])).toBe(true);
  });
});
