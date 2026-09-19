# Evaluation

Evaluation is a first-class product feature, not a side script — see
DECISIONS.md ("Why evaluation is a first-class feature"). This document
defines what's measured, how, and its current implementation status.

## Curated scenarios

`prisma/data/scenarios.ts` defines 10 tickets, each grounded in specific,
hand-authored account/billing/conversation data so a correct AI analysis is
actually determinable:

| Scenario key | Tests |
|---|---|
| `password-reset` | Standard case, no escalation |
| `duplicate-billing` | Billing + Policy fast-path resolution |
| `prohibited-refund` | Policy correctly *denies* a refund outside policy conditions |
| `legitimate-refund` | Policy correctly *approves* a refund within conditions |
| `failed-payment` | Distinguishing "monitor" from "act" when the customer already self-served |
| `known-technical-issue` | Technical Agent grounds in a specific known-issue doc |
| `technical-escalation` | Escalation triggers when the documented workaround already failed |
| `suspicious-activity` | Security always escalates, regardless of other findings |
| `ambiguous-request` | System correctly does *less* (no specialist agents) when there's nothing to investigate |
| `multi-domain` | Two independent resolvable issues in one ticket, no escalation needed |

Each scenario carries an `expectedOutcome` (`EvaluationExpectedOutcomeSchema`
in `src/lib/ai/schemas.ts`): expected intent, expected agents, expected
policy (or `null`), expected escalation (boolean), expected resolution
action, and free-text notes explaining *why* that's correct. These are
seeded into the `EvaluationCase` table, one per curated `Ticket`
(`ticket.scenarioKey` links them).

## Evaluation dimensions

| Dimension | Question | Computed from |
|---|---|---|
| Classification accuracy | Did the orchestrator detect the right intent? | `OrchestrationRun.classification.intent` vs. `expectedOutcome.expectedIntent` |
| Routing accuracy | Did it invoke the right specialist agents — no more, no fewer? | `AgentInvocation` rows' agent keys vs. `expectedOutcome.expectedAgents` |
| Policy accuracy | Did the Policy Agent cite the correct policy and reach the correct decision? | Policy Agent's `AgentFinding.policyReferences` / decision vs. `expectedOutcome.expectedPolicySlug` |
| Escalation accuracy | Did it escalate exactly when it should (no more, no less)? | `OrchestrationRun.escalation !== null` vs. `expectedOutcome.expectedEscalation` |
| Resolution accuracy | Did it reach the correct final action? | `OrchestrationRun.resolution.action` vs. `expectedOutcome.expectedAction` |
| Grounding / evidence quality | Is each finding's evidence actually drawn from the ticket/account data, not fabricated? | Manual rubric initially (see "Scoring," below); a model-graded check is a Phase 2+ candidate |

`EvaluationResultSchema` (`src/lib/ai/schemas.ts`) captures a boolean for
each of the first five dimensions, a 0–1 `evidenceQuality` score, an
aggregate `overallScore`, and free-text `notes` — stored per scored run in
the `EvaluationResult` table, linked to the `EvaluationCase` and the
specific `OrchestrationRun` that was scored.

## Current status (Phase 2)

- All 10 scenarios exist, are seeded, and their `expectedOutcome` values are
  schema-validated (`tests/unit/schemas.test.ts`).
- **The full pipeline is genuinely model-backed**: `classifyTicket()`, all
  5 specialist agents, and `resolveOutcome()` are real (see
  ARCHITECTURE.md, "Orchestration pipeline") — every dimension below is
  now measurable, not just routing.
- **The evaluation runner exists and is tested for safety**
  (`src/lib/evaluation/runEvaluation.ts`, `scoreOutcome()` in `score.ts`,
  11 unit tests for the scorer's branch coverage, an integration test
  proving it never fabricates a result when the pipeline can't actually
  run) — but **it has not been executed against a real model provider**.
  There is no `ANTHROPIC_API_KEY` configured in this development
  environment, and this project's standing rule is that no real model
  credential is ever used without explicitly asking first (see
  DECISIONS.md, "The evaluation runner refuses to run without a real,
  user-provided API key"). The Evaluations page correctly shows "not run"
  for every scenario as a result — that's accurate, not a placeholder.
- **`npm run test:e2e`'s `runAnalysis.spec.ts` is not a substitute for
  this.** It proves the pipeline's wiring, persistence, and UI rendering
  work end to end using a deterministic fixture provider tuned to one
  ticket — it demonstrates the mechanism works, not that the AI's
  judgment is correct. Only a real evaluation run measures that.

## Running the suite

```bash
npm run eval
```

Requires `ANTHROPIC_API_KEY` in `.env` — the script checks for it and
refuses to run otherwise, rather than silently falling back to anything
else. When run, for each of the 10 `EvaluationCase` rows it:

1. Calls `analyzeTicket(ticketId)` — the exact same function "Run AI
   analysis" uses — against the real configured provider.
2. Scores the resulting `OrchestrationOutcome` against `expectedOutcome`
   via `scoreOutcome()`.
3. Persists an `EvaluationResult` row (scores + pass/fail against
   `PASS_THRESHOLD = 0.85`, chosen because escalation/resolution
   correctness are weighted heavily in `overallScore` — see "Scoring
   notes").
4. Prints a per-scenario pass/fail summary and an aggregate count.

The Evaluations page reads these results live once they exist; nothing
about it needs to change when a real run happens.

## Scoring notes

Implemented in `src/lib/evaluation/score.ts` (`scoreOutcome()`), unit
tested branch-by-branch in `score.test.ts`:

- Boolean dimensions (classification/routing/policy/escalation/resolution)
  are exact-match against the expected value — there's no partial credit,
  by design: these are meant to be unambiguous per-scenario checks, not
  fuzzy quality scores. `policyCorrect` is `null` (not applicable, not
  "wrong") for scenarios where no policy decision was ever expected —
  `null` results are excluded from `overallScore`'s weighting entirely
  rather than counted against the case.
- `evidenceQuality` is the one continuous, non-exact-match dimension: the
  fraction of investigative findings (excluding the Response agent's own)
  that have at least one evidence item and didn't fail. This is a simple,
  programmatic rubric — not a model-graded judge — matching "checked
  programmatically where possible before reaching for a model-graded
  judge."
- `overallScore` is a weighted average: escalation and resolution
  correctness carry weight 2, classification and routing weight 1, policy
  weight 1.5 (when applicable), and evidence quality contributes on the
  same scale as one more weight-1 dimension. This reflects that an
  incorrect escalation call has real operational cost, while an
  imperfectly-worded intent label often still produces a workable outcome
  — exactly the priority `resolveOutcome()` itself follows (Risk's
  escalation call is checked before Policy's decision, which is checked
  before Technical's flags).
- `PASS_THRESHOLD = 0.85` (`runEvaluation.ts`) is intentionally high given
  those weights — passing means the operationally important dimensions
  were right, not "mostly fine."

## Future extensions (not committed to yet)

- Expanding beyond 10 curated cases if they stop catching real regressions.
- A held-out scenario set (never referenced during development) if the
  curated 10 start to feel "trained to."
- Tracking evaluation score history over time as the orchestrator changes,
  to catch regressions between phases.
