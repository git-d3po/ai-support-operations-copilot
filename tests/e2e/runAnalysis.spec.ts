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

  // The demo run is not counted: the run metric is a true zero, not hidden or inflated.
  await expect(page.getByText("Orchestration runs", { exact: true }).locator("xpath=following-sibling::p")).toHaveText("0");
  await expect(page.getByText("No real-model invocations to show. Demo analyses are not counted here.")).toBeVisible();

  // One explanation, naming Demo Mode as the reason, with the count it excluded.
  const notice = page.getByRole("region", { name: "Run metrics are empty in Demo Mode" });
  await expect(notice).toBeVisible();
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
