import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { KNOWN_AGENT_FLAGS } from "@/lib/ai/schemas";
import type { OrchestrationOutcome } from "./orchestrator";

export interface PersistedRun {
  orchestrationRunId: string;
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

  const run = await db.orchestrationRun.create({
    data: {
      ticketId,
      status: "completed",
      finishedAt: now,
      classification: outcome.classification,
      resolution: outcome.resolution,
      escalation: outcome.escalation ?? Prisma.JsonNull,
      response: outcome.response ?? Prisma.JsonNull,
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

  return { orchestrationRunId: run.id };
}

/** Persists a run that aborted entirely (e.g. no ANTHROPIC_API_KEY
 * configured) before producing any usable outcome — still visible in the
 * UI and in AI Operations' failure/retry data, rather than silently
 * disappearing. */
export async function persistFailedRun(ticketId: string, errorMessage: string): Promise<PersistedRun> {
  const run = await db.orchestrationRun.create({
    data: {
      ticketId,
      status: "failed",
      finishedAt: new Date(),
      errorMessage,
    },
  });
  return { orchestrationRunId: run.id };
}
