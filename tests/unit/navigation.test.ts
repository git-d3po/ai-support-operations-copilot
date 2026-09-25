import { existsSync, readFileSync } from "node:fs";
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
  it("groups the destinations as Support / AI system / Reference / Configuration", () => {
    expect(NAV_GROUPS.map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ["Support", ["Inbox"]],
      ["AI system", ["AI Operations", "Evaluations"]],
      ["Reference", ["Knowledge & Policies"]],
      ["Configuration", ["Model Routing"]],
    ]);
  });

  it("never gives a group the same name as one of its own destinations", () => {
    for (const group of NAV_GROUPS) {
      expect(group.items.map((i) => i.label), group.label).not.toContain(group.label);
    }
  });

  it("keeps the existing URLs: labels changed, routes did not", () => {
    expect(ALL_ITEMS.map((i) => i.href)).toEqual(["/inbox", "/operations", "/evaluations", "/knowledge", "/settings"]);
  });

  it("labels each destination with its page's own name (the page <h1> and document title)", () => {
    const appDir = path.resolve(__dirname, "../../src/app");
    for (const { href, label } of ALL_ITEMS) {
      const source = readFileSync(path.join(appDir, href, "page.tsx"), "utf8");
      const heading = source.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1].replace(/&amp;/g, "&");
      const title = source.match(/metadata: Metadata = \{ title: "([^"]+)" \}/)?.[1];
      expect({ href, heading, title }).toEqual({ href, heading: label, title: label });
    }
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
