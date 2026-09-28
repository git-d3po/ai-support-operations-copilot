import { z } from "zod";
import {
  AGENT_KEYS,
  AgentKeySchema,
  EscalationTeamSchema,
  EvaluationExpectedOutcomeSchema,
  EvaluationResultSchema,
  ResolutionActionSchema,
  TicketIntentSchema,
  type AgentKey,
  type EvaluationExpectedOutcome,
} from "@/lib/ai/schemas";
import { isSimulatedProvider } from "@/lib/ai/providers/provenance";

/**
 * The contract for a recorded live evaluation: a fixed, committed record of
 * one past `npm run eval` run, shown on the Evaluations page as historical
 * evidence (DECISIONS.md, "Recorded live evaluation shipped as a verified
 * snapshot"). It is built from the evaluation system's own schemas
 * (`EvaluationExpectedOutcomeSchema`, `EvaluationResultSchema` and the shared
 * vocabularies) wrapped in a small envelope for provenance; it adds no
 * evaluation semantics of its own.
 *
 * This module is pure: the schema, the derivation of a record from source rows,
 * and its deterministic serialization. The database reading lives in
 * scripts/exportEvaluationSnapshot.ts; the committed record is loaded by
 * ./recordedEvaluation.ts. Nothing here runs an evaluation or scores anything:
 * every score is the scorer's own stored output.
 */

/** A pipeline step as persisted on `AgentInvocation.agentKey`: the classifier plus every agent. */
const PIPELINE_STEPS = ["classifier", ...AGENT_KEYS] as const;
const PipelineStepSchema = z.enum(PIPELINE_STEPS);
type PipelineStep = z.infer<typeof PipelineStepSchema>;

const IsoTimestampSchema = z.iso.datetime();

/** One scenario's record. Strict: a field that is not in the contract (customer data, raw text) is rejected. */
const RecordedScenarioSchema = z
  .object({
    scenarioKey: z.string().min(1),
    ticketSubject: z.string().min(1),
    /** The expected outcome the run was scored against, as stored with the case. */
    expected: EvaluationExpectedOutcomeSchema,
    /** What the pipeline actually produced, from the scored run's persisted outputs. */
    actual: z
      .object({
        intent: TicketIntentSchema,
        /** Every agent that ran (Response included, as in `expectedAgents`), in canonical `AGENT_KEYS` order. */
        agents: z.array(AgentKeySchema),
        escalated: z.boolean(),
        escalationTeam: EscalationTeamSchema.nullable(),
        action: ResolutionActionSchema,
        /** The Policy agent's applicable policy, when it decided one. */
        policySlug: z.string().nullable(),
      })
      .strict(),
    /** Steps whose output failed validation after the retry and were degraded (keys only, never the raw error). */
    failedAgents: z.array(PipelineStepSchema),
    /** The scorer's stored output, verbatim. */
    scores: EvaluationResultSchema.strict(),
    passed: z.boolean(),
    /** `EvaluationResult.id` in the source database: the key for checking this record against its source. */
    sourceResultId: z.string().min(1),
  })
  .strict();

export const RecordedEvaluationSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** A stable name derived from the run's date. There is no evaluation-run entity in the database: a run is its result rows. */
    id: z.string().regex(/^live-\d{4}-\d{2}-\d{2}$/),
    /** When the run's result rows were written (`EvaluationResult.createdAt`, first and last), in UTC. */
    recordedAt: z.object({ start: IsoTimestampSchema, end: IsoTimestampSchema }).strict(),
    /**
     * The repository commit the run evaluated. Not stored in the database: it is
     * documented provenance (the project's decision log records it), supplied to
     * the exporter for this specific source file.
     */
    codeCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
    source: z
      .object({
        /** The evaluation database's file name (never a path). It stays local and is never committed. */
        database: z.string().regex(/^[\w.-]+\.db$/),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        /** The record aggregates this table's rows, one per scenario. */
        records: z.literal("EvaluationResult"),
      })
      .strict(),
    /** The pass threshold in force at `codeCommit`. */
    passThreshold: z.number().min(0).max(1),
    /** The provider that served, and the model routed to, each pipeline step. Real providers only. */
    routing: z.array(
      z
        .object({
          step: PipelineStepSchema,
          provider: z.string().refine((key) => !isSimulatedProvider(key), "a simulated provider is not a live evaluation"),
          model: z.string().min(1),
        })
        .strict(),
    ),
    totals: z
      .object({
        scenarios: z.number().int().nonnegative(),
        passed: z.number().int().nonnegative(),
        /** One per pipeline step that ran (`AgentInvocation` rows); a retry happens inside a step. */
        agentSteps: z.number().int().nonnegative(),
        failedAgentSteps: z.number().int().nonnegative(),
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        /** The sum of each step's stored cost estimate (configured per-token prices), not a bill. */
        estimatedCostUsd: z.number().nonnegative(),
      })
      .strict(),
    scenarios: z.array(RecordedScenarioSchema),
  })
  .strict();

export type RecordedEvaluation = z.infer<typeof RecordedEvaluationSchema>;
export type RecordedScenario = RecordedEvaluation["scenarios"][number];

/** Parses a recorded evaluation, failing loudly on anything outside the contract. */
export function parseRecordedEvaluation(data: unknown): RecordedEvaluation {
  return RecordedEvaluationSchema.parse(data);
}

/** The committed form: 2-space JSON in the record's own key order, with a trailing newline. */
export function serializeRecordedEvaluation(record: RecordedEvaluation): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Derivation from source rows (used by scripts/exportEvaluationSnapshot.ts)
// ---------------------------------------------------------------------------

/** The source rows the exporter reads, as plain values. */
export interface RecordedEvaluationSource {
  cases: { id: string; scenarioKey: string; ticketSubject: string; expectedOutcome: unknown }[];
  results: {
    id: string;
    evaluationCaseId: string;
    orchestrationRunId: string;
    scores: unknown;
    passed: boolean;
    isSimulated: boolean;
    createdAt: Date;
  }[];
  runs: { id: string; status: string; isSimulated: boolean; classification: unknown; resolution: unknown; escalation: unknown }[];
  invocations: {
    orchestrationRunId: string;
    agentKey: string;
    status: string;
    finding: unknown;
    model: string;
    provider: string;
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCostUsd: number | null;
  }[];
}

/** Provenance that is not in the database, supplied by the exporter. */
export interface RecordedEvaluationProvenance {
  database: string;
  sha256: string;
  codeCommit: string;
  passThreshold: number;
}

/** A curated scenario as defined in prisma/data/scenarios.ts (only the fields the record is checked against). */
export interface ScenarioDefinition {
  key: string;
  ticket: { subject: string };
  expectedOutcome: EvaluationExpectedOutcome;
}

const stepOrder = (step: string) => PIPELINE_STEPS.indexOf(step as PipelineStep);

/** JSON with object keys sorted, for comparing values whose key order may differ. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

const ClassificationIntentSchema = z.object({ intent: TicketIntentSchema });
const ResolutionActionOnlySchema = z.object({ action: ResolutionActionSchema });
const EscalationTeamOnlySchema = z.object({ targetTeam: EscalationTeamSchema });
const PolicyFindingSlugSchema = z.object({
  policyDecision: z.object({ applicablePolicy: z.object({ slug: z.string() }) }).nullable().optional(),
});

/**
 * Builds a recorded evaluation from one live run's source rows, refusing (with
 * every problem listed) anything that is not a complete, real, internally
 * consistent run of exactly the current curated scenarios. Deterministic: the
 * same rows always give the same record.
 */
export function deriveRecordedEvaluation(
  source: RecordedEvaluationSource,
  provenance: RecordedEvaluationProvenance,
  scenarios: readonly ScenarioDefinition[],
): RecordedEvaluation {
  const problems: string[] = [];
  const casesById = new Map(source.cases.map((c) => [c.id, c]));
  const runsById = new Map(source.runs.map((r) => [r.id, r]));
  const definitions = new Map(scenarios.map((s) => [s.key, s]));

  // Exactly the current scenarios, one result each.
  const caseKeys = source.cases.map((c) => c.scenarioKey).sort();
  const definedKeys = [...definitions.keys()].sort();
  if (canonical(caseKeys) !== canonical(definedKeys)) {
    problems.push(`scenario set differs from SCENARIOS: source [${caseKeys.join(", ")}], defined [${definedKeys.join(", ")}]`);
  }
  if (source.results.length !== scenarios.length) {
    problems.push(`expected ${scenarios.length} results (one per scenario), found ${source.results.length}`);
  }
  const resultsPerCase = new Map<string, number>();
  for (const result of source.results) {
    resultsPerCase.set(result.evaluationCaseId, (resultsPerCase.get(result.evaluationCaseId) ?? 0) + 1);
  }
  for (const c of source.cases) {
    const count = resultsPerCase.get(c.id) ?? 0;
    if (count !== 1) problems.push(`${c.scenarioKey}: expected exactly one result, found ${count}`);
  }

  const routing = new Map<string, Set<string>>();
  const recorded: RecordedScenario[] = [];
  let agentSteps = 0;
  let failedAgentSteps = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostUsd = 0;

  for (const result of source.results) {
    const evalCase = casesById.get(result.evaluationCaseId);
    const run = runsById.get(result.orchestrationRunId);
    const key = evalCase?.scenarioKey ?? `result ${result.id}`;
    if (!evalCase) {
      problems.push(`${key}: result has no evaluation case`);
      continue;
    }
    if (!run) {
      problems.push(`${key}: scored run ${result.orchestrationRunId} is missing`);
      continue;
    }
    if (result.isSimulated || run.isSimulated) problems.push(`${key}: simulated result or run (not a live evaluation)`);
    if (run.status !== "completed") problems.push(`${key}: run status is "${run.status}", not "completed"`);

    const definition = definitions.get(evalCase.scenarioKey);
    if (definition) {
      if (definition.ticket.subject !== evalCase.ticketSubject) problems.push(`${key}: ticket subject differs from SCENARIOS`);
      if (canonical(definition.expectedOutcome) !== canonical(evalCase.expectedOutcome)) {
        problems.push(`${key}: expected outcome differs from SCENARIOS`);
      }
    }

    const expected = EvaluationExpectedOutcomeSchema.safeParse(evalCase.expectedOutcome);
    const scores = EvaluationResultSchema.safeParse(result.scores);
    const classification = ClassificationIntentSchema.safeParse(run.classification);
    const resolution = ResolutionActionOnlySchema.safeParse(run.resolution);
    const escalation = run.escalation == null ? null : EscalationTeamOnlySchema.safeParse(run.escalation);
    if (!expected.success) problems.push(`${key}: stored expected outcome is invalid`);
    if (!scores.success) problems.push(`${key}: stored scores are invalid`);
    if (!classification.success) problems.push(`${key}: run has no valid classification`);
    if (!resolution.success) problems.push(`${key}: run has no valid resolution`);
    if (escalation && !escalation.success) problems.push(`${key}: run has an invalid escalation`);
    if (scores.success && result.passed !== scores.data.overallScore >= provenance.passThreshold) {
      problems.push(`${key}: stored pass (${result.passed}) disagrees with score ${scores.data.overallScore} at ${provenance.passThreshold}`);
    }

    const steps = source.invocations.filter((inv) => inv.orchestrationRunId === run.id);
    const agents = new Set<AgentKey>();
    const failed = new Set<PipelineStep>();
    let policySlug: string | null = null;
    for (const inv of steps) {
      if (stepOrder(inv.agentKey) < 0) {
        problems.push(`${key}: unknown pipeline step "${inv.agentKey}"`);
        continue;
      }
      if (isSimulatedProvider(inv.provider)) problems.push(`${key}: ${inv.agentKey} was served by "${inv.provider}", not a real provider`);
      if (!routing.has(inv.agentKey)) routing.set(inv.agentKey, new Set());
      routing.get(inv.agentKey)!.add(`${inv.provider}\u0000${inv.model}`);
      if (inv.agentKey !== "classifier") agents.add(inv.agentKey as AgentKey);
      if (inv.status === "failed") failed.add(inv.agentKey as PipelineStep);
      if (inv.agentKey === "policy") {
        const finding = PolicyFindingSlugSchema.safeParse(inv.finding);
        policySlug = finding.success ? (finding.data.policyDecision?.applicablePolicy.slug ?? null) : null;
      }
      agentSteps++;
      if (inv.status === "failed") failedAgentSteps++;
      inputTokens += inv.inputTokens ?? 0;
      outputTokens += inv.outputTokens ?? 0;
      estimatedCostUsd += inv.estimatedCostUsd ?? 0;
    }

    if (!expected.success || !scores.success || !classification.success || !resolution.success || (escalation && !escalation.success)) {
      continue;
    }
    const bySteps = (a: string, b: string) => stepOrder(a) - stepOrder(b);
    recorded.push({
      scenarioKey: evalCase.scenarioKey,
      ticketSubject: evalCase.ticketSubject,
      expected: expected.data,
      actual: {
        intent: classification.data.intent,
        agents: [...agents].sort(bySteps),
        escalated: escalation !== null,
        escalationTeam: escalation?.success ? escalation.data.targetTeam : null,
        action: resolution.data.action,
        policySlug,
      },
      failedAgents: [...failed].sort(bySteps),
      scores: scores.data,
      passed: result.passed,
      sourceResultId: result.id,
    });
  }

  for (const [step, pairs] of routing) {
    if (pairs.size !== 1) problems.push(`${step}: served by more than one provider/model within the run`);
  }
  if (source.results.length === 0) problems.push("no results");

  if (problems.length > 0) {
    throw new Error(`Refusing to record this evaluation:\n- ${problems.join("\n- ")}`);
  }

  const createdAt = source.results.map((r) => r.createdAt.toISOString()).sort();
  const start = createdAt[0];
  const record: RecordedEvaluation = {
    schemaVersion: 1,
    id: `live-${start.slice(0, 10)}`,
    recordedAt: { start, end: createdAt[createdAt.length - 1] },
    codeCommit: provenance.codeCommit,
    source: { database: provenance.database, sha256: provenance.sha256, records: "EvaluationResult" },
    passThreshold: provenance.passThreshold,
    routing: [...routing.entries()]
      .sort(([a], [b]) => stepOrder(a) - stepOrder(b))
      .map(([step, pairs]) => {
        const [provider, model] = [...pairs][0].split("\u0000");
        return { step: step as PipelineStep, provider, model };
      }),
    totals: {
      scenarios: recorded.length,
      passed: recorded.filter((s) => s.passed).length,
      agentSteps,
      failedAgentSteps,
      inputTokens,
      outputTokens,
      // Rounded to a millionth of a dollar, only to drop floating-point summation noise.
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
    },
    scenarios: recorded.sort((a, b) => (a.scenarioKey < b.scenarioKey ? -1 : a.scenarioKey > b.scenarioKey ? 1 : 0)),
  };
  // The record must satisfy its own contract before it is ever written.
  return parseRecordedEvaluation(record);
}
