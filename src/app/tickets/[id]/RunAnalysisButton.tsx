"use client";

import { useId, useState, useTransition } from "react";
import { PRIMARY_ACTION_CLASSES } from "@/components/app-state";
import { Card } from "@/components/ui/Card";
import { runAnalysisAction } from "./actions";

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
      const result = await runAnalysisAction(ticketId);
      if (result.ok) {
        setCompleted(true);
      } else {
        setError(result.error ?? "Analysis failed for an unknown reason.");
      }
    });
  }

  const statusMessage = isPending
    ? `Running ${noun}…`
    : completed
      ? `${demoMode ? "Demo analysis" : "AI analysis"} complete.`
      : "";

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabledReason !== null}
        aria-disabled={isPending || undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        className={`${PRIMARY_ACTION_CLASSES} inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-zinc-900 dark:disabled:hover:bg-zinc-100 aria-disabled:cursor-progress aria-disabled:opacity-80 aria-disabled:hover:bg-zinc-900 dark:aria-disabled:hover:bg-zinc-100`}
      >
        {isPending && (
          // Decorative: the label already says it is running. Hidden, not frozen, under reduced motion.
          <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:hidden" />
        )}
        {isPending ? `Running ${noun}…` : `Run ${noun}${hasRunBefore ? " again" : ""}`}
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
            Analysis failed: {error}
          </Card>
        </div>
      )}
    </div>
  );
}
