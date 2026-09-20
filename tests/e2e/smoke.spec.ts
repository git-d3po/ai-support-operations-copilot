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

test("inbox lists the seeded tickets, including curated evaluation scenarios", async ({ page }) => {
  await page.goto("/inbox");
  await expect(page.getByText(/\d+ tickets\./)).toBeVisible();
  await expect(page.getByText("eval: password-reset")).toBeVisible();
  await expect(page.getByText("eval: multi-domain")).toBeVisible();
});

test("opening a curated ticket shows the customer, conversation, and account context", async ({ page }) => {
  // Uses a different ticket than runAnalysis.spec.ts (which runs AI
  // analysis on "Charged twice this billing cycle") so this test's
  // "not yet analyzed" assertion never depends on suite run order.
  await page.goto("/inbox");
  await page.getByRole("link", { name: /Refund request — upgraded by mistake/i }).click();
  await expect(page).toHaveURL(/\/tickets\//);
  await expect(page.getByText("Sam Okafor", { exact: true })).toBeVisible();
  await expect(page.getByText("Vertexcraft", { exact: true })).toBeVisible();
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
