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

test("keyboard only: from the Inbox into a ticket, through its analysis and its agent trace", async ({ page }) => {
  const focusedText = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  const tabUntil = async (text: string | RegExp) => {
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const focused = await focusedText();
      if (typeof text === "string" ? focused === text : text.test(focused)) return;
    }
    throw new Error(`Tab never reached ${text}`);
  };

  // One stop per Inbox row: the row's ticket link, with the focus ring drawn around the row.
  await page.goto("/inbox");
  await tabUntil("Charged twice this billing cycle");
  expect(await page.evaluate(() => getComputedStyle(document.activeElement!, "::after").outlineStyle)).toBe("solid");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tickets\//);

  // "Run analysis" is a real button with a visible focus ring. (Its label depends on whether this
  // ticket already has a run: this test does not rely on another test having run first.)
  await tabUntil(/^Run demo analysis( again)?$/);
  expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).toBe("solid");

  // Slow the Server Action down so the busy state can be observed (a demo replay otherwise takes ~30ms).
  await page.route("**/tickets/**", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  let actionPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") actionPosts++;
  });

  await page.keyboard.press("Enter");
  const busy = page.getByRole("button", { name: "Running demo analysis…" });
  await expect(busy).toHaveAttribute("aria-disabled", "true");
  await expect(busy).toBeFocused(); // busy, but focus is not dropped to the page
  await page.keyboard.press("Enter"); // pressed again while busy: must not submit twice

  const done = page.getByRole("button", { name: "Run demo analysis again" });
  await expect(done).toBeFocused({ timeout: 10_000 });
  await expect(done).not.toHaveAttribute("aria-disabled");
  expect(actionPosts).toBe(1);
  await expect(page.getByRole("status").filter({ hasText: "Demo analysis complete." })).toBeAttached();

  // The agent trace is a native disclosure, operable from the keyboard.
  await page.keyboard.press("Tab");
  await expect(page.getByText("Agent trace (4 steps)")).toBeFocused();
  await expect(page.getByText("Billing Agent")).toBeHidden();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Billing Agent")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Billing Agent")).toBeHidden();
});

test("clicking anywhere on an Inbox row opens that row's ticket, through its one link", async ({ page }) => {
  await page.goto("/inbox");
  const row = page.locator("tbody tr").filter({ hasText: "Refund request — upgraded by mistake" });
  // The customer cell, not the subject link.
  const box = (await row.locator("td").nth(1).boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // What is under the pointer there is the row's own ticket link (no second interactive element).
  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return { tag: el?.tagName, text: el?.textContent?.trim() };
  }, point);
  expect(hit).toEqual({ tag: "A", text: "Refund request — upgraded by mistake" });
  await expect(row.locator("a, button")).toHaveCount(1);

  await page.mouse.click(point.x, point.y);
  await expect(page).toHaveURL(/\/tickets\//);
  await expect(page.getByRole("heading", { level: 1, name: "Refund request — upgraded by mistake" })).toBeVisible();
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
