import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { runEvaluationSuite } from "@/lib/evaluation/runEvaluation";

// Every case's analyzeTicket() call persists a "failed" OrchestrationRun
// (no agent invocations, since classification is the very first call and
// that's what throws) — clean those up so this test doesn't leave
// clutter in the shared seeded database.
afterEach(async () => {
  const cases = await db.evaluationCase.findMany({ select: { ticketId: true } });
  const ticketIds = cases.map((c) => c.ticketId);
  await db.orchestrationRun.deleteMany({ where: { ticketId: { in: ticketIds } } });
});

/**
 * Asserts only that no key is configured, as a boolean. The key's value must never
 * reach a failure message: `expect(process.env.ANTHROPIC_API_KEY).toBeFalsy()` prints
 * the received value when it fails, which is how a real key once appeared in test
 * output. Run this suite with the key blanked (`ANTHROPIC_API_KEY= npm run test:integration`).
 */
function expectNoApiKeyConfigured() {
  expect(Boolean(process.env.ANTHROPIC_API_KEY), "ANTHROPIC_API_KEY must be unset or empty for this test (its value is deliberately not shown)").toBe(false);
}

/**
 * Runs against the real seeded database and the real orchestrator — with
 * no ANTHROPIC_API_KEY configured in this environment (see
 * CLAUDE.md/DECISIONS.md: no real credential is ever used in automated
 * tests). This exercises the suite's most important safety property: it
 * never fabricates a scored result when the pipeline couldn't actually
 * run, and it never crashes partway through the 11 curated cases.
 */
describe("runEvaluationSuite (real orchestrator, no live provider configured)", () => {
  it("records every curated case as failed-to-run rather than inventing a score", async () => {
    expectNoApiKeyConfigured();

    const summaries = await runEvaluationSuite();

    expect(summaries.length).toBeGreaterThanOrEqual(10);
    for (const summary of summaries) {
      expect(summary.ok).toBe(false);
      expect(summary.error).toContain("ANTHROPIC_API_KEY");
      expect(summary.overallScore).toBeUndefined();
      expect(summary.passed).toBeUndefined();
    }

    // No EvaluationResult rows should exist for cases that never actually ran.
    const resultCount = await db.evaluationResult.count();
    expect(resultCount).toBe(0);
  });

  it("with a scenarioKey, runs exactly that one scenario through the same analyzeTicket() path", async () => {
    expectNoApiKeyConfigured();

    const summaries = await runEvaluationSuite({ scenarioKey: "duplicate-billing" });

    expect(summaries).toHaveLength(1);
    expect(summaries[0].scenarioKey).toBe("duplicate-billing");
    // Reaching the provider (and failing on the missing key) proves the
    // single-scenario path goes through the real pipeline, not a shortcut.
    expect(summaries[0].ok).toBe(false);
    expect(summaries[0].error).toContain("ANTHROPIC_API_KEY");
  });

  it("rejects an unknown scenarioKey clearly, before any pipeline run or persisted row", async () => {
    await expect(runEvaluationSuite({ scenarioKey: "not-a-scenario" })).rejects.toThrow(
      /Unknown evaluation scenario "not-a-scenario"\. Valid scenarios: .*duplicate-billing/,
    );
    expect(await db.orchestrationRun.count()).toBe(0);
    expect(await db.evaluationResult.count()).toBe(0);
  });
});
