import type { Metadata } from "next";
import Link from "next/link";
import { getAiMode } from "@/lib/ai/mode";
import { db } from "@/lib/db";
import { LINK_CLASSES } from "@/components/app-state";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TableScroll } from "@/components/ui/TableScroll";
import { RECORDED_LIVE_EVALUATION, type RecordedEvaluation, type RecordedScenario } from "@/lib/evaluation/recordedEvaluation";
import { humanizeIdentifier, labelAction, labelAgent, labelAgentShort, labelIntent } from "@/lib/labels";
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

/**
 * Evaluations: the recorded live evaluation first (a fixed, dated record of one
 * real run, shipped with the app), then this deployment's own evaluation state
 * from its database. The two are never merged or counted together. See
 * DECISIONS.md ("Recorded live evaluation shipped as a verified snapshot").
 */
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
  // In Demo Mode nothing is ever scored, so this deployment's state is one statement rather than a table
  // of "Not run" rows beside the recorded run. Any result a deployment does hold is shown as before.
  const deploymentHasNothingScored = getAiMode() === "demo" && scoredCases.length === 0;

  return (
    <div className="p-4 lg:p-6">
      <h1 className="text-lg font-semibold">Evaluations</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {cases.length} curated scenarios, each scored against a known expected outcome.
      </p>

      <RecordedEvaluationSection record={RECORDED_LIVE_EVALUATION} />

      <section aria-labelledby="deployment-heading" className="mt-8">
        <SectionHeading id="deployment-heading">This deployment</SectionHeading>
        {deploymentHasNothingScored ? (
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            No evaluation has been run in this deployment. Evaluations require real model calls, which Demo Mode
            never makes; demo analyses are scripted replays and are never scored.
          </p>
        ) : (
          <>
            <div className="mt-2 flex flex-col gap-1 text-sm">
              <p>
                <span className="font-medium">Live model evaluation: </span>
                {liveScoredCases.length === 0 ? (
                  <span className="text-muted-foreground">
                    not run yet. A live evaluation calls the configured model and runs only when explicitly started.
                    No result below substitutes for it.
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

            {/* Scrolls inside its own box on a narrow screen; the minimum width keeps the outcome columns legible. */}
            <TableScroll className="mt-4">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <EvaluationTableHeader />
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
                        {/* The canonical scenario key, deliberately shown as-is: it is the scenario's identifier (may wrap at its hyphens). */}
                        <td className="py-2 pr-3 font-medium">{evalCase.scenarioKey}</td>
                        <td className="py-2 pr-3">
                          <Link href={`/tickets/${evalCase.ticketId}`} className={LINK_CLASSES}>
                            {evalCase.ticket.subject}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          <ExpectedOutcome expected={expected} />
                        </td>
                        <td className="py-2 pr-3 text-xs">
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
                        <td className="py-2 pr-3">
                          {!scores ? <span className="text-xs text-muted-foreground">—</span> : <DimensionMarks scores={scores} />}
                        </td>
                        <td className="py-2">
                          {!result || !scores ? (
                            <span className="text-xs text-muted-foreground">Not run</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <div className="flex flex-wrap items-center gap-1">
                                {result.isSimulated && <Badge tone="info">Simulated</Badge>}
                                <ResultBadge passed={result.passed} overallScore={scores.overallScore} />
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
            </TableScroll>
          </>
        )}
      </section>

      <Card dashed padding="lg" className="mt-6 text-sm text-muted-foreground">
        Each scenario is scored on five dimensions: classification, routing, policy, escalation and
        resolution, each an exact match against the expected outcome (✓ correct, ✗ incorrect, ◦ not
        applicable to that scenario). An evidence-quality check is folded into the overall score. A{" "}
        <Badge tone="info">Simulated</Badge> result comes from a fixture provider, not a real model.
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recorded live evaluation
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven"];

/** "24 Sep 2026", in UTC (built by hand: some runtimes abbreviate September as "Sept"). */
function utcDay(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "19:18" in UTC, after rounding the instant down (a start) or up (an end) to the minute. */
function utcMinute(iso: string, round: "down" | "up"): string {
  const ms = Date.parse(iso);
  const minute = new Date((round === "down" ? Math.floor(ms / 60_000) : Math.ceil(ms / 60_000)) * 60_000);
  return `${String(minute.getUTCHours()).padStart(2, "0")}:${String(minute.getUTCMinutes()).padStart(2, "0")}`;
}

const investigative = (agents: readonly string[]) => agents.filter((agent) => agent !== "response");
const agentList = (agents: readonly string[]) => (agents.length > 0 ? agents.map(labelAgentShort).join(", ") : "none");

/**
 * Why a passing scenario was not perfect, in the operator's vocabulary. Built only from the recorded data:
 * a degraded step (`failedAgents`), and each dimension the scorer marked incorrect, stated as expected
 * versus actual (the same comparison the scorer made; Response is excluded from routing, as it is there).
 */
function recordedNotes(scenario: RecordedScenario): string[] {
  const { expected, actual, scores } = scenario;
  const notes = scenario.failedAgents.map((step) => {
    // Only the Policy agent can produce a denial (resolve.ts), so this attribution follows from the record.
    const decidedBy = actual.action === "deny_request" && actual.agents.includes("policy") ? "; the denial came from the Policy agent" : "";
    return `${labelAgent(step)} output failed validation twice and was degraded${decidedBy}.`;
  });
  if (!scores.classificationCorrect) {
    notes.push(`Intent: expected ${labelIntent(expected.expectedIntent)}, got ${labelIntent(actual.intent)}.`);
  }
  if (!scores.routingCorrect) {
    notes.push(
      `Specialists: expected ${agentList(investigative(expected.expectedAgents))}, got ${agentList(investigative(actual.agents))}.`,
    );
  }
  if (scores.policyCorrect === false) {
    notes.push(`Policy: expected ${expected.expectedPolicySlug}, got ${actual.policySlug ?? "none"}.`);
  }
  if (!scores.escalationCorrect) {
    notes.push(`Escalation: expected ${expected.expectedEscalation ? "yes" : "no"}, got ${actual.escalated ? "yes" : "no"}.`);
  }
  if (!scores.resolutionCorrect) {
    notes.push(`Action: expected ${labelAction(expected.expectedAction)}, got ${labelAction(actual.action)}.`);
  }
  return notes;
}

/** The recorded run's models, grouped: "claude-haiku-4-5-20251001 (Classifier, Billing, Policy)". */
function modelsInUse(record: RecordedEvaluation): { model: string; steps: string }[] {
  const byModel = new Map<string, string[]>();
  for (const { step, model } of record.routing) byModel.set(model, [...(byModel.get(model) ?? []), labelAgentShort(step)]);
  return [...byModel].map(([model, steps]) => ({ model, steps: steps.join(", ") }));
}

function RecordedEvaluationSection({ record }: { record: RecordedEvaluation }) {
  const { totals } = record;
  const day = utcDay(record.recordedAt.start);
  const providers = [...new Set(record.routing.map((r) => humanizeIdentifier(r.provider)))].join(", ");
  const imperfect = record.scenarios.filter((s) => recordedNotes(s).length > 0).length;

  return (
    <section aria-labelledby="recorded-heading" className="mt-6">
      <SectionHeading id="recorded-heading">Recorded live evaluation · {day}</SectionHeading>
      <div className="mt-1 flex max-w-3xl flex-col gap-2 text-sm">
        <p className="text-muted-foreground">
          One run of all {totals.scenarios} scenarios with real model calls ({providers}), recorded on {day},{" "}
          {utcMinute(record.recordedAt.start, "down")}–{utcMinute(record.recordedAt.end, "up")} UTC, against commit{" "}
          <code className="font-mono text-xs">{record.codeCommit}</code>, and shipped with this deployment as a fixed
          record. It is not re-run here and does not measure this deployment. Demo Mode never calls a model.
        </p>
        <p className="font-medium">
          {totals.passed} of {totals.scenarios} passed (overall score ≥ {record.passThreshold}) · {totals.agentSteps} agent
          steps, {totals.failedAgentSteps} failed validation after a retry · estimated model cost $
          {totals.estimatedCostUsd.toFixed(2)}
        </p>
        <p className="text-muted-foreground">
          A single run: it shows how the system performed that day, not a guaranteed accuracy rate.{" "}
          {COUNT_WORDS[imperfect] ?? imperfect} scenarios passed with a mismatch or a degraded agent; see their notes.
          Changes made after this run (<code className="font-mono text-xs">29fd3c0</code>) were not measured live.
        </p>
        <p className="text-xs text-muted-foreground">
          Models:{" "}
          {modelsInUse(record).map(({ model, steps }, i) => (
            <span key={model}>
              {i > 0 && "; "}
              <code className="font-mono">{model}</code> ({steps})
            </span>
          ))}
          .
        </p>
      </div>

      <TableScroll className="mt-4">
        <table aria-labelledby="recorded-heading" className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <EvaluationTableHeader />
          </thead>
          <tbody>
            {record.scenarios.map((scenario) => {
              const notes = recordedNotes(scenario);
              return (
                <tr key={scenario.scenarioKey} className="border-b border-zinc-100 align-top dark:border-zinc-900">
                  {/* The canonical scenario key, deliberately shown as-is: it is the scenario's identifier. It may
                      wrap at its hyphens, so the table's six columns fit a 1024px screen without scrolling. */}
                  <td className="py-2 pr-3 font-medium">{scenario.scenarioKey}</td>
                  {/* Plain text, not a link: this deployment's ticket for the scenario is current data, not the
                      ticket state this run evaluated, so the historical record does not point at it. */}
                  <td className="py-2 pr-3">{scenario.ticketSubject}</td>
                  <td className="py-2 pr-3 text-xs">
                    <ExpectedOutcome expected={scenario.expected} />
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    <OutcomeLines
                      intent={labelIntent(scenario.actual.intent)}
                      specialists={agentList(scenario.actual.agents)}
                      escalated={scenario.actual.escalated}
                      action={labelAction(scenario.actual.action)}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <DimensionMarks scores={scenario.scores} />
                  </td>
                  <td className="py-2">
                    <div className="flex flex-col gap-1">
                      <div>
                        <ResultBadge passed={scenario.passed} overallScore={scenario.scores.overallScore} />
                      </div>
                      {notes.map((note) => (
                        <p key={note} className="max-w-xs text-xs text-muted-foreground">
                          {note}
                        </p>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared by both tables
// ---------------------------------------------------------------------------

function EvaluationTableHeader() {
  return (
    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
      <th className="py-2 pr-3">Scenario</th>
      <th className="py-2 pr-3">Ticket</th>
      <th className="py-2 pr-3">Expected</th>
      <th className="py-2 pr-3">Actual</th>
      <th className="py-2 pr-3">Dimensions</th>
      <th className="py-2">Result</th>
    </tr>
  );
}

function ExpectedOutcome({ expected }: { expected: EvaluationExpectedOutcome }) {
  return (
    <OutcomeLines
      intent={labelIntent(expected.expectedIntent)}
      specialists={expected.expectedAgents.map(labelAgentShort).join(", ")}
      escalated={expected.expectedEscalation}
      action={labelAction(expected.expectedAction)}
    />
  );
}

function DimensionMarks({ scores }: { scores: EvaluationResultScores }) {
  return (
    // Each mark stays beside its dimension (the column is narrow once both outcome columns list specialists).
    <div className="flex flex-col gap-0.5 text-xs">
      {DIMENSION_LABELS.map(({ key, label }) => {
        const value = scores[key];
        return (
          <span key={key} className="whitespace-nowrap">
            {value === null ? "◦" : value ? "✓" : "✗"} {label}
          </span>
        );
      })}
    </div>
  );
}

function ResultBadge({ passed, overallScore }: { passed: boolean; overallScore: number }) {
  return (
    <Badge tone={passed ? "success" : "danger"} className="whitespace-nowrap">
      {passed ? "Pass" : "Fail"} ({overallScore.toFixed(2)})
    </Badge>
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
  /** The agents expected or recorded; omitted for this deployment's actual outcome, whose routing is on the ticket's own page. */
  specialists?: string;
  escalated: boolean;
  action: string;
}) {
  return (
    // Each value is a short label kept on one line (a 1024px table was breaking "General inquiry" into two);
    // only the specialist list may wrap, at its commas.
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
      <dt className="text-muted-foreground">Intent</dt>
      <dd className="whitespace-nowrap">{intent}</dd>
      {specialists !== undefined && (
        <>
          <dt className="text-muted-foreground">Specialists</dt>
          <dd>{specialists}</dd>
        </>
      )}
      <dt className="text-muted-foreground">Escalation</dt>
      <dd className="whitespace-nowrap">{escalated ? "Yes" : "No"}</dd>
      <dt className="text-muted-foreground">Action</dt>
      <dd className="whitespace-nowrap">{action}</dd>
    </dl>
  );
}
