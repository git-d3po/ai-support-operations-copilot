import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pathname = { current: "/operations" };
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

import RouteError from "@/app/error";
import NotFound from "@/app/not-found";

/**
 * The contract of the application's own not-found and runtime-error states
 * (app/not-found.tsx, app/error.tsx), rendered to markup in node: no DOM
 * library is needed for what is checked here. That `retry()` actually recovers
 * a failed route is verified in the browser (see DECISIONS.md, "Application
 * not-found and error states"), since it depends on Next's router.
 */
const SENSITIVE_MESSAGE =
  "PrismaClientKnownRequestError: no such table: Ticket at /srv/app/src/lib/db.ts ANTHROPIC_API_KEY=sk-ant-test";

function renderError(digest?: string) {
  const error = Object.assign(new Error(SENSITIVE_MESSAGE), digest ? { digest } : {});
  return renderToStaticMarkup(createElement(RouteError, { error, retry: vi.fn() }));
}

describe("runtime-error state (app/error.tsx)", () => {
  beforeEach(() => {
    pathname.current = "/operations";
  });

  it("says something went wrong, with a heading and both recovery paths", () => {
    const html = renderError();
    expect(html).toContain("<h1");
    expect(html).toContain("Something went wrong");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Try again<\/button>/);
    expect(html).toMatch(/<a[^>]*href="\/inbox"[^>]*>Go to the Inbox<\/a>/);
  });

  it("never renders the error's message or anything from it", () => {
    const html = renderError("123456789");
    for (const fragment of ["Prisma", "no such table", "/srv/app", "db.ts", "ANTHROPIC_API_KEY", "sk-ant"]) {
      expect(html).not.toContain(fragment);
    }
  });

  it("on the Inbox itself, offers only Try again: the Inbox link would lead back to the same failure", () => {
    pathname.current = "/inbox";
    const html = renderError();
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
    expect(html).not.toContain('href="/inbox"');
    expect(html).toContain("This page couldn&#x27;t be loaded. Try again.");
  });

  it("shows the opaque digest as a reference only when Next provides one", () => {
    expect(renderError("123456789")).toContain("Error reference: 123456789");
    expect(renderError()).not.toContain("Error reference");
  });
});

describe("not-found state (app/not-found.tsx)", () => {
  it("says the page was not found and links to the Inbox, without framing it as a failure", () => {
    const html = renderToStaticMarkup(createElement(NotFound));
    expect(html).toContain("<h1");
    expect(html).toContain("Page not found");
    expect(html).toMatch(/<a[^>]*href="\/inbox"[^>]*>Go to the Inbox<\/a>/);
    expect(html).not.toMatch(/something went wrong|error|try again/i);
  });
});
