import type { ReactNode, Ref } from "react";

/**
 * Focus treatment for the recovery actions: the same visible foreground ring the
 * navigation uses (see nav-link.tsx), so keyboard focus looks the same everywhere
 * a user is being moved on from a problem.
 */
const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

/** The primary action: the app's existing primary button (as on "Run analysis"). */
export const PRIMARY_ACTION_CLASSES = `inline-block rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 ${FOCUS_RING}`;

/** A secondary action: the app's existing in-text link style (as on policy citations). */
export const SECONDARY_ACTION_CLASSES = `rounded text-sm font-medium underline decoration-border underline-offset-2 hover:decoration-current ${FOCUS_RING}`;

/**
 * The layout shared by the application's own states that replace a page: not
 * found (app/not-found.tsx) and runtime error (app/error.tsx, app/global-error.tsx).
 * It uses the same header rhythm as every page (`p-6`, a `text-lg` h1, a muted
 * lead), so a state reads as another screen of the product rather than a
 * framework page, with no illustration, icon or new color.
 *
 * `headingRef` lets a client state move focus to its heading when it appears,
 * so keyboard and screen-reader users land on the explanation.
 */
export function AppState({
  title,
  children,
  actions,
  headingRef,
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="p-6">
      <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="text-lg font-semibold focus:outline-none">
        {title}
      </h1>
      <div className="mt-1 max-w-xl text-sm text-muted-foreground">{children}</div>
      <div className="mt-4 flex flex-wrap items-center gap-4">{actions}</div>
    </div>
  );
}
