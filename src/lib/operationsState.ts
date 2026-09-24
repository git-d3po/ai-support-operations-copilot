import type { AiMode } from "@/lib/ai/mode";

/**
 * What the AI Operations page is showing, derived from the app's mode and how
 * many real-model (non-simulated) runs exist. Pure, so all three states are
 * unit-tested without creating any runs.
 *
 * The run metrics count real-model runs only; simulated runs (Demo Mode
 * scripted replays and fixture runs) are always excluded. So an empty page means
 * different things depending on why:
 * - `demo-no-real-runs`: Demo Mode, and nothing real to count. Empty by design;
 *   the page must say so, and must not present simulated runs as activity.
 * - `no-real-runs`: live mode, and nothing has run yet. Nothing to explain about
 *   Demo Mode, which is not the reason.
 * - `has-real-runs`: there is real activity to show (in either mode), so the
 *   metrics speak for themselves.
 */
export type OperationsDataState = "demo-no-real-runs" | "no-real-runs" | "has-real-runs";

export function operationsDataState(mode: AiMode, realRunCount: number): OperationsDataState {
  if (realRunCount > 0) return "has-real-runs";
  return mode === "demo" ? "demo-no-real-runs" : "no-real-runs";
}

/** "1 simulated run is" / "3 simulated runs are": the count of runs excluded from the metrics. */
export function describeSimulatedRuns(count: number): string {
  return count === 1 ? "1 simulated run is" : `${count} simulated runs are`;
}
