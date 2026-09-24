import type { ReactNode } from "react";
import { BADGE_TONE_CLASSES, type Tone } from "./tone";

/**
 * The small colored status pill used throughout the app (ticket status,
 * agent-invocation status, simulated/eval markers, pass/fail). Replaces the
 * identical `rounded bg-X-100 px-1.5 py-0.5 text-xs font-medium text-X-800
 * dark:bg-X-950 dark:text-X-300` string that was hand-retyped per usage —
 * see AUDIT.md, Audit #6, DES-7/DES-8.
 */
export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${BADGE_TONE_CLASSES[tone]} ${className}`}>
      {children}
    </span>
  );
}
