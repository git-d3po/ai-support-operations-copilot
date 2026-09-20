import { db } from "@/lib/db";
import { getAiMode } from "@/lib/ai/mode";
import { DEMO_PROVIDER_KEY } from "@/lib/ai/providers/provenance";
import { DEMO_CURATED_ONLY_MESSAGE, hasDemoRecording } from "@/lib/demo/recordings";
import { analyzeTicket } from "./analyzeTicket";
import { isValidTicketId } from "./ticketId";

export { DEMO_CURATED_ONLY_MESSAGE };

/** Shown when the demo request itself could not be processed (an unexpected server or database error). */
export const DEMO_UNAVAILABLE_MESSAGE = "Demo analysis could not be completed because of a server error. Please try again later.";

/** Shown when the one recorded demo run for this ticket failed and has no stored message. */
const DEMO_PREVIOUS_FAILURE_MESSAGE = "The demo analysis for this ticket failed earlier and is not retried.";

export type AnalysisRequestResult =
  | { ok: true; runId: string | null; /** True when an existing demo run was returned instead of creating one. */ replayed: boolean }
  | { ok: false; error: string };

/**
 * The decision layer behind "Run AI analysis": everything the Server Action
 * does except revalidating the page, kept in a plain module so it can be tested.
 *
 * Live mode (AI_MODE unset or `live`) is exactly the existing behavior:
 * `analyzeTicket()`. Demo mode (`AI_MODE=demo`, read here on the server, never
 * from the client) adds these rules, all applied BEFORE anything is persisted:
 *
 *  1. the ticket must exist and be one of the curated scenarios that has a
 *     scripted recording, so an arbitrary ticket can never create a run;
 *  2. a ticket gets at most one persisted demo run, whether it completed or
 *     failed: if one already exists it is returned (a completed run as a
 *     replay, a failed run as its stored error) and no new run is created. A
 *     failed demo run is deliberately NOT retried, so a defect cannot make
 *     anonymous clicks add a row each time; reseeding clears it;
 *  3. concurrent requests for the same ticket share one in-flight run, so a
 *     double click cannot create two;
 *  4. an unexpected server or database error is returned as a failure, never
 *     as a success, and never as a thrown error the button cannot handle.
 *
 * Limit, stated plainly: rules 2 and 3 are enforced by a database lookup plus a
 * process-local map, with no database constraint. The guarantee therefore holds
 * for a single server process (the intended public demo). It is not multi-instance-safe.
 *
 * No paid or external call can occur in demo mode: the Anthropic provider is
 * never constructed there (see registry.ts), and nothing here performs a
 * refund, email, payment or any other action. See DECISIONS.md ("Public Demo Mode").
 */
export async function requestAnalysis(ticketId: unknown): Promise<AnalysisRequestResult> {
  if (!isValidTicketId(ticketId)) {
    return { ok: false, error: "Invalid ticket identifier." };
  }

  let mode;
  try {
    mode = getAiMode();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid AI_MODE." };
  }

  if (mode === "live") {
    const result = await analyzeTicket(ticketId);
    return result.ok
      ? { ok: true, runId: result.run.orchestrationRunId, replayed: false }
      : { ok: false, error: result.error };
  }

  try {
    return await requestDemoAnalysis(ticketId);
  } catch (error) {
    // Unexpected (for example a database error). Logged for the operator; the
    // visitor gets a generic failure, never an implementation detail or a false success.
    console.error("Demo analysis request failed:", error);
    return { ok: false, error: DEMO_UNAVAILABLE_MESSAGE };
  }
}

const inFlightDemoRuns = new Map<string, Promise<AnalysisRequestResult>>();

async function requestDemoAnalysis(ticketId: string): Promise<AnalysisRequestResult> {
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, select: { scenarioKey: true } });
  if (!ticket) return { ok: false, error: "Ticket not found." };
  if (!hasDemoRecording(ticket.scenarioKey)) return { ok: false, error: DEMO_CURATED_ONLY_MESSAGE };

  const pending = inFlightDemoRuns.get(ticketId);
  if (pending) return pending;

  const run = (async (): Promise<AnalysisRequestResult> => {
    // An existing demo run is a simulated run that FAILED (a failed run persists no
    // invocations, so it has no provider to match on) or a simulated run that
    // completed with steps served by the demo provider (not merely any simulated
    // run, which could also be a test or dry-run fixture).
    const existing = await db.orchestrationRun.findFirst({
      where: {
        ticketId,
        isSimulated: true,
        OR: [
          { status: "failed" },
          { status: "completed", agentInvocations: { some: { provider: DEMO_PROVIDER_KEY } } },
        ],
      },
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true, errorMessage: true },
    });
    if (existing) {
      return existing.status === "completed"
        ? { ok: true, runId: existing.id, replayed: true }
        : { ok: false, error: existing.errorMessage ?? DEMO_PREVIOUS_FAILURE_MESSAGE };
    }

    const result = await analyzeTicket(ticketId);
    return result.ok
      ? { ok: true, runId: result.run.orchestrationRunId, replayed: false }
      : { ok: false, error: result.error };
  })().finally(() => {
    inFlightDemoRuns.delete(ticketId);
  });

  inFlightDemoRuns.set(ticketId, run);
  return run;
}
