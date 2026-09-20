"use server";

import { revalidatePath } from "next/cache";
import { requestAnalysis } from "@/lib/orchestrator/requestAnalysis";
import { isValidTicketId } from "@/lib/orchestrator/ticketId";

export interface RunAnalysisState {
  ok: boolean;
  error: string | null;
}

/**
 * Server Action behind the "Run AI Analysis" / "Run demo analysis" button. All
 * decisions live in requestAnalysis(): the identifier is validated as a bounded
 * string, and the app's mode (`AI_MODE`) is resolved there on the server, never
 * taken from the client. In Demo Mode only curated scenarios run, replays are
 * idempotent, and an ineligible ticket is rejected before anything is
 * persisted; in live mode behavior is exactly what it was (analyzeTicket(),
 * which never throws). This wrapper only revalidates the page so the persisted
 * run shows on the next render, and always resolves with a definite result so
 * the button never gets stuck.
 */
export async function runAnalysisAction(ticketId: string): Promise<RunAnalysisState> {
  const result = await requestAnalysis(ticketId);
  if (isValidTicketId(ticketId)) {
    revalidatePath(`/tickets/${ticketId}`);
  }

  return result.ok ? { ok: true, error: null } : { ok: false, error: result.error };
}
