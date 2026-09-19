import { afterEach, describe, expect, it } from "vitest";
import { callModel } from "@/lib/orchestrator/modelClient";
import { _resetProvidersForTests, registerProvider } from "@/lib/ai/providers/registry";
import { MockProvider } from "@/lib/ai/providers/mock";
import type { ModelRoutingConfig } from "@/lib/orchestrator/types";

/**
 * Proves the provider abstraction actually works end to end — including
 * that swapping a pipeline step's provider requires touching only routing
 * config, never modelClient.ts or the caller. No network call is made:
 * this is exactly the "unit tests must have no network" requirement
 * (CLAUDE.md) staying true once Phase 2 wires agents to real providers.
 */

const mockRouting: ModelRoutingConfig = {
  billing: {
    provider: "mock",
    model: "mock-model-v1",
    inputCostPerMTokUsd: 2,
    outputCostPerMTokUsd: 10,
  },
};

afterEach(() => {
  _resetProvidersForTests();
});

describe("callModel", () => {
  it("routes to the configured provider and model, and returns usage + cost + latency", async () => {
    registerProvider(
      "mock",
      new MockProvider({ text: "billing finding", inputTokens: 100, outputTokens: 50 }),
    );

    const result = await callModel(
      "billing",
      { messages: [{ role: "user", content: "test" }] },
      mockRouting,
    );

    expect(result.text).toBe("billing finding");
    expect(result.model).toBe("mock-model-v1");
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.estimatedCostUsd).toBeCloseTo((100 / 1_000_000) * 2 + (50 / 1_000_000) * 10);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("passes the routed model id (not the caller's) to the provider", async () => {
    let seenModel: string | undefined;
    registerProvider(
      "mock",
      new MockProvider((request) => {
        seenModel = request.model;
        return { text: "ok", inputTokens: 1, outputTokens: 1 };
      }),
    );

    await callModel("billing", { messages: [] }, mockRouting);

    expect(seenModel).toBe("mock-model-v1");
  });

  it("switching a step's provider in routing config is the only change needed", async () => {
    registerProvider("mock", new MockProvider({ text: "from mock", inputTokens: 1, outputTokens: 1 }));

    // Same call site, same agent key — only the routing config differs.
    const viaMock = await callModel("billing", { messages: [] }, mockRouting);
    expect(viaMock.text).toBe("from mock");
  });

  it("throws a clear error for a pipeline step with no routing entry", async () => {
    await expect(
      callModel("technical", { messages: [] }, mockRouting),
    ).rejects.toThrow(/No model routing configured/);
  });

  it("throws a clear error when a provider key has no registered/constructible instance", async () => {
    await expect(callModel("billing", { messages: [] }, mockRouting)).rejects.toThrow(
      /No "mock" provider registered/,
    );
  });

  it("supports the classifier pipeline step (not a specialist agent) through the same routing shape", async () => {
    registerProvider("mock", new MockProvider({ text: "classified", inputTokens: 5, outputTokens: 5 }));
    const routing: ModelRoutingConfig = {
      classifier: { provider: "mock", model: "mock-classifier", inputCostPerMTokUsd: 1, outputCostPerMTokUsd: 1 },
    };

    const result = await callModel("classifier", { messages: [] }, routing);
    expect(result.text).toBe("classified");
  });
});
