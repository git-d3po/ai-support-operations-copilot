"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItemState, type NavItem } from "@/lib/navigation";

/**
 * One navigation link, aware of the current route. The only client component in
 * the shell: `usePathname()` is Next's routing API for "where am I", so no state
 * or effects are needed, and the active state updates on client-side navigation.
 *
 * Active is communicated three ways besides color: a background fill, a heavier
 * weight, and a leading bar. Screen readers get native `aria-current`: `page` on
 * the destination itself, `true` when the current page is inside its area (a
 * ticket, for Inbox), since that ticket is not the Inbox page itself.
 */
export function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname() ?? "";
  const state = navItemState(pathname, item);

  return (
    <Link
      href={item.href}
      aria-current={state === "page" ? "page" : state === "section" ? "true" : undefined}
      className={[
        "relative block rounded px-2 py-1.5 text-sm",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
        state
          ? "bg-zinc-200 font-medium text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-foreground dark:bg-zinc-800"
          : "text-zinc-700 hover:bg-zinc-100 hover:text-foreground dark:text-zinc-300 dark:hover:bg-zinc-800/60",
      ].join(" ")}
    >
      {item.label}
    </Link>
  );
}
