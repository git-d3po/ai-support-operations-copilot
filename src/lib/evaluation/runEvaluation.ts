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
  /** True when this case ran against a fixture/mock provider, not a real
   * model — see persistOrchestrationRun's isSimulated. */
  isSimulated?: boolean;
}

/**
 * Runs every curated scenario through the REAL orchestration pipeline
 * (analyzeTicket — the same code path "Run AI analysis" uses) and scores
 * each one against its expected outcome, persisting an EvaluationResult
 * row per case. This function itself has no opinion about which provider
 * is behind the "anthropic" slot — it calls whatever `registry.ts`
 * resolves at the time. In normal use (`scripts/runEvaluation.ts`) that's
 * always the real `AnthropicProvider`, gated on a real `ANTHROPIC_API_KEY`
 * being present. A caller can also register a fixture provider first
 * (`scripts/runEvaluationDryRun.ts` does this) to validate the pipeline
 * deterministically without a live model — every `EvaluationResult`
 * written here is tagged `isSimulated` from the underlying
 * `OrchestrationRun`, so the two can never be displayed or queried
 * indistinguishably. See EVALUATION.md and DECISIONS.md ("Honestly
 * recording which provider actually served a call").
 *
 * Never invents a result: if analyzeTicket() fails for a case (e.g. no
 * ANTHROPIC_API_KEY configured and no fixture registered either), that
 * case is recorded as failed-to-run, not scored.
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
        isSimulated: result.run.isSimulated,
      },
    });

    summaries.push({
      scenarioKey: evalCase.scenarioKey,
      ticketId: evalCase.ticketId,
      ok: true,
      evaluationResultId: evaluationResult.id,
      overallScore: scores.overallScore,
      passed,
      isSimulated: result.run.isSimulated,
    });
  }

  return summaries;
}
