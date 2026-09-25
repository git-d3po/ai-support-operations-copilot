import type { ReactNode } from "react";

/**
 * The container for a table that can be wider than the page column: on a
 * narrow screen the table scrolls sideways inside this box, and the page
 * itself never scrolls horizontally. At a width where the table fits, it adds
 * nothing visible. The Inbox's original pattern, shared so every wide table
 * behaves the same way.
 *
 * The table keeps its own semantics and styling; give it a `min-w-*` only when
 * its columns would otherwise squeeze into unreadable text before overflowing.
 *
 * `relative` is load-bearing: it makes this box the containing block of any
 * absolutely positioned content in the table, such as `sr-only` header text.
 * Without it that text is positioned against the page instead, escapes the
 * scroll box's clipping and widens the whole document (measured: the Inbox's
 * hidden "recommendation" header text made a 390px page 639px wide).
 */
export function TableScroll({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`relative overflow-x-auto ${className}`}>{children}</div>;
}
