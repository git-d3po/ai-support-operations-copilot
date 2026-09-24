import Link from "next/link";

const NAV_ITEMS = [
  { href: "/inbox", label: "Inbox" },
  { href: "/operations", label: "AI Operations" },
  { href: "/evaluations", label: "Evaluations" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/settings", label: "Settings" },
] as const;

/**
 * Minimal navigation shell for the foundation phase — enough structure for
 * every product surface in PRODUCT_SPEC.md to be reachable and for
 * Playwright to assert against, without investing in visual design yet
 * (see TODO.md, "UI implementation phase").
 */
export function Nav() {
  return (
    <nav className="w-56 shrink-0 border-r border-border bg-surface px-3 py-4">
      <div className="mb-4 px-2 text-sm font-semibold text-foreground">
        AI Support Ops Copilot
      </div>
      <ul className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="block rounded px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
