/**
 * The application's navigation model: which destinations exist, how they are
 * grouped, and which one the current URL belongs to. Pure data and functions,
 * so the active-route rules are unit-tested without rendering.
 *
 * Every `href` is an existing route under src/app (a unit test checks this);
 * none is invented. `/` is not a destination: it only redirects to `/inbox`.
 */

export type NavItem = {
  href: string;
  label: string;
  /**
   * Other route prefixes that belong to this destination's area. Ticket detail
   * lives at `/tickets/[id]`, a sibling of `/inbox` rather than a child of it,
   * but a ticket is opened from the Inbox and worked there, so it belongs to
   * the Inbox area.
   */
  sectionPrefixes?: readonly string[];
};

export type NavGroup = { label: string; items: readonly NavItem[] };

export const NAV_GROUPS: readonly NavGroup[] = [
  { label: "Operations", items: [{ href: "/inbox", label: "Inbox", sectionPrefixes: ["/tickets"] }] },
  {
    label: "AI Operations",
    items: [
      { href: "/operations", label: "Operations" },
      { href: "/evaluations", label: "Evaluations" },
    ],
  },
  { label: "Knowledge", items: [{ href: "/knowledge", label: "Knowledge" }] },
  { label: "Administration", items: [{ href: "/settings", label: "Settings" }] },
];

/**
 * How a nav item relates to the current URL:
 * - `page`: the URL is this destination itself;
 * - `section`: the URL is inside this destination's area (e.g. a ticket, for Inbox);
 * - `null`: unrelated.
 * Prefixes match whole path segments only, so `/knowledge-base` would not
 * count as inside `/knowledge`.
 */
export function navItemState(pathname: string, item: NavItem): "page" | "section" | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === item.href) return "page";
  const within = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  if (path.startsWith(`${item.href}/`)) return "section";
  if (item.sectionPrefixes?.some(within)) return "section";
  return null;
}
