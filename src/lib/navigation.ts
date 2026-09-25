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

/**
 * Each item's label is its page's name: the same words as that page's `<h1>`
 * and document title, so the link, the heading and the browser tab agree. No
 * group shares a name with one of its own items. URLs are stable identifiers
 * and do not follow the labels: the model-routing page stays at `/settings`.
 * See DECISIONS.md ("Responsive shell and consistent navigation labels").
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  { label: "Support", items: [{ href: "/inbox", label: "Inbox", sectionPrefixes: ["/tickets"] }] },
  {
    label: "AI system",
    items: [
      { href: "/operations", label: "AI Operations" },
      { href: "/evaluations", label: "Evaluations" },
    ],
  },
  { label: "Reference", items: [{ href: "/knowledge", label: "Knowledge & Policies" }] },
  { label: "Configuration", items: [{ href: "/settings", label: "Model Routing" }] },
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
