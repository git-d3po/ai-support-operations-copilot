import type { z } from "zod";
import { callWithStructuredRetry } from "@/lib/ai/parse";
import { callModel, type ModelCallResult } from "./modelClient";
import type { PipelineStepKey } from "./types";

export interface StructuredStepResult<T> {
  /** null when every attempt failed to parse — callers must supply a safe
   * fallback rather than let this propagate as missing data. */
  data: T | null;
  parseError: string | null;
  metrics: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    estimatedCostUsd: number;
  };
}

/**
 * The one place every pipeline step (classifier + all 5 agents) goes
 * through to call a model and get validated structured output back. Wraps
 * `callWithStructuredRetry` (validate, retry once with the error fed back)
 * and accumulates metrics across every attempt actually made — a retry is
 * a real, billed call, so its tokens/latency/cost count too.
 *
 * Never throws on a malformed response: returns `data: null` so the caller
 * (an agent, or classify.ts) can construct an honest "this step failed"
 * result instead of letting bad data enter the system silently.
 */
export async function runStructuredStep<Schema extends z.ZodTypeAny>(
  stepKey: PipelineStepKey,
  schema: Schema,
  buildRequest: (retryContext?: string) => { system: string; messages: { role: "user" | "assistant"; content: string }[] },
): Promise<StructuredStepResult<z.infer<Schema>>> {
  const calls: ModelCallResult[] = [];

  const parsed = await callWithStructuredRetry(schema, async (retryContext) => {
    const request = buildRequest(retryContext);
    const result = await callModel(stepKey, request);
    calls.push(result);
    return result.text;
  });

  const metrics = {
    model: calls.at(-1)?.model ?? "unknown",
    inputTokens: calls.reduce((sum, c) => sum + c.inputTokens, 0),
    outputTokens: calls.reduce((sum, c) => sum + c.outputTokens, 0),
    latencyMs: calls.reduce((sum, c) => sum + c.latencyMs, 0),
    estimatedCostUsd: calls.reduce((sum, c) => sum + c.estimatedCostUsd, 0),
  };

  if (!parsed.ok) {
    return { data: null, parseError: parsed.error, metrics };
  }
  return { data: parsed.data, parseError: null, metrics };
}
