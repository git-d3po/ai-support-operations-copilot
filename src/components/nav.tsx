import { Eyebrow } from "@/components/ui/SectionHeading";
import { NAV_GROUPS } from "@/lib/navigation";
import { NavLink } from "./nav-link";

const groupId = (label: string) => `nav-group-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/**
 * The application shell's sidebar: the Halcyon workspace identity, then the
 * primary navigation grouped by what the operator is doing (the support work
 * itself, the AI's operation and evaluation, reference knowledge,
 * administration). The destinations and active-route rules live in
 * src/lib/navigation.ts; only each link reads the current route (see NavLink),
 * so this component stays a server component.
 *
 * Structure notes:
 * - A plain `div`, not `<aside>`: the ticket page already has a complementary
 *   landmark (its customer/account context), and a second would be ambiguous.
 * - The identity sits outside `<nav>`, because it is not navigation.
 * - Group labels are not headings (they would enter the page's heading outline
 *   and collide with page titles such as "AI Operations"). Each list takes its
 *   accessible name from its visible label instead.
 * - It sits on the `surface` token with a `border` edge, so it reads as a distinct
 *   surface from the page in both color schemes (see globals.css).
 */
export function Nav() {
  return (
    <div className="flex w-56 shrink-0 flex-col border-r border-border bg-surface px-3 py-4">
      <div className="mb-6 px-2">
        <p className="text-sm font-semibold text-foreground">Halcyon</p>
        <p className="text-xs text-muted-foreground">Support Ops Copilot</p>
      </div>

      <nav className="flex flex-col gap-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <Eyebrow as="p" id={groupId(group.label)} className="px-2">
              {group.label}
            </Eyebrow>
            <ul aria-labelledby={groupId(group.label)} className="mt-1.5 flex flex-col gap-0.5">
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
