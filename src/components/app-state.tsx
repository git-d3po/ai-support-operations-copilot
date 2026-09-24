import type { ReactNode, Ref } from "react";

/*
 * Keyboard focus for these actions comes from the global focus rule in
 * globals.css, shared by every control in the app.
 */

/** The primary action: the app's primary button, shared with "Run analysis". */
export const PRIMARY_ACTION_CLASSES =
  "inline-block rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";

/**
 * The app's in-text link: an underline in the muted-foreground token, so a link is recognizable at rest
 * (the earlier `border`-colored underline measured ~1.3:1 against the page and read as plain text), and
 * the full text color on hover. Used for policy citations and other links inside prose or tables.
 */
export const LINK_CLASSES =
  "rounded underline decoration-muted-foreground underline-offset-2 transition-colors hover:decoration-current";

/** A secondary action: the in-text link style at action weight. */
export const SECONDARY_ACTION_CLASSES = `text-sm font-medium ${LINK_CLASSES}`;

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
