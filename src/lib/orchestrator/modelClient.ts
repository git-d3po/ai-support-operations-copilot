import { getProvider } from "@/lib/ai/providers/registry";
import type { CompletionRequest, CompletionResult } from "@/lib/ai/providers/types";
import { DEFAULT_MODEL_ROUTING, estimateCostUsd } from "./modelRouting";
import type { ModelRoutingConfig, PipelineStepKey } from "./types";

export interface ModelCallResult extends CompletionResult {
  /** The model this call was ROUTED to (modelRouting.ts) — the intended
   * target, not proof of who actually served it. */
  model: string;
  /** The provider that ACTUALLY served this call (`ModelProvider.key`),
   * independent of what was configured. When the "anthropic" slot is
   * overridden with a fixture/mock (e2e tests, a deliberate evaluation
   * dry run), this reads "mock" — never silently reported as if a real
   * model answered. See DECISIONS.md ("Honestly recording which provider
   * actually served a call"). */
  provider: string;
  latencyMs: number;
  estimatedCostUsd: number;
}

/**
 * The single choke point every pipeline step (the 5 specialist agents, plus
 * classification) calls a model through. A caller passes its
 * `PipelineStepKey` and a request (no model id, no provider) — routing
 * config decides which provider and model actually handle it, and this
 * function measures latency and cost the same way for every step.
 *
 * This is what makes the provider abstraction actually load-bearing:
 * Phase 2 agents call `callModel("billing", {...})`, never
 * `getProvider(...)` or an SDK directly. Swapping billing to a different
 * provider is a one-line change in modelRouting.ts — zero changes here or
 * in any agent file. See DECISIONS.md ("Model provider abstraction").
 */
export async function callModel(
  stepKey: PipelineStepKey,
  request: Omit<CompletionRequest, "model">,
  routing: ModelRoutingConfig = DEFAULT_MODEL_ROUTING,
): Promise<ModelCallResult> {
  const config = routing[stepKey];
  if (!config) {
    throw new Error(`No model routing configured for pipeline step "${stepKey}"`);
  }

  const provider = getProvider(config.provider);
  const startedAt = performance.now();
  const result = await provider.complete({ ...request, model: config.model });
  const latencyMs = performance.now() - startedAt;

  return {
    ...result,
    model: config.model,
    provider: provider.key,
    latencyMs,
    estimatedCostUsd: estimateCostUsd(stepKey, result.inputTokens, result.outputTokens, routing),
  };
}
