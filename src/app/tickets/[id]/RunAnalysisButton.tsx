"use client";

import { useState, useTransition } from "react";
import { runAnalysisAction } from "./actions";

/**
 * Triggers the Server Action and reflects exactly three states: idle,
 * running (disabled + "Running…"), or a definite result. On failure it
 * shows the error inline and lets the operator retry — it never gets
 * stuck spinning, because runAnalysisAction() always resolves (see
 * analyzeTicket.ts, which never throws).
 */
export function RunAnalysisButton({ ticketId, hasRunBefore }: { ticketId: string; hasRunBefore: boolean }) {
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
        disabled={isPending}
        className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "Running…" : hasRunBefore ? "Run AI analysis again" : "Run AI analysis"}
      </button>
      {error && (
        <p className="mt-2 max-w-md rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          Analysis failed: {error}
        </p>
      )}
    </div>
  );
}
