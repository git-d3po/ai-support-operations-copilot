import { loadTicketContext } from "./context";
import { runOrchestration, type OrchestrationOutcome } from "./orchestrator";
import { persistFailedRun, persistOrchestrationRun, type PersistedRun } from "./persist";

export type AnalyzeTicketResult =
  | { ok: true; run: PersistedRun; outcome: OrchestrationOutcome }
  | { ok: false; error: string; run: PersistedRun | null };

/**
 * The single entry point for "Run AI analysis": loads real ticket data,
 * runs the orchestration pipeline, and persists the result — or, if
 * anything in that chain throws (most realistically: no
 * ANTHROPIC_API_KEY configured), persists a failed run and returns a
 * clean error instead of throwing. Callers (the Server Action in
 * src/app/tickets/[id]/actions.ts) never need their own try/catch around
 * the model-calling pipeline.
 */
export async function analyzeTicket(ticketId: string): Promise<AnalyzeTicketResult> {
  try {
    const context = await loadTicketContext(ticketId);
    const outcome = await runOrchestration(context);
    const run = await persistOrchestrationRun(ticketId, outcome);
    return { ok: true, run, outcome };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error running AI analysis.";
    try {
      const run = await persistFailedRun(ticketId, message);
      return { ok: false, error: message, run };
    } catch {
      // Persisting the failure itself failed (e.g. bad ticketId) — surface
      // the error without a run to link to rather than throwing further.
      return { ok: false, error: message, run: null };
    }
  }
}
