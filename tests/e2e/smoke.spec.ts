import { test, expect, type Page } from "@playwright/test";

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
    { route: "/operations", link: "AI Operations" },
    { route: "/evaluations", link: "Evaluations" },
    { route: "/knowledge", link: "Knowledge & Policies" },
    { route: "/settings", link: "Model Routing" },
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
  // innerText, not textContent: it is what is rendered (it skips visibility:hidden text, such as the
  // run button's inactive label, just as the accessible name does).
  const focusedText = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText?.trim() ?? "");
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

  // In reading order, the next stop is the policy the recommendation cites, then the agent trace.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("region", { name: "Recommendation" }).getByRole("link", { name: "Duplicate Charge Policy" })).toBeFocused();

  // The agent trace is a native disclosure, operable from the keyboard.
  await page.keyboard.press("Tab");
  await expect(page.getByText("Agent trace (4 steps)")).toBeFocused();
  await expect(page.getByText("Billing Agent")).toBeHidden();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Billing Agent")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Billing Agent")).toBeHidden();
});

test("a quick analysis does not flash a busy label or change the button's size", async ({ page }) => {
  // A Demo Mode analysis normally finishes in ~20ms. Slowing the Server Action by only 100ms keeps the
  // run in flight long enough to observe, while staying well under the 400ms visual threshold
  // (globals.css, "busy-*"), so this cannot turn flaky on a slow machine. (The keyboard test above covers
  // the other side: its 800ms run does reveal the busy label.)
  await page.goto("/inbox");
  await page.getByRole("link", { name: "Charged twice this billing cycle" }).click();
  await expect(page).toHaveURL(/\/tickets\//);
  await page.route("**/tickets/**", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 100));
    await route.continue();
  });

  const button = page.getByRole("button", { name: /^Run demo analysis/ });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("main button")][0] as HTMLButtonElement;
    const busyLabel = btn.querySelectorAll(":scope > span > span")[1];
    const frames: { busy: boolean; busyVisible: boolean; width: number }[] = [];
    (window as unknown as { __frames: typeof frames }).__frames = frames;
    const t0 = performance.now();
    const tick = () => {
      frames.push({
        busy: btn.getAttribute("aria-disabled") === "true",
        busyVisible: getComputedStyle(busyLabel).visibility === "visible",
        width: Math.round(btn.getBoundingClientRect().width),
      });
      if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await button.click();
  await expect(page.getByRole("status").filter({ hasText: "Demo analysis complete." })).toBeAttached();
  await page.waitForTimeout(1600); // let the frame recorder finish its fixed window

  const frames = await page.evaluate(() => (window as unknown as { __frames: { busy: boolean; busyVisible: boolean; width: number }[] }).__frames);
  expect(frames.some((f) => f.busy)).toBe(true); // the run really was in flight...
  expect(frames.some((f) => f.busyVisible)).toBe(false); // ...but too briefly to show a busy label
  expect(new Set(frames.map((f) => f.width)).size).toBe(1); // and the button never changed width
});

test("a failed analysis request is announced inline and keeps the ticket on screen", async ({ page }) => {
  await page.goto("/inbox");
  await page.getByRole("link", { name: "Charged twice this billing cycle" }).click();
  await expect(page).toHaveURL(/\/tickets\//);
  // The request never reaches the server (a dropped connection).
  await page.route("**/tickets/**", (route) => (route.request().method() === "POST" ? route.abort("connectionreset") : route.continue()));

  const button = page.getByRole("button", { name: /^Run demo analysis/ });
  await button.focus();
  await page.keyboard.press("Enter");

  // Inline, as an alert, and honest that the result is unknown (not "the analysis failed"). Scoped to the
  // section: Next's own route announcer is also role="alert" after a client-side navigation.
  await expect(page.getByRole("region", { name: "AI orchestration" }).getByRole("alert")).toHaveText(
    "The analysis request did not complete, so its result is unknown. Reload the page to check whether it finished before running it again.",
  );
  // The ticket is still on screen: not replaced by the route's "Something went wrong" state.
  await expect(page.getByRole("heading", { level: 1, name: "Charged twice this billing cycle" })).toBeVisible();
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  // The control is usable again, still focused, and no completion was announced.
  await expect(button).toBeFocused();
  await expect(button).not.toHaveAttribute("aria-disabled");
  await expect(page.getByRole("status").filter({ hasText: "complete" })).toHaveCount(0);
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

test("in Demo Mode, the Inbox says which tickets can be analyzed, counting the curated tickets it tags", async ({ page }) => {
  await page.goto("/inbox");
  const lead = page.getByRole("main").locator("h1 + p");
  const sentence =
    /In Demo Mode, the (\d+) curated tickets? tagged \u201Ceval:\u201D can be analyzed as a scripted replay; the others can be read but not analyzed\./;
  await expect(lead).toContainText(sentence);
  // The number is counted from the database, and agrees with the "eval:" tags the Inbox shows.
  const count = Number((await lead.textContent())!.match(sentence)![1]);
  expect(count).toBe(await page.getByText(/^eval: /).count());
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
  // Billing history is dated, so timing claims (a refund window, charges hours apart) can be checked here.
  await expect(context.getByText(/^Issued [A-Z][a-z]{2} \d{1,2}, \d{4}$/).first()).toBeVisible();
  await expect(context.getByText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M$/).first()).toBeVisible();
  await expect(context.getByText("/ 100")).toBeVisible();
  await expect(page.getByText(/refund/i).first()).toBeVisible();
  await expect(page.getByText("No AI analysis has been run on this ticket yet.")).toBeVisible();
});

test("AI Operations page renders real, database-backed ticket volume", async ({ page }) => {
  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "AI Operations" })).toBeVisible();
  await expect(page.getByText("Ticket volume by status")).toBeVisible();
});

/** The recorded 2026-09-24 live evaluation's table, named by its section heading. */
const recordedTable = (page: Page) => page.getByRole("table", { name: /^Recorded live evaluation · 24 Sep 2026$/ });

test("Evaluations shows the recorded 2026-09-24 live evaluation as a dated, fixed record of all 11 scenarios", async ({ page }) => {
  await page.goto("/evaluations");
  await expect(page.getByRole("heading", { level: 1, name: "Evaluations" })).toBeVisible();
  const recorded = page.getByRole("region", { name: /^Recorded live evaluation · 24 Sep 2026$/ });
  await expect(recorded.getByRole("heading", { name: "Recorded live evaluation · 24 Sep 2026" })).toBeVisible();

  // Provenance: when, against which commit, with real model calls, and that it does not measure this deployment.
  await expect(recorded.getByText(/recorded on 24 Sep 2026, 19:18–19:21 UTC, against commit 0a12bb9/)).toBeVisible();
  await expect(recorded.getByText(/with real model calls \(Anthropic\)/)).toBeVisible();
  await expect(recorded.getByText(/It is not re-run here and does not measure this deployment\. Demo Mode never calls a model\./)).toBeVisible();
  // The summary, with the cost labelled as an estimate, and the limits.
  await expect(
    recorded.getByText(
      "11 of 11 passed (overall score ≥ 0.85) · 39 agent steps, 1 failed validation after a retry · estimated model cost $0.21",
    ),
  ).toBeVisible();
  await expect(recorded.getByText(/not a guaranteed accuracy rate\. Four scenarios passed with a mismatch or a degraded agent/)).toBeVisible();
  await expect(recorded.getByText(/Changes made after this run \(29fd3c0\) were not measured live\./)).toBeVisible();

  // All 11 scenarios, every one with its recorded pass and score.
  const rows = recordedTable(page).locator("tbody tr");
  await expect(rows).toHaveCount(11);
  await expect(recordedTable(page).locator("tbody tr td:nth-child(6)").getByText(/^Pass \(\d\.\d\d\)$/)).toHaveCount(11);

  // The four imperfect passes say why, from the recorded data.
  const result = (key: string) => rows.filter({ hasText: key }).locator("td").nth(5);
  await expect(result("prohibited-refund")).toContainText("Pass (0.94)");
  await expect(result("prohibited-refund")).toContainText(
    "Billing Agent output failed validation twice and was degraded; the denial came from the Policy agent.",
  );
  await expect(result("multi-domain")).toContainText("Intent: expected Billing question, got Duplicate charge.");
  await expect(result("failed-payment")).toContainText("Specialists: expected Billing, got Billing, Technical.");
  await expect(result("technical-escalation")).toContainText("Specialists: expected Technical, Risk, got Technical.");
  await expect(result("duplicate-billing")).toHaveText("Pass (1.00)");
});

test("Evaluations keeps this deployment's own state separate: in Demo Mode nothing has been evaluated here", async ({ page }) => {
  await page.goto("/evaluations");
  const deployment = page.getByRole("region", { name: "This deployment" });
  await expect(
    deployment.getByText(
      "No evaluation has been run in this deployment. Evaluations require real model calls, which Demo Mode never makes; demo analyses are scripted replays and are never scored.",
    ),
  ).toBeVisible();
  // No table of "Not run" rows, anywhere on the page.
  await expect(deployment.getByRole("table")).toHaveCount(0);
  await expect(page.getByText("Not run", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(1);
});

test("Knowledge page lists seeded policies and product docs, with their text", async ({ page }) => {
  await page.goto("/knowledge");
  // The lead says which agents cite what: only Policy and Risk cite policies, and documentation is never cited.
  await expect(page.getByRole("main").locator("h1 + p")).toHaveText(
    "The company policies and product documentation used in ticket analysis. The Policy Agent and the Risk / " +
      "Escalation Agent cite policies, and a policy cited on a ticket links to its entry here. The Technical Support " +
      "Agent consults the product documentation relevant to a ticket; documentation is not cited on tickets.",
  );
  // Headings, not text: each entry's body now appears too, and bodies mention other policies by name.
  await expect(page.getByRole("heading", { name: "Refund Policy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Known Issue: Automations Time Out on Large Boards" })).toBeVisible();
  // The body is readable text: Markdown syntax is rendered, not shown.
  const refund = page.locator("#policy-refund-policy");
  await expect(refund.getByText(/Duplicate charges/).first()).toBeVisible();
  await expect(refund).not.toContainText("**");
  await expect(refund.locator("ol > li")).toHaveCount(4);
});

test("the recorded Evaluations table has one cell per column in every row, with readable labels", async ({ page }) => {
  await page.goto("/evaluations");
  const table = recordedTable(page);
  await expect(table.locator("thead th")).toHaveText(["Scenario", "Ticket", "Expected", "Actual", "Dimensions", "Result"]);
  const counts = await table.locator("tbody tr").evaluateAll((rows) => rows.map((row) => row.children.length));
  expect(counts).toEqual(Array(11).fill(6));

  const row = table.locator("tbody tr").filter({ hasText: "duplicate-billing" });
  // The recorded subject is plain historical text: nothing in the historical record links to this
  // deployment's current ticket, which is not the ticket state the run evaluated.
  await expect(row.locator("td").nth(1)).toHaveText("Charged twice this billing cycle");
  await expect(table.getByRole("link")).toHaveCount(0);
  await expect(row.locator("td").nth(2)).toContainText("Duplicate charge");
  await expect(row.locator("td").nth(2)).toContainText("Refund customer");
  await expect(row.locator("td").nth(2)).not.toContainText("duplicate_charge");
  // The recorded actual outcome, in the same vocabulary.
  await expect(row.locator("td").nth(3)).toContainText("Billing, Policy, Response");
  await expect(row.locator("td").nth(3)).toContainText("Refund customer");
  await expect(row.locator("td").nth(4)).toContainText("✓ Policy");
});

test("every page names itself in the document title", async ({ page }) => {
  const expected: [string, string][] = [
    ["/inbox", "Inbox"],
    ["/operations", "AI Operations"],
    ["/evaluations", "Evaluations"],
    ["/knowledge", "Knowledge & Policies"],
    ["/settings", "Model Routing"],
    ["/this-page-does-not-exist", "Page not found"],
    ["/tickets/does-not-exist", "Page not found"],
  ];
  for (const [route, title] of expected) {
    await page.goto(route);
    await expect(page).toHaveTitle(`${title} · AI Support Operations Copilot`);
  }
  await page.goto("/inbox");
  await page.getByRole("link", { name: "Charged twice this billing cycle" }).click();
  await expect(page).toHaveTitle("Charged twice this billing cycle · AI Support Operations Copilot");
});

test("Model Routing page shows real model routing config", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Model Routing" })).toBeVisible();
  await expect(page.getByText("claude-sonnet-5").first()).toBeVisible();
});
