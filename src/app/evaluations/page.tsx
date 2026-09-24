import Link from "next/link";
import { getAiMode } from "@/lib/ai/mode";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type {
  EvaluationExpectedOutcome,
  EvaluationResult as EvaluationResultScores,
  ResolutionDecision,
  TicketClassification,
} from "@/lib/ai/schemas";

export const dynamic = "force-dynamic";

const DIMENSION_LABELS: { key: keyof EvaluationResultScores; label: string }[] = [
  { key: "classificationCorrect", label: "Classification" },
  { key: "routingCorrect", label: "Routing" },
  { key: "policyCorrect", label: "Policy" },
  { key: "escalationCorrect", label: "Escalation" },
  { key: "resolutionCorrect", label: "Resolution" },
];

export default async function EvaluationsPage() {
  const cases = await db.evaluationCase.findMany({
    include: { ticket: true, results: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { scenarioKey: "asc" },
  });

  // EvaluationResult.orchestrationRunId has no declared Prisma relation
  // (pre-existing — see TODO.md), so the linked run's actual outcome is
  // fetched with a second query rather than `include`.
  const runIds = cases.flatMap((c) => c.results.map((r) => r.orchestrationRunId));
  const runs = runIds.length
    ? await db.orchestrationRun.findMany({ where: { id: { in: runIds } } })
    : [];
  const runsById = new Map(runs.map((r) => [r.id, r]));

  const scoredCases = cases.filter((c) => c.results.length > 0);
  const liveScoredCases = scoredCases.filter((c) => !c.results[0].isSimulated);
  const simulatedScoredCases = scoredCases.filter((c) => c.results[0].isSimulated);
  const livePassedCount = liveScoredCases.filter((c) => c.results[0].passed).length;

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Evaluations</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {cases.length} curated scenarios with known expected outcomes (see EVALUATION.md).
      </p>

      <div className="mt-2 flex flex-col gap-1 text-sm">
        <p>
          <span className="font-medium">Live model evaluation: </span>
          {liveScoredCases.length === 0 ? (
            <span className="text-muted-foreground">
              {getAiMode() === "demo"
                ? "no historical live results are included in this Demo Mode deployment. Demo analyses are scripted replays and are never evaluation results. See EVALUATION.md."
                : "not run yet — requires a real ANTHROPIC_API_KEY and an explicit request; see EVALUATION.md and DECISIONS.md. No score below is a substitute for this."}
            </span>
          ) : (
            <span>
              {liveScoredCases.length}/{cases.length} scenarios scored against a real model;{" "}
              {livePassedCount}/{liveScoredCases.length} passed.
            </span>
          )}
        </p>
        {simulatedScoredCases.length > 0 && (
          <Card tone="info" padding="sm">
            {simulatedScoredCases.length} scenario(s) below also have a{" "}
            <strong>SIMULATED</strong> result from a deterministic fixture-provider dry run —
            this validates that the pipeline and scorer are wired correctly end to end. It is{" "}
            <strong>not a measurement of real model performance</strong> and is visually
            distinguished from any live result throughout this page.
          </Card>
        )}
      </div>

      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-4">Scenario</th>
            <th className="py-2 pr-4">Ticket</th>
            <th className="py-2 pr-4">Expected</th>
            <th className="py-2 pr-4">Actual</th>
            <th className="py-2 pr-4">Dimensions</th>
            <th className="py-2 pr-4">Result</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((evalCase) => {
            const expected = evalCase.expectedOutcome as unknown as EvaluationExpectedOutcome;
            const result = evalCase.results[0] as
              | { scores: unknown; passed: boolean; isSimulated: boolean; orchestrationRunId: string }
              | undefined;
            const scores = result?.scores as EvaluationResultScores | undefined;
            const run = result ? runsById.get(result.orchestrationRunId) : undefined;
            const actualClassification = run?.classification as unknown as TicketClassification | undefined;
            const actualResolution = run?.resolution as unknown as ResolutionDecision | undefined;
            const actualEscalated = run ? run.escalation !== null : undefined;

            return (
              <tr key={evalCase.id} className="border-b border-zinc-100 align-top dark:border-zinc-900">
                <td className="py-2 pr-4 font-medium">
                  {evalCase.scenarioKey}
                  <div className="mt-1 text-xs text-muted-foreground">
                    <Link href={`/tickets/${evalCase.ticketId}`} className="hover:underline">
                      {evalCase.ticket.subject}
                    </Link>
                  </div>
                </td>
                <td className="py-2 pr-4 text-xs">
                  intent: {expected.expectedIntent}
                  <br />
                  agents: {expected.expectedAgents.join(", ")}
                  <br />
                  escalate: {expected.expectedEscalation ? "yes" : "no"}
                  <br />
                  action: {expected.expectedAction}
                </td>
                <td className="py-2 pr-4 text-xs">
                  {!run ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <>
                      intent: {actualClassification?.intent ?? "—"}
                      <br />
                      escalate: {actualEscalated ? "yes" : "no"}
                      <br />
                      action: {actualResolution?.action ?? "—"}
                    </>
                  )}
                </td>
                <td className="py-2 pr-4">
                  {!scores ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-col gap-0.5 text-xs">
                      {DIMENSION_LABELS.map(({ key, label }) => {
                        const value = scores[key];
                        return (
                          <span key={key}>
                            {value === null ? "◦" : value ? "✓" : "✗"} {label}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-4">
                  {!result || !scores ? (
                    <span className="text-xs text-muted-foreground">not run</span>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1">
                        {result.isSimulated && <Badge tone="info">simulated</Badge>}
                        <Badge tone={result.passed ? "success" : "danger"}>
                          {result.passed ? "pass" : "fail"} ({scores.overallScore.toFixed(2)})
                        </Badge>
                      </div>
                      {!result.passed && (
                        <p className="max-w-xs text-xs text-muted-foreground">{scores.notes}</p>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Card dashed padding="lg" className="mt-6 text-sm text-muted-foreground">
        Dimensions scored per case: classification, routing, policy, escalation, and resolution
        correctness (exact match against the expected outcome — <code>◦</code> means &ldquo;not
        applicable&rdquo; for that scenario), plus an evidence-quality heuristic folded into the overall
        score. See EVALUATION.md for the full rubric and DECISIONS.md for why evaluation is scored
        this way, including how a <Badge tone="info">simulated</Badge> result differs from a real
        one.
      </Card>
    </div>
  );
}
