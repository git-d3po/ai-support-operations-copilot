"use client";

import { useId, useState, useTransition } from "react";
import { PRIMARY_ACTION_CLASSES } from "@/components/app-state";
import { Card } from "@/components/ui/Card";
import { runAnalysisAction } from "./actions";

/**
 * Shown when the request itself fails (for example, the connection drops), as
 * opposed to the server reporting a failed analysis. The result is then
 * unknown: the server may have finished the run before the response was lost.
 * A live run is not idempotent, so the operator is told to check before
 * running it again rather than told that the analysis failed.
 */
const REQUEST_FAILED_MESSAGE =
  "The analysis request did not complete, so its result is unknown. Reload the page to check whether it finished before running it again.";

/**
 * Triggers the Server Action and reflects exactly three states: idle,
 * running, or a definite result. In Demo Mode it is labeled "Run demo
 * analysis" and is disabled, with the reason shown, for tickets that have no
 * scripted recording. On failure it shows the error inline and lets the
 * operator retry — it never gets stuck spinning, because runAnalysisAction()
 * always resolves (see analyzeTicket.ts, which never throws).
 *
 * Two kinds of "unavailable", deliberately different:
 * - Permanently unavailable (`disabledReason`): native `disabled`, with the
 *   reason attached through `aria-describedby`.
 * - Busy while an analysis runs: `aria-disabled`, not `disabled`, plus a guard
 *   in the handler. A focused native button that becomes disabled drops
 *   keyboard focus to <body> (measured in the browser), so an operator who
 *   started the run from the keyboard would lose their place; `aria-disabled`
 *   keeps focus on the button while still preventing a second submission.
 *   The visible label says what is running, and a polite status region
 *   announces the start and the end to assistive technology.
 *
 * The semantic busy state above is immediate; the *visual* one (busy label,
 * spinner, dimming) is revealed only if the run is still going after 400ms, via
 * the `busy-*` animations in globals.css. A Demo Mode analysis takes ~16-21ms,
 * so without the delay its busy label flashed for a single frame on every run;
 * a live analysis takes seconds and still gets its indicator well within a
 * second. Both labels always occupy the same grid cell, so the button never
 * changes width; the hidden one is `visibility: hidden`, which also keeps it out
 * of the accessible name. See DECISIONS.md ("Loading and pending states").
 */
export function RunAnalysisButton({
  ticketId,
  hasRunBefore,
  demoMode = false,
  disabledReason = null,
}: {
  ticketId: string;
  hasRunBefore: boolean;
  /** Demo Mode (resolved on the server): the button runs a scripted replay, not a model. */
  demoMode?: boolean;
  /** When set, the action is unavailable for this ticket and this explains why. */
  disabledReason?: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const reasonId = useId();

  const noun = demoMode ? "demo analysis" : "AI analysis";

  function handleClick() {
    if (isPending) return; // busy: no duplicate submission
    setError(null);
    setCompleted(false);
    startTransition(async () => {
      try {
        const result = await runAnalysisAction(ticketId);
        if (result.ok) {
          setCompleted(true);
        } else {
          setError(`Analysis failed: ${result.error ?? "unknown reason."}`);
        }
      } catch (requestError) {
        // Without this, a failed request escapes to the route error boundary and replaces the
        // whole ticket (conversation, customer, previous analysis) with "Something went wrong".
        console.error(requestError);
        setError(REQUEST_FAILED_MESSAGE);
      }
    });
  }

  const idleLabel = `Run ${noun}${hasRunBefore ? " again" : ""}`;
  const busyLabel = `Running ${noun}…`;

  const statusMessage = isPending
    ? `Running ${noun}…`
    : completed
      ? `${demoMode ? "Demo analysis" : "AI analysis"} complete.`
      : "";

  return (
    // End-aligned, so the button stays where it is when a message appears beneath it.
    <div className="flex flex-col items-end">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabledReason !== null}
        aria-disabled={isPending || undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        className={`${PRIMARY_ACTION_CLASSES} group disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-zinc-900 dark:disabled:hover:bg-zinc-100 aria-disabled:cursor-progress aria-disabled:animate-busy-dim aria-disabled:hover:bg-zinc-900 dark:aria-disabled:hover:bg-zinc-100`}
      >
        <span className="grid">
          <span className="col-start-1 row-start-1 text-center group-aria-disabled:animate-busy-conceal">{idleLabel}</span>
          <span className="invisible col-start-1 row-start-1 inline-flex items-center justify-center gap-2 group-aria-disabled:animate-busy-reveal">
            {/* Decorative: the label says it is running. Spins only while busy; hidden, not frozen, under reduced motion. */}
            <span
              aria-hidden
              className={`size-3 shrink-0 rounded-full border-2 border-current border-t-transparent motion-reduce:hidden ${isPending ? "animate-spin" : ""}`}
            />
            {busyLabel}
          </span>
        </span>
      </button>
      <p role="status" className="sr-only">
        {statusMessage}
      </p>
      {disabledReason && (
        <p id={reasonId} className="mt-2 max-w-md text-xs text-muted-foreground">
          {disabledReason}
        </p>
      )}
      {error && (
        <div role="alert">
          <Card tone="danger" padding="sm" className="mt-2 max-w-md text-sm">
            {error}
          </Card>
        </div>
      )}
    </div>
  );
}
