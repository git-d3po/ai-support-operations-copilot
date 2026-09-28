import { expect, test, type Page } from "@playwright/test";

/**
 * The responsive shell and page layouts (DECISIONS.md, "Responsive shell and
 * consistent navigation labels"). Measured, not screenshotted: what matters is
 * that the page never scrolls sideways, that panels never overlap, that wide
 * tables scroll inside their own box, and that every destination stays
 * reachable, at a phone width, a tablet width and the desktop baseline.
 *
 * Read-only: nothing here runs an analysis, so it does not depend on (or
 * change) the state runAnalysis.spec.ts builds up.
 */

const PHONE = { width: 390, height: 844 };
const TABLET = { width: 768, height: 1024 };
const SMALL_DESKTOP = { width: 1024, height: 768 };
const DESKTOP = { width: 1440, height: 900 };

const DESTINATIONS = [
  { href: "/inbox", label: "Inbox" },
  { href: "/operations", label: "AI Operations" },
  { href: "/evaluations", label: "Evaluations" },
  { href: "/knowledge", label: "Knowledge & Policies" },
  { href: "/settings", label: "Model Routing" },
];

/** The primary routes plus one curated and one uncurated ticket, found through the Inbox (ids are not stable). */
async function allRoutes(page: Page): Promise<string[]> {
  await page.goto("/inbox");
  const rows = page.locator("tbody tr");
  const curated = await rows.filter({ hasText: "eval: duplicate-billing" }).getByRole("link").getAttribute("href");
  const uncurated = await rows.filter({ hasNotText: "eval:" }).first().getByRole("link").getAttribute("href");
  return [...DESTINATIONS.map((d) => d.href), curated!, uncurated!];
}

/** Whether the document itself scrolls sideways (a table scrolling inside its own box does not count). */
async function documentOverflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

for (const viewport of [PHONE, TABLET]) {
  test(`no route scrolls sideways at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const route of await allRoutes(page)) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const { scrollWidth, clientWidth } = await documentOverflow(page);
      expect(scrollWidth, route).toBeLessThanOrEqual(clientWidth);
      // The page content gets the width, not what a sidebar would leave of it.
      const mainWidth = await page.getByRole("main").evaluate((el) => el.getBoundingClientRect().width);
      expect(mainWidth, route).toBeGreaterThanOrEqual(viewport.width - 20); // at most a scrollbar narrower
    }
  });
}

test("on a phone, the navigation is a compact bar above the page and reaches every destination", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/inbox");
  const nav = page.getByRole("navigation");

  // Above the content, not beside it, and a small share of the screen.
  const navBox = (await nav.boundingBox())!;
  const mainBox = (await page.getByRole("main").boundingBox())!;
  expect(mainBox.y).toBeGreaterThanOrEqual(navBox.y + navBox.height);
  expect(mainBox.x).toBeLessThanOrEqual(1);
  expect(navBox.height).toBeLessThan(PHONE.height * 0.2);

  // Every destination is directly visible (nothing to open first) and works, with the current one marked.
  for (const { label } of DESTINATIONS) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  for (const { href, label } of DESTINATIONS) {
    await nav.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
    await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator("[aria-current]")).toHaveCount(1);
  }

  // Keyboard: the links are reachable with Tab and show the focus ring.
  await page.goto("/inbox");
  await page.keyboard.press("Tab");
  await expect(nav.getByRole("link", { name: "Inbox", exact: true })).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).toBe("solid");

  // Each list keeps its accessible name from its group label, which is only visually hidden here.
  for (const group of ["Support", "AI system", "Reference", "Configuration"]) {
    await expect(nav.getByRole("list", { name: group })).toBeAttached();
  }
});

test("on a phone, ticket detail is one column: the analysis first, then the customer context, never overlapping", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/inbox");
  await page.getByRole("link", { name: "Charged twice this billing cycle" }).click();
  await expect(page).toHaveURL(/\/tickets\//);

  const analysis = (await page.getByRole("region", { name: "AI orchestration" }).boundingBox())!;
  const context = (await page.getByRole("complementary").boundingBox())!;
  // Stacked, in reading order, with nothing side by side.
  expect(context.y).toBeGreaterThanOrEqual(analysis.y + analysis.height);
  // Both use the page's width (358px of 390, inside the 16px gutters), rather than one squeezed beside the other.
  expect(analysis.width).toBeGreaterThan(PHONE.width * 0.85);
  expect(context.width).toBeGreaterThan(PHONE.width * 0.85);
  // The action is reachable and not clipped: fully on screen once scrolled to.
  const run = page.getByRole("button", { name: /^Run demo analysis/ });
  await run.scrollIntoViewIfNeeded();
  await expect(run).toBeInViewport({ ratio: 1 });
});

test("on a phone, wide tables scroll inside their own box and keep their columns", async ({ page }) => {
  await page.setViewportSize(PHONE);
  for (const [route, columns] of [
    ["/inbox", 7],
    ["/evaluations", 6],
    ["/settings", 5],
  ] as const) {
    await page.goto(route);
    const table = page.getByRole("main").getByRole("table").first();
    await expect(table.locator("thead th")).toHaveCount(columns);
    const box = await table.evaluate((el) => {
      const scroller = el.parentElement!;
      return {
        tableWidth: el.scrollWidth,
        scrollerWidth: scroller.clientWidth,
        overflowX: getComputedStyle(scroller).overflowX,
        scrollerRight: scroller.getBoundingClientRect().right,
      };
    });
    // Wider than the screen, so it scrolls, but inside its container, which ends within the page.
    expect(box.tableWidth, route).toBeGreaterThan(box.scrollerWidth);
    expect(box.overflowX, route).toBe("auto");
    expect(box.scrollerRight, route).toBeLessThanOrEqual(PHONE.width);
    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(scrollWidth, route).toBeLessThanOrEqual(clientWidth);
  }
});

test("at 1024px, beside the sidebar, the recorded Evaluations table fits without scrolling sideways", async ({ page }) => {
  // The narrowest width with the sidebar, where this six-column table is tightest: every column, the
  // Result column with each Pass badge included, is visible without scrolling the table's own box.
  await page.setViewportSize(SMALL_DESKTOP);
  await page.goto("/evaluations");
  const table = page.getByRole("table", { name: /^Recorded live evaluation/ });
  await expect(table.locator("thead th")).toHaveCount(6);
  const box = await table.evaluate((el) => {
    const scroller = el.parentElement!;
    return {
      tableWidth: el.scrollWidth,
      scrollerWidth: scroller.clientWidth,
      resultRight: el.querySelector("thead th:last-child")!.getBoundingClientRect().right,
      scrollerRight: scroller.getBoundingClientRect().right,
    };
  });
  expect(box.tableWidth).toBeLessThanOrEqual(box.scrollerWidth);
  expect(box.resultRight).toBeLessThanOrEqual(box.scrollerRight);
  const { scrollWidth, clientWidth } = await documentOverflow(page);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test("on the desktop, the sidebar and the two-column ticket layout are unchanged", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/inbox");
  const nav = page.getByRole("navigation");
  const navBox = (await nav.boundingBox())!;
  const mainBox = (await page.getByRole("main").boundingBox())!;
  // Beside the page, in the 224px sidebar.
  expect(mainBox.x).toBeGreaterThanOrEqual(224);
  expect(navBox.x + navBox.width).toBeLessThanOrEqual(mainBox.x);
  for (const group of ["Support", "AI system", "Reference", "Configuration"]) {
    await expect(nav.getByText(group, { exact: true })).toBeVisible();
  }

  await page.getByRole("link", { name: "Charged twice this billing cycle" }).click();
  await expect(page).toHaveURL(/\/tickets\//);
  const analysis = (await page.getByRole("region", { name: "AI orchestration" }).boundingBox())!;
  const context = (await page.getByRole("complementary").boundingBox())!;
  // Side by side: the customer context in its 320px column to the right of the analysis.
  expect(context.x).toBeGreaterThanOrEqual(analysis.x + analysis.width);
  expect(Math.round(context.width)).toBe(320);
});
