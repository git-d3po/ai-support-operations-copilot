import type { ModelRoutingConfig } from "./types";

/**
 * Default model routing. Each agent's provider AND model are independently
 * configurable — this is the one place that changes if we want e.g. the
 * Risk Agent on a stronger model, or on a different provider entirely.
 * Pricing is used only to estimate cost in the AI Operations view; it is
 * not billed anywhere.
 *
 * Model routing is deliberately NOT the centerpiece of this product — it's
 * a small, boring config object. See DECISIONS.md ("Model routing is
 * configurable but not the product", "Model provider abstraction").
 */
export const DEFAULT_MODEL_ROUTING: ModelRoutingConfig = {
  classifier: {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    inputCostPerMTokUsd: 1,
    outputCostPerMTokUsd: 5,
  },
  billing: {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    inputCostPerMTokUsd: 1,
    outputCostPerMTokUsd: 5,
  },
  policy: {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    inputCostPerMTokUsd: 1,
    outputCostPerMTokUsd: 5,
  },
  technical: {
    provider: "anthropic",
    model: "claude-sonnet-5",
    inputCostPerMTokUsd: 3,
    outputCostPerMTokUsd: 15,
  },
  risk: {
    provider: "anthropic",
    model: "claude-sonnet-5",
    inputCostPerMTokUsd: 3,
    outputCostPerMTokUsd: 15,
  },
  response: {
    provider: "anthropic",
    model: "claude-sonnet-5",
    inputCostPerMTokUsd: 3,
    outputCostPerMTokUsd: 15,
  },
};

export function estimateCostUsd(
  agentKey: string,
  inputTokens: number,
  outputTokens: number,
  routing: ModelRoutingConfig = DEFAULT_MODEL_ROUTING,
): number {
  const config = routing[agentKey];
  if (!config) return 0;
  return (
    (inputTokens / 1_000_000) * config.inputCostPerMTokUsd +
    (outputTokens / 1_000_000) * config.outputCostPerMTokUsd
  );
}
