import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navItemState } from "@/lib/navigation";

/**
 * The navigation model (src/lib/navigation.ts): the information architecture,
 * that every destination is a real route, and which destination each URL
 * belongs to. Pure; no rendering.
 */
const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
const item = (href: string) => ALL_ITEMS.find((i) => i.href === href)!;
const activeFor = (pathname: string) =>
  ALL_ITEMS.filter((i) => navItemState(pathname, i) !== null).map((i) => ({ href: i.href, state: navItemState(pathname, i) }));

describe("information architecture", () => {
  it("groups the destinations as Operations / AI Operations / Knowledge / Administration", () => {
    expect(NAV_GROUPS.map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ["Operations", ["Inbox"]],
      ["AI Operations", ["Operations", "Evaluations"]],
      ["Knowledge", ["Knowledge"]],
      ["Administration", ["Settings"]],
    ]);
  });

  it("links only to routes that exist in src/app (none invented)", () => {
    const appDir = path.resolve(__dirname, "../../src/app");
    for (const { href } of ALL_ITEMS) {
      expect(existsSync(path.join(appDir, href, "page.tsx")), href).toBe(true);
    }
  });
});

describe("navItemState: which destination the current URL belongs to", () => {
  it("marks each destination as the current page on its own route, and nothing else", () => {
    for (const { href } of ALL_ITEMS) {
      expect(activeFor(href)).toEqual([{ href, state: "page" }]);
    }
  });

  it("places ticket detail pages in the Inbox area, as a section rather than the page itself", () => {
    expect(activeFor("/tickets/cmuf095zv00147kr6unwc8tjs")).toEqual([{ href: "/inbox", state: "section" }]);
  });

  it("ignores a trailing slash", () => {
    expect(navItemState("/settings/", item("/settings"))).toBe("page");
  });

  it("matches whole path segments only, so a lookalike path is not inside a destination", () => {
    expect(activeFor("/knowledge-base")).toEqual([]);
    expect(activeFor("/inboxes")).toEqual([]);
    expect(activeFor("/ticketsfoo/1")).toEqual([]);
  });

  it("treats a deeper path under a destination as inside its section", () => {
    expect(navItemState("/evaluations/some-case", item("/evaluations"))).toBe("section");
  });
});
