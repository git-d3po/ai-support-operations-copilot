import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { KNOWN_AGENT_FLAGS } from "@/lib/ai/schemas";
import { anyProviderSimulated, isSimulatedProvider } from "@/lib/ai/providers/provenance";
import { getProvider } from "@/lib/ai/providers/registry";
import type { OrchestrationOutcome } from "./orchestrator";
import { DEFAULT_MODEL_ROUTING } from "./modelRouting";

export interface PersistedRun {
  orchestrationRunId: string;
  /** True when any part of this run was served by a simulated provider
   * (the scripted `demo` provider, or a `mock` fixture) rather than a real
   * model — see provenance.ts, the one definition of that. Callers (e.g. the
   * evaluation runner) use this to tag their own records honestly rather
   * than re-querying. */
  isSimulated: boolean;
}


/**
 * Writes a completed OrchestrationOutcome as an OrchestrationRun + one
 * AgentInvocation per pipeline step that called a model (the classifier,
 * plus every specialist agent that actually ran) — see
 * ARCHITECTURE.md ("Data model"). This is the only place orchestration
 * results become visible to the UI; nothing renders a result that wasn't
 * actually persisted here.
 */
export async function persistOrchestrationRun(
  ticketId: string,
  outcome: OrchestrationOutcome,
): Promise<PersistedRun> {
  const now = new Date();

  const isSimulated = anyProviderSimulated([
    outcome.classificationMetrics.provider,
    ...outcome.agentResults.map((r) => r.metrics.provider),
  ]);

  const run = await db.orchestrationRun.create({
    data: {
      ticketId,
      status: "completed",
      finishedAt: now,
      classification: outcome.classification,
      resolution: outcome.resolution,
      escalation: outcome.escalation ?? Prisma.JsonNull,
      response: outcome.response ?? Prisma.JsonNull,
      isSimulated,
    },
  });

  const classifierLatencyMs = Math.round(outcome.classificationMetrics.latencyMs);
  await db.agentInvocation.create({
    data: {
      orchestrationRunId: run.id,
      agentKey: "classifier",
      status: outcome.classificationFailed ? "failed" : "succeeded",
      finding: outcome.classification,
      model: outcome.classificationMetrics.model,
      provider: outcome.classificationMetrics.provider,
      inputTokens: outcome.classificationMetrics.inputTokens,
      outputTokens: outcome.classificationMetrics.outputTokens,
      latencyMs: classifierLatencyMs,
      estimatedCostUsd: outcome.classificationMetrics.estimatedCostUsd,
      errorMessage: outcome.classificationFailed
        ? "Classification failed to produce valid structured output after retrying."
        : null,
      startedAt: new Date(now.getTime() - classifierLatencyMs),
      finishedAt: now,
    },
  });

  for (const result of outcome.agentResults) {
    const failed = result.finding.flags.includes(KNOWN_AGENT_FLAGS.AGENT_FAILED);
    const latencyMs = result.metrics.latencyMs != null ? Math.round(result.metrics.latencyMs) : null;
    await db.agentInvocation.create({
      data: {
        orchestrationRunId: run.id,
        agentKey: result.finding.agentKey,
        status: failed ? "failed" : "succeeded",
        finding: result.finding,
        model: result.metrics.model,
        provider: result.metrics.provider,
        inputTokens: result.metrics.inputTokens ?? null,
        outputTokens: result.metrics.outputTokens ?? null,
        latencyMs,
        estimatedCostUsd: result.metrics.estimatedCostUsd ?? null,
        errorMessage: failed ? result.finding.summary : null,
        startedAt: latencyMs != null ? new Date(now.getTime() - latencyMs) : now,
        finishedAt: now,
      },
    });
  }

  return { orchestrationRunId: run.id, isSimulated };
}

/**
 * Whether a run that aborted before any step produced provenance would have
 * been served by a simulated provider. A failed run has no per-step provider
 * to read, so this asks which provider the pipeline's first step is routed to.
 * It fails closed: if that cannot be determined (for example an invalid
 * AI_MODE), the run is treated as simulated so it can never inflate the real
 * failure metrics.
 */
function abortedRunIsSimulated(): boolean {
  try {
    return isSimulatedProvider(getProvider(DEFAULT_MODEL_ROUTING.classifier.provider).key);
  } catch {
    return true;
  }
}

/** Persists a run that aborted entirely (e.g. no ANTHROPIC_API_KEY
 * configured) before producing any usable outcome — still visible in the
 * UI and in AI Operations' failure/retry data, rather than silently
 * disappearing. A failed run is marked simulated exactly when a completed
 * one would have been (Demo Mode failures never count as real failures);
 * pass `isSimulated` to override the derived value. */
export async function persistFailedRun(
  ticketId: string,
  errorMessage: string,
  isSimulated: boolean = abortedRunIsSimulated(),
): Promise<PersistedRun> {
  const run = await db.orchestrationRun.create({
    data: {
      ticketId,
      status: "failed",
      finishedAt: new Date(),
      errorMessage,
      isSimulated,
    },
  });
  return { orchestrationRunId: run.id, isSimulated };
}
