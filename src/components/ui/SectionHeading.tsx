import type { ElementType, ReactNode } from "react";

/**
 * The two heading sizes used everywhere (see AUDIT.md, Audit #6): a section
 * title within a page ("Conversation", "Ticket volume by status") and a
 * small uppercase eyebrow label inside a card ("Customer", "Resolution").
 * Standardizes on `text-zinc-700 dark:text-zinc-300` for `SectionHeading`,
 * which a few call sites already used and a few omitted (relying on
 * inherited foreground, which reads almost the same) — a minor drift fix,
 * not a new visual choice.
 */
export function SectionHeading({
  as: As = "h2",
  id,
  children,
  className = "",
}: {
  as?: ElementType;
  /** For `aria-labelledby` on the section it titles. */
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <As id={id} className={`text-sm font-semibold text-zinc-700 dark:text-zinc-300 ${className}`}>
      {children}
    </As>
  );
}

/** Small uppercase label. Uses the muted-foreground token, which meets WCAG AA in both color schemes. */
export function Eyebrow({
  as: As = "h3",
  id,
  children,
  className = "",
}: {
  as?: ElementType;
  /** For `aria-labelledby` on the section it titles. */
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <As id={id} className={`text-xs font-semibold uppercase tracking-wide text-muted-foreground ${className}`}>
      {children}
    </As>
  );
}
