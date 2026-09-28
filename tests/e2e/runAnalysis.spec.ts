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

/**
 * Canonical taxonomy values the ticket page must show through
 * src/lib/labels.ts, never raw. (Agent-authored evidence prose may quote a data
 * code such as a charge reason; that is recorded text, not a label, so this
 * list names the identifiers the UI itself renders.)
 */
const RAW_TAXONOMY_IDENTIFIER =
  /\b(?:refund_customer|reply_and_close|reply_and_monitor|auto_resolve|deny_request|trust_and_safety|billing_ops|senior_support|account_security|duplicate_charge|duplicate_charge_confirmed|requires_escalation|requires_review)\b/;

async function openTicket(page: Page, subject: string) {
  await page.goto("/inbox");
  await page.getByRole("link", { name: subject }).click();
  await expect(page).toHaveURL(/\/tickets\//);
}

async function expandAgentTrace(page: Page, steps: number) {
  await page.getByText(`Agent trace (${steps} steps)`).click();
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

  // Decision first: the recommendation is visible without opening anything, in plain labels.
  const recommendation = page.getByRole("region", { name: "Recommendation" });
  await expect(recommendation).toBeVisible();
  await expect(recommendation.getByText("Refund customer", { exact: true })).toBeVisible();
  await expect(page.getByText("Escalation")).toHaveCount(0);

  // The operator's deliverable follows, and is honestly a draft: nothing was sent or executed.
  const draft = page.getByRole("region", { name: "Draft reply" });
  await expect(draft).toBeVisible();
  await expect(draft.getByText("Not sent", { exact: true })).toBeVisible();
  await expect(draft.getByText(/refunded it in full/i)).toBeVisible();
  // Nothing was actually done: a scripted "Refund processed" must not read as a real payment operation.
  await expect(page.getByText(/no refund, email, payment, account change, or other external action was actually executed/)).toBeVisible();

  // The decision is shown above the reasoning that produced it.
  const traceToggle = page.getByText("Agent trace (4 steps)");
  const recommendationBox = await recommendation.boundingBox();
  const traceBox = await traceToggle.boundingBox();
  expect(recommendationBox!.y).toBeLessThan(traceBox!.y);

  // Dynamic selection is visible without opening the trace: exactly Billing and Policy were routed to.
  const pipeline = page.getByRole("list", { name: "Decision pipeline" });
  await expect(pipeline.getByText("Billing, Policy", { exact: true })).toBeVisible();

  // The full agent trace is collapsed by default, then opens to the per-step detail.
  await expect(page.getByText("Billing Agent")).toBeHidden();
  await expandAgentTrace(page, 4);
  // Provenance stays per step, not only per run.
  await expect(page.getByText("simulated (demo)").first()).toBeVisible();

  // Dynamic selection: classification plus exactly billing, policy and response.
  await expect(page.getByText("Classification")).toBeVisible();
  await expect(page.getByText("Billing Agent")).toBeVisible();
  await expect(page.getByText("Policy Agent")).toBeVisible();
  await expect(page.getByText("Response Agent")).toBeVisible();
  await expect(page.getByText("Technical Support Agent")).toHaveCount(0);
  await expect(page.getByText("Risk / Escalation Agent")).toHaveCount(0);

  await expect(page.getByText(/confirmed.*duplicate/i).first()).toBeVisible();

  // No raw taxonomy identifier anywhere on the page, including the opened trace.
  await expect(page.getByText(RAW_TAXONOMY_IDENTIFIER)).toHaveCount(0);

  // The policy citation is a real link to that policy's Knowledge entry.
  const citation = page.getByRole("link", { name: "Duplicate Charge Policy" });
  await expect(citation).toHaveAttribute("href", "/knowledge#policy-duplicate-charge-policy");
  await citation.click();
  await expect(page).toHaveURL(/\/knowledge#policy-duplicate-charge-policy$/);
  await expect(page.locator("#policy-duplicate-charge-policy")).toBeInViewport();
  // It lands on the policy's actual text, not just its name.
  await expect(
    page.locator("#policy-duplicate-charge-policy").getByText(/Confirmed duplicate charges are refunded in full/),
  ).toBeVisible();
});

test("running it again is idempotent: the same result, and still exactly one demo run", async ({ page }) => {
  await openTicket(page, "Charged twice this billing cycle");
  await expect(page.getByText("Agent trace (4 steps)")).toBeVisible();

  const button = page.getByRole("button", { name: "Run demo analysis again" });
  await button.click();
  await expect(button).toBeEnabled({ timeout: 15_000 }); // the action resolved

  await page.reload();
  await expect(page.getByText("Agent trace (4 steps)")).toBeVisible(); // not 8: no second run was created
  await expect(page.getByText("SIMULATED RUN", { exact: false })).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Recommendation" }).getByText("Refund customer", { exact: true })).toBeVisible();

  await page.goto("/operations");
  await expect(page.getByText(/^1 simulated run is recorded in this deployment/)).toBeVisible(); // still one
});

test("AI Operations excludes the demo run from real metrics, and says why", async ({ page }) => {
  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "AI Operations" })).toBeVisible();

  // One explanation, naming Demo Mode as the reason, with the count it excluded.
  const notice = page.getByRole("region", { name: "Run metrics are empty in Demo Mode" });
  await expect(notice).toBeVisible();

  // The demo run is not counted: the run metrics are a true zero, shown in the notice, not hidden or inflated.
  await expect(notice.getByText("Orchestration runs", { exact: true }).locator("xpath=following-sibling::dd")).toHaveText("0");
  await expect(notice.getByText("Agent invocations", { exact: true }).locator("xpath=following-sibling::dd")).toHaveText("0");
  // With nothing real to count, the page does not lay out a grid of empty metric tiles or a per-step usage table.
  await expect(page.getByText("Escalation rate", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Usage by pipeline step")).toHaveCount(0);
  // Ticket volume, which does not depend on runs, leads the page in workflow and urgency order.
  await expect(page.getByRole("heading", { name: "Ticket volume by priority" }).locator("xpath=following-sibling::ul/li/span[1]")).toHaveText([
    "Urgent",
    "High",
    "Medium",
    "Low",
  ]);
  await expect(notice.getByText(/In Demo Mode, analyses are scripted replays and no model is called/)).toBeVisible();
  await expect(notice.getByText(/^1 simulated run is recorded in this deployment and excluded from every metric/)).toBeVisible();

  // It points to where the system can actually be seen working: an existing route.
  const explore = notice.getByRole("link", { name: "Open the Inbox to run a demo analysis" });
  await expect(explore).toHaveAttribute("href", "/inbox");
  await explore.click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
});

test("a second, different scenario works: suspicious-activity routes to Risk and escalates to Trust & Safety", async ({ page }) => {
  await openTicket(page, "Unrecognized login and API key on our account");
  await page.getByRole("button", { name: "Run demo analysis" }).click();
  await expect(page.getByRole("button", { name: "Run demo analysis again" })).toBeVisible({ timeout: 15_000 });

  await expect(page.getByText("SIMULATED RUN", { exact: false })).toBeVisible();

  // The decision, visible without opening the trace: escalate to Trust & Safety, critical, human review.
  const recommendation = page.getByRole("region", { name: "Recommendation" });
  await expect(recommendation.getByText("Escalate to Trust & Safety", { exact: true })).toBeVisible();
  await expect(recommendation.getByText("Trust & Safety", { exact: true })).toBeVisible();
  await expect(recommendation.getByText("Critical", { exact: true })).toBeVisible();
  await expect(recommendation.getByText("Human review required", { exact: true })).toBeVisible();

  // Routed to Risk only, visible in the pipeline and in the opened trace.
  await expect(page.getByRole("list", { name: "Decision pipeline" }).getByText("Risk", { exact: true })).toBeVisible();
  await expandAgentTrace(page, 3);
  await expect(page.getByText("Risk / Escalation Agent")).toBeVisible();
  await expect(page.getByText("Billing Agent")).toHaveCount(0);

  // Not the duplicate-billing answer: the recordings are per-ticket.
  await expect(page.getByText("Refund customer", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/refunded it in full/i)).toHaveCount(0);
  await expect(page.getByText(RAW_TAXONOMY_IDENTIFIER)).toHaveCount(0);
});

test("the Inbox shows each analyzed ticket's recommendation as a proposal, never as a completed outcome", async ({ page }) => {
  await page.goto("/inbox");
  const recommendationCell = (subject: string) =>
    page.locator("tbody tr").filter({ hasText: subject }).locator("td").nth(6);

  // Escalation is recommended, not done: the ticket is still Open, and the AI column says "Escalate", not "Escalated".
  const security = recommendationCell("Unrecognized login and API key on our account");
  await expect(security.getByText("Escalate", { exact: true })).toBeVisible();
  await expect(security).not.toContainText("Escalated");
  await expect(page.locator("tbody tr").filter({ hasText: "Unrecognized login" }).locator("td").nth(2)).toHaveText("Open");

  // A proposed refund is plain text in the operator's words, not a green "done" badge.
  const refund = page.locator("tbody tr").filter({ hasText: "Charged twice this billing cycle" }).locator("td").nth(6);
  const label = refund.getByText("Refund customer", { exact: true });
  await expect(label).toBeVisible();
  expect(await label.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
});

test("an uncurated ticket cannot run in Demo Mode", async ({ page }) => {
  await page.goto("/inbox");
  // Curated scenarios carry an "eval:" badge; take the first ticket without one.
  await page.locator("tbody tr").filter({ hasNotText: "eval:" }).first().getByRole("link").first().click();
  await expect(page).toHaveURL(/\/tickets\//);

  const unavailable = page.getByRole("button", { name: "Run demo analysis" });
  await expect(unavailable).toBeDisabled();
  await expect(page.getByText("Demo Mode is available for the curated evaluation scenarios only.")).toBeVisible();
  // The reason is attached to the button itself, so assistive technology reads it with the control.
  await expect(unavailable).toHaveAccessibleDescription("Demo Mode is available for the curated evaluation scenarios only.");
  await expect(page.getByText("No AI analysis has been run on this ticket yet.")).toBeVisible();
  await expect(page.getByText("SIMULATED RUN", { exact: false })).toHaveCount(0);

  // Nothing was created: only the two curated demo runs from the tests above exist.
  await page.goto("/operations");
  await expect(page.getByText(/^2 simulated runs are recorded in this deployment/)).toBeVisible();
});

test("demo analyses never become evaluation results: the recorded run and this deployment's state are unchanged", async ({ page }) => {
  // Runs after the demo analyses above (this file is serial), so this deployment now holds two demo runs.
  await page.goto("/evaluations");

  // The recorded 2026-09-24 run is the committed record, untouched by anything run here.
  const recorded = page.getByRole("region", { name: /^Recorded live evaluation · 24 Sep 2026$/ });
  await expect(
    recorded.getByText(
      "11 of 11 passed (overall score ≥ 0.85) · 39 agent steps, 1 failed validation after a retry · estimated model cost $0.21",
    ),
  ).toBeVisible();
  const duplicateBilling = recorded.getByRole("table").locator("tbody tr").filter({ hasText: "duplicate-billing" });
  await expect(duplicateBilling.locator("td").nth(5)).toHaveText("Pass (1.00)");
  await expect(recorded.getByText("Simulated", { exact: true })).toHaveCount(0);

  // This deployment still has no evaluation: the demo runs were not scored and are not shown as results.
  const deployment = page.getByRole("region", { name: "This deployment" });
  await expect(deployment.getByText(/^No evaluation has been run in this deployment\./)).toBeVisible();
  await expect(deployment.getByRole("table")).toHaveCount(0);
});
