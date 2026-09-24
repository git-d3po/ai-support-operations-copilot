import type { Metadata } from "next";
import Link from "next/link";
import { getAiMode } from "@/lib/ai/mode";
import { db } from "@/lib/db";
import { LINK_CLASSES } from "@/components/app-state";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { labelAction, labelAgentShort, labelIntent } from "@/lib/labels";
import type {
  EvaluationExpectedOutcome,
  EvaluationResult as EvaluationResultScores,
  ResolutionDecision,
  TicketClassification,
} from "@/lib/ai/schemas";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Evaluations" };

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
        {cases.length} curated scenarios, each scored against a known expected outcome.
      </p>

      <div className="mt-2 flex flex-col gap-1 text-sm">
        <p>
          <span className="font-medium">Live model evaluation: </span>
          {liveScoredCases.length === 0 ? (
            <span className="text-muted-foreground">
              {getAiMode() === "demo"
                ? "no historical live results are included in this Demo Mode deployment. Demo analyses are scripted replays and are never evaluation results."
                : "not run yet. A live evaluation calls the configured model and runs only when explicitly started. No result below substitutes for it."}
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
            <strong>simulated</strong> result from a deterministic fixture dry run, which checks that
            the pipeline and scoring run end to end. It is{" "}
            <strong>not a measurement of real model performance</strong>, and it is marked Simulated
            wherever it appears.
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
                {/* The canonical scenario key, deliberately shown as-is: it is the scenario's identifier. */}
                <td className="whitespace-nowrap py-2 pr-4 font-medium">{evalCase.scenarioKey}</td>
                <td className="py-2 pr-4">
                  <Link href={`/tickets/${evalCase.ticketId}`} className={LINK_CLASSES}>
                    {evalCase.ticket.subject}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-xs">
                  <OutcomeLines
                    intent={labelIntent(expected.expectedIntent)}
                    specialists={expected.expectedAgents.map(labelAgentShort).join(", ")}
                    escalated={expected.expectedEscalation}
                    action={labelAction(expected.expectedAction)}
                  />
                </td>
                <td className="py-2 pr-4 text-xs">
                  {!run ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <OutcomeLines
                      intent={actualClassification ? labelIntent(actualClassification.intent) : "—"}
                      escalated={actualEscalated ?? false}
                      action={actualResolution ? labelAction(actualResolution.action) : "—"}
                    />
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
                    <span className="text-xs text-muted-foreground">Not run</span>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1">
                        {result.isSimulated && <Badge tone="info">Simulated</Badge>}
                        <Badge tone={result.passed ? "success" : "danger"}>
                          {result.passed ? "Pass" : "Fail"} ({scores.overallScore.toFixed(2)})
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
        Each scenario is scored on five dimensions: classification, routing, policy, escalation and
        resolution, each an exact match against the expected outcome (✓ correct, ✗ incorrect, ◦ not
        applicable to that scenario). An evidence-quality check is folded into the overall score. A{" "}
        <Badge tone="info">Simulated</Badge> result comes from a fixture provider, not a real model.
      </Card>
    </div>
  );
}

/** An expected or actual outcome, in the operator's vocabulary (src/lib/labels.ts); the canonical values are unchanged. */
function OutcomeLines({
  intent,
  specialists,
  escalated,
  action,
}: {
  intent: string;
  /** Only the expected outcome names specialists; the actual routing is on the ticket's own page. */
  specialists?: string;
  escalated: boolean;
  action: string;
}) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
      <dt className="text-muted-foreground">Intent</dt>
      <dd>{intent}</dd>
      {specialists !== undefined && (
        <>
          <dt className="text-muted-foreground">Specialists</dt>
          <dd>{specialists}</dd>
        </>
      )}
      <dt className="text-muted-foreground">Escalation</dt>
      <dd>{escalated ? "Yes" : "No"}</dd>
      <dt className="text-muted-foreground">Action</dt>
      <dd>{action}</dd>
    </dl>
  );
}
