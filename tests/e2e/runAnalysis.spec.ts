import { test, expect } from "@playwright/test";

/**
 * The primary "Run AI Analysis" user journey, against the real app, real
 * orchestrator, and real seeded database — Inbox → open ticket → run
 * analysis → observe the completed orchestration → inspect findings,
 * resolution, and response.
 *
 * The model provider itself is swapped for a deterministic fixture for
 * this run only (see playwright.config.ts's webServer.env and
 * src/lib/ai/providers/registry.ts / e2eMockProvider.ts) — this is what
 * makes the suite's own promise ("runs the same way every time") hold
 * even though the real product depends on a live LLM. See DECISIONS.md
 * ("E2E coverage for the AI analysis flow uses a fixture model provider")
 * for why.
 */

test("running AI analysis on the duplicate-billing ticket produces a real, persisted result", async ({ page }) => {
  await page.goto("/inbox");
  await page.getByRole("link", { name: "Charged twice this billing cycle" }).click();
  await expect(page).toHaveURL(/\/tickets\//);

  await expect(page.getByText("No AI analysis has been run on this ticket yet.")).toBeVisible();

  await page.getByRole("button", { name: "Run AI analysis" }).click();

  // The orchestrator, agents, and persistence are all real — allow a
  // moment for the full pipeline (classify -> billing -> policy ->
  // response -> persist -> revalidate) to complete.
  await expect(page.getByRole("button", { name: "Run AI analysis again" })).toBeVisible({ timeout: 15_000 });

  // This run is genuinely served by a fixture, not a real model — the
  // page must say so honestly, not render indistinguishably from a real
  // run. See DECISIONS.md ("Honestly recording which provider actually
  // served a call").
  await expect(page.getByText("SIMULATED RUN", { exact: false })).toBeVisible();
  await expect(page.getByText("simulated (mock)").first()).toBeVisible();

  // Agents invoked: classification always runs, plus exactly billing,
  // policy, and response for this ticket (never technical or risk — the
  // dynamic selection this product is built around).
  await expect(page.getByText("Classification")).toBeVisible();
  await expect(page.getByText("Billing Agent")).toBeVisible();
  await expect(page.getByText("Policy Agent")).toBeVisible();
  await expect(page.getByText("Response Agent")).toBeVisible();
  await expect(page.getByText("Technical Support Agent")).toHaveCount(0);
  await expect(page.getByText("Risk / Escalation Agent")).toHaveCount(0);

  // Findings: the billing agent's evidence and the policy citation.
  await expect(page.getByText(/confirmed.*duplicate/i).first()).toBeVisible();
  await expect(page.getByText("Duplicate Charge Policy").first()).toBeVisible();

  // Resolution: refund, no escalation.
  await expect(page.getByRole("heading", { name: "Resolution" })).toBeVisible();
  await expect(page.getByText("refund_customer")).toBeVisible();
  await expect(page.getByText("Escalation")).toHaveCount(0);

  // Proposed response: grounded in the resolution (mentions the refund).
  await expect(page.getByRole("heading", { name: "Proposed response" })).toBeVisible();
  await expect(page.getByText(/refunded it in full/i)).toBeVisible();
});

test("AI Operations correctly EXCLUDES the simulated run from real metrics", async ({ page }) => {
  // Depends on the previous test having run first in this file (Playwright
  // runs tests within one file in declaration order). The e2e journey's
  // analysis run is served by the deterministic fixture provider (see
  // e2eMockProvider.ts) — persistOrchestrationRun() correctly tags it
  // isSimulated: true, and AI Operations must exclude it from every
  // "real" metric rather than silently inflating live numbers with test
  // data. See DECISIONS.md ("Honestly recording which provider actually
  // served a call").
  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "AI Operations" })).toBeVisible();
  await expect(page.getByText("Orchestration runs")).toBeVisible();
  await expect(page.getByText(/simulated \(fixture-provider\) run\(s\) exist/)).toBeVisible();
  await expect(page.getByText("No agent invocations recorded yet")).toBeVisible();
});
