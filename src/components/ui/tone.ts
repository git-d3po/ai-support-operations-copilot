/**
 * The app's one semantic-color map, consumed by `Badge` and `Card`. Every
 * tone was already in use, scattered across pages as hand-retyped Tailwind
 * strings (see AUDIT.md, Audit #6, DES-7) — this is that same palette named
 * once. Two changes from what was there before:
 *  - "simulated / not real" moves from purple to `info` (blue): the user
 *    dislikes purple and indigo, and blue is otherwise unused, so it can't
 *    collide with anything else here.
 *  - the "this ticket is a curated eval scenario" tag moves from indigo to
 *    `neutral`: it's inert metadata, not a status, and indigo was reading as
 *    the same color as the (then-purple) "simulated" warning at a glance
 *    (DES-8) — a real ambiguity this removes rather than just recolors.
 * No tone here is purple or indigo, and none will be added without updating
 * this comment.
 */
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

/** Compact pill (`Badge`): filled background, no border. */
export const BADGE_TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  danger: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

/** Block panel (`Card`): a tinted border, and — for anything but neutral — a
 * tinted fill and matching text color, so a notice reads at a glance without
 * needing to read its label first. */
export const PANEL_TONE_CLASSES: Record<Tone, { border: string; fill: string }> = {
  neutral: { border: "border-border", fill: "" },
  info: {
    border: "border-blue-200 dark:border-blue-900",
    fill: "bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  },
  success: {
    border: "border-emerald-200 dark:border-emerald-900",
    fill: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  warning: {
    border: "border-amber-200 dark:border-amber-900",
    fill: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  danger: {
    border: "border-red-200 dark:border-red-900",
    fill: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300",
  },
};
