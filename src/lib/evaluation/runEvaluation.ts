import { db } from "@/lib/db";
import { analyzeTicket } from "@/lib/orchestrator/analyzeTicket";
import type { EvaluationExpectedOutcome } from "@/lib/ai/schemas";
import { scoreOutcome } from "./score";

/** Below this overall score, a case counts as failed — see EVALUATION.md,
 * "Scoring notes." Deliberately high: escalation/resolution correctness
 * are weighted heavily, so a passing score means the operationally
 * important dimensions were right, not just "mostly fine." */
export const PASS_THRESHOLD = 0.85;

export interface EvaluationCaseRunSummary {
  scenarioKey: string;
  ticketId: string;
  ok: boolean;
  error?: string;
  evaluationResultId?: string;
  overallScore?: number;
  passed?: boolean;
}

/**
 * Runs every curated scenario through the REAL orchestration pipeline
 * (analyzeTicket — the same code path "Run AI analysis" uses) and scores
 * each one against its expected outcome, persisting an EvaluationResult
 * row per case. This calls whatever provider is actually configured
 * (routing config points every step at "anthropic" — see
 * modelRouting.ts) — it does NOT run against MockProvider, because a
 * mock's canned answers would not measure anything real. See
 * EVALUATION.md and DECISIONS.md ("Model provider abstraction").
 *
 * Never invents a result: if analyzeTicket() fails for a case (e.g. no
 * ANTHROPIC_API_KEY configured), that case is recorded as failed-to-run,
 * not scored.
 */
export async function runEvaluationSuite(): Promise<EvaluationCaseRunSummary[]> {
  const cases = await db.evaluationCase.findMany({ orderBy: { scenarioKey: "asc" } });
  const summaries: EvaluationCaseRunSummary[] = [];

  for (const evalCase of cases) {
    const result = await analyzeTicket(evalCase.ticketId);

    if (!result.ok) {
      summaries.push({
        scenarioKey: evalCase.scenarioKey,
        ticketId: evalCase.ticketId,
        ok: false,
        error: result.error,
      });
      continue;
    }

    const expected = evalCase.expectedOutcome as unknown as EvaluationExpectedOutcome;
    const scores = scoreOutcome(expected, result.outcome);
    const passed = scores.overallScore >= PASS_THRESHOLD;

    const evaluationResult = await db.evaluationResult.create({
      data: {
        evaluationCaseId: evalCase.id,
        orchestrationRunId: result.run.orchestrationRunId,
        scores,
        passed,
      },
    });

    summaries.push({
      scenarioKey: evalCase.scenarioKey,
      ticketId: evalCase.ticketId,
      ok: true,
      evaluationResultId: evaluationResult.id,
      overallScore: scores.overallScore,
      passed,
    });
  }

  return summaries;
}
