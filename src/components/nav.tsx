import { Eyebrow } from "@/components/ui/SectionHeading";
import { NAV_GROUPS } from "@/lib/navigation";
import { NavLink } from "./nav-link";

const groupId = (label: string) => `nav-group-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/**
 * The application shell's navigation: the Halcyon workspace identity, then the
 * primary navigation grouped by what the operator is doing (the support work
 * itself, the AI system's operation and evaluation, reference knowledge,
 * configuration). The destinations and active-route rules live in
 * src/lib/navigation.ts; only each link reads the current route (see NavLink),
 * so this component stays a server component.
 *
 * One markup, two layouts (DECISIONS.md, "Responsive shell and consistent
 * navigation labels"):
 * - From `lg` (1024px): the sidebar, a fixed-width column beside the page.
 * - Below `lg`: a compact bar above the page. The identity and the links wrap
 *   onto as many rows as the width needs (one row at tablet width, two on a
 *   phone), so every destination stays one tap away with nothing to open first
 *   and no script. Group labels are visually hidden there but still name their
 *   lists for assistive technology.
 *
 * Structure notes:
 * - A plain `div`, not `<aside>`: the ticket page already has a complementary
 *   landmark (its customer/account context), and a second would be ambiguous.
 * - The identity sits outside `<nav>`, because it is not navigation.
 * - Group labels are not headings (they would enter the page's heading outline
 *   and collide with page titles such as "AI Operations"). Each list takes its
 *   accessible name from its label instead.
 * - It sits on the `surface` token with a `border` edge, so it reads as a distinct
 *   surface from the page in both color schemes (see globals.css).
 */
export function Nav() {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-surface px-4 py-3 lg:w-56 lg:shrink-0 lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-0 lg:border-r lg:border-b-0 lg:px-3 lg:py-4">
      <div className="lg:mb-6 lg:px-2">
        <p className="text-sm font-semibold text-foreground">Halcyon</p>
        <p className="text-xs text-muted-foreground">Support Ops Copilot</p>
      </div>

      <nav className="flex flex-wrap gap-x-3 gap-y-1 lg:flex-col lg:flex-nowrap lg:gap-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <Eyebrow as="p" id={groupId(group.label)} className="max-lg:sr-only lg:px-2">
              {group.label}
            </Eyebrow>
            <ul aria-labelledby={groupId(group.label)} className="flex flex-wrap gap-0.5 lg:mt-1.5 lg:flex-col">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
