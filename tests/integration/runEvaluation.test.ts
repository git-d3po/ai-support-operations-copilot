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
 * Runs against the real seeded database and the real orchestrator — with
 * no ANTHROPIC_API_KEY configured in this environment (see
 * CLAUDE.md/DECISIONS.md: no real credential is ever used in automated
 * tests). This exercises the suite's most important safety property: it
 * never fabricates a scored result when the pipeline couldn't actually
 * run, and it never crashes partway through the 10 curated cases.
 */
describe("runEvaluationSuite (real orchestrator, no live provider configured)", () => {
  it("records every curated case as failed-to-run rather than inventing a score", async () => {
    expect(process.env.ANTHROPIC_API_KEY).toBeFalsy();

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
});
