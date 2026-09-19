"use server";

import { revalidatePath } from "next/cache";
import { analyzeTicket } from "@/lib/orchestrator/analyzeTicket";

export interface RunAnalysisState {
  ok: boolean;
  error: string | null;
}

/**
 * Server Action behind the "Run AI Analysis" button. Delegates entirely to
 * analyzeTicket() (which already never throws — see analyzeTicket.ts) and
 * revalidates the ticket page so the freshly persisted OrchestrationRun
 * shows up on next render. Never leaves the client stuck: it always
 * resolves with a definite ok/error result.
 */
export async function runAnalysisAction(ticketId: string): Promise<RunAnalysisState> {
  const result = await analyzeTicket(ticketId);
  revalidatePath(`/tickets/${ticketId}`);

  if (result.ok) {
    return { ok: true, error: null };
  }
  return { ok: false, error: result.error };
}
