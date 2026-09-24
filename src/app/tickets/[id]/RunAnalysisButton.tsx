"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/Card";
import { runAnalysisAction } from "./actions";

/**
 * Triggers the Server Action and reflects exactly three states: idle,
 * running (disabled + "Running…"), or a definite result. In Demo Mode it is
 * labeled "Run demo analysis" and is disabled, with the reason shown, for
 * tickets that have no scripted recording. On failure it
 * shows the error inline and lets the operator retry — it never gets
 * stuck spinning, because runAnalysisAction() always resolves (see
 * analyzeTicket.ts, which never throws).
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

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await runAnalysisAction(ticketId);
      if (!result.ok) {
        setError(result.error ?? "Analysis failed for an unknown reason.");
      }
    });
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={isPending || disabledReason !== null}
        className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "Running…" : `${demoMode ? "Run demo analysis" : "Run AI analysis"}${hasRunBefore ? " again" : ""}`}
      </button>
      {disabledReason && <p className="mt-2 max-w-md text-xs text-muted-foreground">{disabledReason}</p>}
      {error && (
        <Card tone="danger" padding="sm" className="mt-2 max-w-md text-sm">
          Analysis failed: {error}
        </Card>
      )}
    </div>
  );
}
