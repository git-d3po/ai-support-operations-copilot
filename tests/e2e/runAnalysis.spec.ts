import { expect, test, type Page } from "@playwright/test";

/**
 * The Demo Mode journey, end to end against a production build of the real
 * app: real orchestrator, real persistence, real UI. playwright.config.ts runs
 * the app with AI_MODE=demo, so the model calls are answered by the
 * deterministic DemoProvider (scripted replay): no API key, no network. This is
 * the same path a public deployment runs, so the suite tests what ships.
 *
 * What is deliberately checked here: a curated ticket runs; the result is
 * honestly labeled as a simulated demo replay; replay is idempotent (one demo
 * run per ticket); the run is excluded from AI Operations' real metrics; a
 * second, different scenario works (the recordings are not one ticket's answer
 * for everyone); and an uncurated ticket cannot run at all. Not a claim about
 * model quality; see EVALUATION.md. See DECISIONS.md ("Public Demo Mode").
 *
 * Tests in this file share one database and build on each other, so they run in
 * declaration order.
 */
test.describe.configure({ mode: "serial" });

async function openTicket(page: Page, subject: string) {
  await page.goto("/inbox");
  await page.getByRole("link", { name: subject }).click();
  await expect(page).toHaveURL(/\/tickets\//);
}

test("running demo analysis on the duplicate-billing ticket produces a persisted, simulated result", async ({ page }) => {
  await openTicket(page, "Charged twice this billing cycle");

  await expect(page.getByText("No AI analysis has been run on this ticket yet.")).toBeVisible();
  // In Demo Mode the action is labeled honestly: it runs a demo, not "AI analysis".
  await expect(page.getByRole("button", { name: "Run AI analysis" })).toHaveCount(0);
  await page.getByRole("button", { name: "Run demo analysis" }).click();

  // The real pipeline (classify -> select -> agents -> resolve -> respond -> persist -> revalidate) completes.
  await expect(page.getByRole("button", { name: "Run demo analysis again" })).toBeVisible({ timeout: 15_000 });

  // The result says plainly that it is a simulated demo replay, not a model.
  await expect(page.getByText("SIMULATED RUN", { exact: false })).toBeVisible();
  await expect(page.getByText(/demo replay of scripted responses; no model was called/)).toBeVisible();
  // Nothing was actually done: a scripted "Refund processed" must not read as a real payment operation.
  await expect(page.getByText(/no refund, email, payment, account change, or other external action was actually executed/)).toBeVisible();
  await expect(page.getByText("simulated (demo)").first()).toBeVisible();

  // Dynamic selection: classification plus exactly billing, policy and response.
  await expect(page.getByText("Classification")).toBeVisible();
  await expect(page.getByText("Billing Agent")).toBeVisible();
  await expect(page.getByText("Policy Agent")).toBeVisible();
  await expect(page.getByText("Response Agent")).toBeVisible();
  await expect(page.getByText("Technical Support Agent")).toHaveCount(0);
  await expect(page.getByText("Risk / Escalation Agent")).toHaveCount(0);

  await expect(page.getByText(/confirmed.*duplicate/i).first()).toBeVisible();
  await expect(page.getByText("Duplicate Charge Policy").first()).toBeVisible();

  await expect(page.getByRole("heading", { name: "Resolution" })).toBeVisible();
  await expect(page.getByText("refund_customer")).toBeVisible();
  await expect(page.getByText("Escalation")).toHaveCount(0);

  await expect(page.getByRole("heading", { name: "Proposed response" })).toBeVisible();
  await expect(page.getByText(/refunded it in full/i)).toBeVisible();
});

test("running it again is idempotent: the same result, and still exactly one demo run", async ({ page }) => {
  await openTicket(page, "Charged twice this billing cycle");
  await expect(page.getByText("Agents invoked (4)")).toBeVisible();

  const button = page.getByRole("button", { name: "Run demo analysis again" });
  await button.click();
  await expect(button).toBeEnabled({ timeout: 15_000 }); // the action resolved

  await page.reload();
  await expect(page.getByText("Agents invoked (4)")).toBeVisible(); // not 8: no second run was created
  await expect(page.getByText("SIMULATED RUN", { exact: false })).toHaveCount(1);
  await expect(page.getByText("refund_customer")).toBeVisible();

  await page.goto("/operations");
  await expect(page.getByText(/^1 additional simulated run\(s\) exist \(Demo Mode scripted replays or fixture runs\)/)).toBeVisible();
});

test("AI Operations excludes the demo run from real metrics", async ({ page }) => {
  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "AI Operations" })).toBeVisible();
  await expect(page.getByText("Orchestration runs")).toBeVisible();
  await expect(page.getByText(/additional simulated run\(s\) exist \(Demo Mode scripted replays or fixture runs\)/)).toBeVisible();
  // The demo run's agent invocations are not counted as real activity.
  await expect(page.getByText("No agent invocations recorded yet")).toBeVisible();
});

test("a second, different scenario works: suspicious-activity routes to Risk and escalates to Trust & Safety", async ({ page }) => {
  await openTicket(page, "Unrecognized login and API key on our account");
  await page.getByRole("button", { name: "Run demo analysis" }).click();
  await expect(page.getByRole("button", { name: "Run demo analysis again" })).toBeVisible({ timeout: 15_000 });

  await expect(page.getByText("SIMULATED RUN", { exact: false })).toBeVisible();
  await expect(page.getByText("Risk / Escalation Agent")).toBeVisible();
  await expect(page.getByText(/team: trust_and_safety/)).toBeVisible();
  await expect(page.getByText("Billing Agent")).toHaveCount(0);
  // Not the duplicate-billing answer: the recordings are per-ticket.
  await expect(page.getByText("refund_customer")).toHaveCount(0);
  await expect(page.getByText(/refunded it in full/i)).toHaveCount(0);
});

test("an uncurated ticket cannot run in Demo Mode", async ({ page }) => {
  await page.goto("/inbox");
  // Curated scenarios carry an "eval:" badge; take the first ticket without one.
  await page.locator("tbody tr").filter({ hasNotText: "eval:" }).first().getByRole("link").first().click();
  await expect(page).toHaveURL(/\/tickets\//);

  await expect(page.getByRole("button", { name: "Run demo analysis" })).toBeDisabled();
  await expect(page.getByText("Demo Mode is available for the curated evaluation scenarios only.")).toBeVisible();
  await expect(page.getByText("No AI analysis has been run on this ticket yet.")).toBeVisible();
  await expect(page.getByText("SIMULATED RUN", { exact: false })).toHaveCount(0);

  // Nothing was created: only the two curated demo runs from the tests above exist.
  await page.goto("/operations");
  await expect(page.getByText(/^2 additional simulated run\(s\) exist \(Demo Mode scripted replays or fixture runs\)/)).toBeVisible();
});
