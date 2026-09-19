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

## Current status (foundation phase)

- All 10 scenarios exist, are seeded, and their `expectedOutcome` values are
  schema-validated (`tests/unit/schemas.test.ts`).
- **Routing accuracy is real today**: `selectAgents()` is fully implemented
  and unit-tested against all 10 scenarios' `expectedAgents`
  (`tests/unit/selectAgents.test.ts`) — this is the one dimension that
  doesn't depend on a live model call.
- Classification, policy, escalation, and resolution accuracy cannot be
  scored yet because `classifyTicket()`, the specialist agents, and
  `resolveOutcome()` are still deterministic placeholders (see TODO.md) —
  there is no real model output yet to compare against expected outcomes.
- The Evaluations page (`src/app/evaluations/page.tsx`) lists all 10 cases
  and their expected outcomes today, live from the database; it correctly
  shows "not run" for results, because none exist yet.

## Running the suite (once agents are implemented)

The intended flow, once Phase 2 lands real agent logic:

1. For each `EvaluationCase`, run `runOrchestration()` against its ticket.
2. Persist the result as an `OrchestrationRun` (+ `AgentInvocation` rows).
3. Score it against `expectedOutcome` on all six dimensions above, writing
   an `EvaluationResult` row.
4. Aggregate per-dimension pass rates across all 10 cases; surface on the
   Evaluations page (already scaffolded to read this table).

This should be exposed as both a script (`npm run eval`, not yet created —
see TODO.md) and, if useful, a "Run evaluations" action in the Evaluations
UI itself.

## Scoring notes

- Boolean dimensions (classification/routing/policy/escalation/resolution)
  are exact-match against the expected value — there's no partial credit,
  by design: these are meant to be unambiguous per-scenario checks, not
  fuzzy quality scores.
- `evidenceQuality` is the one genuinely subjective dimension. Initial
  implementation should use a simple rubric (does each citation reference
  data that actually exists on the ticket/account?) checked programmatically
  where possible (e.g. "does the cited policy slug exist in the Policy
  table") before reaching for a model-graded judge.
- A scenario's `overallScore` should weight escalation and policy
  correctness above cosmetic classification wording, since an incorrect
  escalation decision has real operational cost and an incorrect intent
  label often still produces a workable outcome.

## Future extensions (not committed to yet)

- Expanding beyond 10 curated cases if they stop catching real regressions.
- A held-out scenario set (never referenced during development) if the
  curated 10 start to feel "trained to."
- Tracking evaluation score history over time as the orchestrator changes,
  to catch regressions between phases.
