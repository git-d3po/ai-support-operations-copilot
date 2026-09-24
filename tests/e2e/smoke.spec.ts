import { test, expect } from "@playwright/test";

/**
 * Deterministic regression smoke test for the foundation phase: every top
 * -level route renders against the seeded (reproducible) database. This is
 * intentionally not a visual test yet — it exists to catch "the page
 * doesn't render" regressions as real product features land on top of it.
 */

test("root redirects to the inbox", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
});

test("the navigation shows the Halcyon workspace and marks exactly the current destination", async ({ page }) => {
  const destinations = [
    { route: "/inbox", link: "Inbox" },
    { route: "/operations", link: "Operations" },
    { route: "/evaluations", link: "Evaluations" },
    { route: "/knowledge", link: "Knowledge" },
    { route: "/settings", link: "Settings" },
  ];
  for (const { route, link } of destinations) {
    await page.goto(route);
    const nav = page.getByRole("navigation");
    await expect(page.getByText("Halcyon", { exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: link, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator("[aria-current]")).toHaveCount(1);
  }

  // A ticket is worked from the Inbox: Inbox is marked as the current section, not the current page.
  await page.goto("/inbox");
  await page.getByRole("link", { name: "Charged twice this billing cycle" }).click();
  await expect(page).toHaveURL(/\/tickets\//);
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("link", { name: "Inbox", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(nav.locator("[aria-current]")).toHaveCount(1);
});

test("an unknown address shows the not-found state inside the application shell", async ({ page }) => {
  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);

  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  // It is not presented as a failure.
  await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  // The shell stays: navigation (with nothing marked current) and the Demo Mode banner.
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByRole("navigation").locator("[aria-current]")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Demo Mode" })).toBeVisible();

  await page.getByRole("link", { name: "Go to the Inbox" }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
});

test("an unknown ticket id resolves to the same not-found state, within the Inbox area", async ({ page }) => {
  const response = await page.goto("/tickets/does-not-exist");
  expect(response?.status()).toBe(404);

  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("link", { name: "Inbox", exact: true })).toHaveAttribute("aria-current", "true");
});

test("the Demo Mode banner is visible on every page", async ({ page }) => {
  for (const route of ["/inbox", "/operations", "/evaluations", "/knowledge", "/settings"]) {
    await page.goto(route);
    await expect(page.getByRole("status").filter({ hasText: "Demo Mode — synthetic data, scripted replay, no model is called" })).toBeVisible();
  }
});

test("inbox lists the seeded tickets, including all 11 curated evaluation scenarios", async ({ page }) => {
  await page.goto("/inbox");
  await expect(page.getByText(/\d+ tickets\./)).toBeVisible();
  await expect(page.getByText("eval: password-reset")).toBeVisible();
  await expect(page.getByText("eval: multi-domain")).toBeVisible();
  await expect(page.getByText("eval: out-of-window-refund")).toBeVisible();
  await expect(page.getByText(/^eval: /)).toHaveCount(11);
});

test("opening a curated ticket shows the customer, conversation, and account context", async ({ page }) => {
  // Uses a different ticket than runAnalysis.spec.ts (which runs AI
  // analysis on "Charged twice this billing cycle") so this test's
  // "not yet analyzed" assertion never depends on suite run order.
  await page.goto("/inbox");
  await page.getByRole("link", { name: /Refund request — upgraded by mistake/i }).click();
  await expect(page).toHaveURL(/\/tickets\//);
  // The customer/account context panel (the aside). Scoped to it because the
  // customer's name also appears as the author of their message.
  const context = page.getByRole("complementary");
  await expect(context.getByText("Sam Okafor", { exact: true })).toBeVisible();
  await expect(context.getByText("Vertexcraft", { exact: true })).toBeVisible();
  await expect(context.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByText(/refund/i).first()).toBeVisible();
  await expect(page.getByText("No AI analysis has been run on this ticket yet.")).toBeVisible();
});

test("AI Operations page renders real, database-backed ticket volume", async ({ page }) => {
  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "AI Operations" })).toBeVisible();
  await expect(page.getByText("Ticket volume by status")).toBeVisible();
});

test("Evaluations page lists all 11 curated scenarios", async ({ page }) => {
  await page.goto("/evaluations");
  await expect(page.getByRole("heading", { name: "Evaluations" })).toBeVisible();
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(11);
});

test("Evaluations distinguishes Demo Mode from historical live results and never presents demo replays as a score", async ({ page }) => {
  await page.goto("/evaluations");
  await expect(page.getByText(/no historical live results are included in this Demo Mode deployment/)).toBeVisible();
  await expect(page.getByText(/scripted replays and are never evaluation results/)).toBeVisible();
});

test("Knowledge page lists seeded policies and product docs", async ({ page }) => {
  await page.goto("/knowledge");
  await expect(page.getByText("Refund Policy")).toBeVisible();
  await expect(page.getByText("Known Issue: Automations Time Out on Large Boards")).toBeVisible();
});

test("Settings page shows real model routing config", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("claude-sonnet-5").first()).toBeVisible();
});
