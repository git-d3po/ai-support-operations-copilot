import type { ReactNode } from "react";
import { PANEL_TONE_CLASSES, type Tone } from "./tone";

const PADDING_CLASSES = { sm: "p-2", md: "p-3", lg: "p-4" } as const;

/**
 * The bordered panel used for every card, notice box, and section in the
 * app (customer/account summary, agent findings, the "simulated run"
 * notice, empty states). Replaces the near-identical `rounded border
 * border-zinc-200 p-3|p-4 dark:border-zinc-800` string that was hand-retyped
 * across 9+ places — see AUDIT.md, Audit #6, DES-7.
 *
 * `tone="neutral"` (the default) is a structural card: a border only, no
 * fill, no forced text color, separated from the page by the `border` token.
 * A non-neutral tone additionally tints the border and fills the background —
 * for a notice, not a structural card.
 *
 * `surface` lifts a neutral card onto the `surface` token: for context and
 * decision panels (the ticket's customer/account aside, the recommendation),
 * not for every card, so the lift keeps meaning something. See globals.css.
 */
export function Card({
  children,
  tone = "neutral",
  padding = "md",
  dashed = false,
  surface = false,
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  padding?: keyof typeof PADDING_CLASSES;
  /** The "nothing here yet" empty-state style: a dashed neutral border, ignoring `tone`. */
  dashed?: boolean;
  /** Raise a neutral card onto the `surface` token. Ignored for tinted tones, which carry their own fill. */
  surface?: boolean;
  className?: string;
}) {
  const { border, fill } = PANEL_TONE_CLASSES[tone];
  const borderClasses = dashed ? "border-dashed border-zinc-300 dark:border-zinc-700" : border;
  const fillClasses = tone === "neutral" && surface && !dashed ? "bg-surface" : fill;

  return (
    <div className={["rounded border", borderClasses, fillClasses, PADDING_CLASSES[padding], className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
