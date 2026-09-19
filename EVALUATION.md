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
| `prohibited-refund` | Policy correctly *denies* a refund of a usage-based (API overage) charge, which Refund Policy condition 3 makes non-refundable |
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

## Intent taxonomy and primary-intent rule

Until this section existed, the ten intents in `TICKET_INTENTS`
(`src/lib/ai/schemas.ts`) were only a list of names: the classifier prompt
says "exactly one of" and nothing in the repository defined them or said how
to pick one for a ticket with several issues. Each `expectedIntent` below is
graded by exact match (see "Evaluation dimensions"), so the meaning of a
label has to be specified, not inferred.

**Specification, not implementation.** These definitions and the
primary-intent rule document the intended product specification. They do not
claim that the current classifier prompt already encodes them: the classifier
currently receives only the list of intent names (`TICKET_INTENTS`), not this
taxonomy or the precedence rule.

**Evidence base.** The evidence used is limited to artifacts that predate any
live model evaluation: the seeded ticket templates
(`prisma/data/ticketTemplates.ts`), the curated scenario descriptions,
rationales and expectations (`prisma/data/scenarios.ts`), the seeded policies
and product docs, the schema field descriptions, and the pre-live product and
evaluation documentation. No live classifier output was used to define any
intent or the rule. The routing overrides added after live findings
(`duplicate_charge`, `password_reset`) are deliberately not cited as evidence.

Those artifacts show how each intent is used and how routing, policy and
resolution work. They do **not** state, on their own, what `intent` is *for*
or how to choose among several issues in one ticket. Those are
**specification choices** made in this section and labeled as such where they
occur; the rule is then interpreted from the pre-live evidence subject to those
choices. Evidence strength is stated per intent: **strong** means two or more
independent kinds of artifact agree; **limited** means one kind, or artifacts
that conflict; **insufficient** is said outright where it applies. A
definition is never more precise than its evidence.

### What `intent` and `domains` each represent

- **`intent`** is the single primary classification; exactly one value is
  chosen (the schema takes one `TicketIntentSchema` value). **Specification
  choice:** it names the one issue that should govern how the ticket is
  handled. No pre-live artifact states this; it is the premise on which the
  primary-intent rule below is built.
- **`domains`** is the set of all specialist domains (`billing`, `policy`,
  `technical`, `risk`) the ticket implicates (schema: "Which specialist
  domains this ticket touches"). It can include domains beyond the primary
  intent's, and can be empty.
- **Specification choice:** a ticket may therefore involve several issues. The
  primary issue is `intent`; secondary issues are represented through
  `domains` (and the specialists routed from them), never through an extra
  intent. There is no "mixed" intent and none should be added. `domains`
  records which specialists are needed, not what each secondary issue is.

### Definitions

| Intent | Means | Evidence | Strength |
|---|---|---|---|
| `password_reset` | The customer has lost access because of a password problem (forgotten password, or a reset email that has not arrived, or access lost after changing the account email) and wants access restored through the standard reset flow. | Both seeded templates; Account Security Policy ("Password reset requests are handled automatically via the standard verified-email reset flow … unless the account has an open security flag"); the `password-reset` scenario description; the Technical Agent prompt's `auto_resolvable` example | strong |
| `duplicate_charge` | The customer reports being charged more than once for the same thing. The Duplicate Charge Policy defines it: same account, same amount, same invoice or subscription, within 48 hours, with no plan or quantity change. A request to refund a duplicate is `duplicate_charge`, not `refund_request` (see the specificity clause). | Template ("charged twice"); Duplicate Charge Policy; `duplicate-billing` description ("a textbook duplicate charge") | strong |
| `refund_request` | The customer asks for money back on a charge that is not a duplicate: end of use, unused time or seats, an accidental upgrade. Decided under the Refund Policy. | Two templates; Refund Policy; the two refund scenarios; the pre-live routing rule that adds Policy | strong |
| `failed_payment` | The customer reports or asks about a charge that failed or was declined, and its retry or payment method. | Template; Invoices & Billing FAQ (failed charges are retried); scenario | strong |
| `technical_issue` | A product malfunction, performance or integration problem: something the customer expects to work is not working. | Two templates (integration not posting, slow dashboard); the known-issue and troubleshooting docs; the two technical scenarios | strong |
| `account_security` | Suspected unauthorized access or compromise: logins from unrecognized locations, unexpected permission changes, unrecognized API keys. Such reports always escalate to Trust & Safety and are not resolved directly. | Account Security Policy (explicit); Escalation Policy (Trust & Safety); `suspicious-activity` scenario; the pre-live routing rule that always adds Risk | strong (from policy and scenario) |
| `cancellation` | The customer asks to end the subscription; it takes effect at the end of the billing period. | Template; Cancellation Policy; the pre-live routing rule that adds Risk and Policy | strong for meaning; no curated scenario exercises it |
| `billing_question` | Informational billing questions: what a line item is, or when and how charges are billed. The pre-live `multi-domain` scenario also expects this intent for a mixed ticket containing a duplicate charge and a technical issue, and no artifact explains that use. Beyond the informational core, its scope is **not specified by the evidence**. | Two seeded templates and the Invoices & Billing FAQ (informational use); the `multi-domain` scenario's expected intent (mixed-ticket use) | limited and **conflicted**: the pre-live artifacts disagree about its scope, and this document does not resolve that by evidence |
| `feature_question` | A question about whether or how the product supports a capability. | One template only (a customer asking whether automations can run on a recurring schedule); no scenario, no routing rule, no policy category | limited |
| `general_inquiry` | The residual intent: no identifiable product, billing or account issue (vague, under-specified, or a benign check-in). Handled with a response only. | The `ambiguous-request` scenario; one "checking in" template | limited; the boundary with `billing_question` and `feature_question` is **insufficiently specified** |

Known gaps, stated rather than resolved:

- **`account_security` template.** The seeded background template for this
  intent is "Enabling SSO for our team", a benign setup question that does not
  fit the definition above, which is taken from the policy and scenario
  evidence. Which intent, if any, an SSO-setup question should have is
  **insufficiently specified**: no artifact decides it.
- **`billing_question` scope.** The pre-live evidence conflicts: the
  templates and the FAQ show informational use, while the `multi-domain`
  scenario expects it for a mixed ticket. This document does not settle that
  by evidence. Treating `billing_question` as a fallback intent (rule clause 1
  below) is a **specification decision**, not an artifact-derived fact.
- **Requests with no matching intent.** A plan change (for example returning
  to a lower plan) has no intent of its own. It can only appear as a secondary
  issue carried by `domains`.

### Primary-intent rule for mixed tickets

The rule builds on the specification choice above (the primary intent names
the issue that should govern handling) and on the resolution priority the
project documented before live testing. That priority does not come from one
uniform source: the support differs by tier, and is stated per tier here so
that no source is credited with more than it establishes.

- **Tier 1, `account_security`.** Supported by the product spec's description
  of the Risk agent ("the safety net that can force escalation regardless of
  other findings"), the scoring notes below ("Risk's escalation call is
  checked before Policy's decision"), `resolveOutcome()` checking Risk first,
  the Account Security and Escalation Policies, and the pre-live routing rule
  that always adds Risk for this intent.
- **Tier 2 above tier 3.** Policy-decided outcomes (`duplicate_charge`,
  `refund_request`, `cancellation`) above technical ones is supported by the
  scoring notes (Policy's decision "is checked before Technical's flags") and
  by the order of `resolveOutcome()`'s rules. That these intents are decided by
  Policy is supported by the Duplicate Charge, Refund and Cancellation
  Policies, the expected agents of the refund and duplicate scenarios, and, for
  `refund_request` and `cancellation`, the pre-live routing rules that add
  Policy.
- **Tier 3, technical.** Supported by the Technical agent's role in the product
  spec, the Technical-flag rules in `resolveOutcome()`, the expected agents of
  the technical scenarios, and the Technical prompt's `auto_resolvable`
  example for `password_reset`.
- **Tier 4, `failed_payment` below technical: limited, single-source
  evidence.** The only pre-live source that places Billing's payment-status
  handling after Technical's is the rule order (and its docstring) in
  `resolveOutcome()`. The scoring notes and the product spec do **not**
  establish any Billing-versus-Technical precedence. The placement may simply
  reflect that Billing's flag yields only a monitoring reply, and no curated
  scenario exercises it. Treat it as a specification interpretation that could
  be revisited.

The tier order is therefore a specification interpretation of this evidence,
not a behavior the classifier currently enforces.

Apply in order:

1. **Specificity.** Identify each distinct issue in the ticket and the most
   specific intent that describes it. `billing_question`, `feature_question`
   and `general_inquiry` are *fallback* intents: one is primary only when no
   issue in the ticket has a more specific intent. (Designating them as
   fallbacks is a specification decision. For `billing_question` in
   particular the pre-live evidence is conflicted; see the definitions.)
2. **Precedence.** Among the specific intents, choose the highest tier:
   1. `account_security`
   2. Outcomes decided by a Policy decision: `duplicate_charge`,
      `refund_request`, `cancellation`
   3. Technical outcomes: `technical_issue`, `password_reset`
   4. Billing status: `failed_payment`

   Within tier 2, the more specific intent wins (a refund request for a
   duplicate charge is `duplicate_charge`).
3. **Ties.** If two issues share the highest tier and neither is more
   specific, choose the issue the customer states first: the subject line if
   it names them, otherwise the message body. This is a deterministic
   convention, not derived from any artifact; it exists only so the rule
   always yields exactly one intent. No new intent is created for a tie.
4. **Everything else** is a secondary issue and is expressed through
   `domains`, not by changing `intent`.

This rule states which intent is primary under the specification. It does not
state that the classifier currently follows it: the classifier receives only
the intent list, not this rule, and whether it should be told is a separate
prompt decision that has not been made.

### Audit of the curated scenarios against the rule

Applied after the rule was written, as a consistency check on the existing
expectations. No expectation was changed.

| Scenario | Expected intent | Issues in the ticket | Rule selects | Verdict |
|---|---|---|---|---|
| `password-reset` | `password_reset` | Regain access after a forgotten password | `password_reset` | consistent |
| `duplicate-billing` | `duplicate_charge` | A duplicate charge, plus the request to refund it (the remedy) | `duplicate_charge` (specificity over `refund_request`) | consistent |
| `prohibited-refund` | `refund_request` | A refund request | `refund_request` | consistent |
| `legitimate-refund` | `refund_request` | A refund, plus a return to a lower plan (no intent of its own) | `refund_request` (the plan change is secondary) | consistent |
| `failed-payment` | `failed_payment` | A failed charge and its retry | `failed_payment` | consistent |
| `known-technical-issue` | `technical_issue` | Automations not firing (the upgrade is context) | `technical_issue` | consistent |
| `technical-escalation` | `technical_issue` | The same issue, workaround already tried | `technical_issue` | consistent |
| `suspicious-activity` | `account_security` | An unrecognized login and an unrecognized API key | `account_security` | consistent |
| `ambiguous-request` | `general_inquiry` | No identifiable issue | `general_inquiry` | consistent |
| `multi-domain` | `billing_question` | A duplicate proration charge (`duplicate_charge`, tier 2) and broken automations (`technical_issue`, tier 3) | `duplicate_charge` (tier 2 outranks tier 3; `billing_question` is not eligible **because clause 1 designates it a fallback**, a specification decision) | **inconsistent under this specification** |

Notes on the audit:

- **`multi-domain` is inconsistent with the rule, and its expectation is
  deliberately unchanged.** Two parts of that verdict rest on different
  footing. What the artifacts independently support is the ordering of the two
  issues: a Policy-decided outcome (tier 2) above a technical one (tier 3),
  which selects `duplicate_charge` over `technical_issue`. That
  `billing_question` is *not eligible* as the primary intent depends on
  clause 1, which designates it a fallback: a specification decision, not a
  pre-live fact. The pre-live evidence for `billing_question` conflicts
  (informational templates versus this scenario's own expectation), and the
  scenario rationale does not explain the label. Whether to change the
  expectation, or to specify `billing_question` differently, is a separate
  decision, to be made and documented on its own.
- No curated scenario exercises the tie-break (clause 3), `cancellation` or
  `feature_question`.
- The rule concerns only `intent`. Which agents run is decided by
  `selectAgents()` from `domains`, the intent overrides and sentiment, and is
  graded separately as routing accuracy.

## Evaluation dimensions

| Dimension | Question | Computed from |
|---|---|---|
| Classification accuracy | Did the orchestrator detect the right intent? | `OrchestrationRun.classification.intent` vs. `expectedOutcome.expectedIntent` |
| Routing accuracy | Did it invoke the right specialist agents — no more, no fewer? | `AgentInvocation` rows' agent keys vs. `expectedOutcome.expectedAgents` |
| Policy accuracy | Was the expected policy grounded somewhere in the outcome — either as the Policy Agent's own decision, or cited by another agent (e.g. Risk) for scenarios where Policy isn't expected to run at all? | Policy Agent's `policyDecision.applicablePolicy.slug`, falling back to any agent's `policyReferences`, vs. `expectedOutcome.expectedPolicySlug` |
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
- **`npm run eval:dry-run` goes further: it runs the full evaluation
  suite — all 10 scenarios, through the real orchestrator and scorer —
  against a deterministic fixture provider.** This is a harness-validation
  tool, not a real evaluation; see "Dry-run harness validation," below,
  for what it proved and why its results are tagged and rendered as
  `isSimulated` everywhere, never indistinguishable from a live result.

## Dry-run harness validation (not a real evaluation)

`npm run eval:dry-run` (`scripts/runEvaluationDryRun.ts` +
`scripts/evaluationDryRunFixtures.ts`) registers a comprehensive,
hand-authored fixture provider covering all 10 curated scenarios and runs
`runEvaluationSuite()` against it — the *exact same function* a real
evaluation uses, with the model provider swapped for a deterministic
fixture. Its purpose is narrow and specific: prove the orchestrator →
persistence → scorer → UI wiring is correct end to end, before ever
spending a real model call on it. It is **not** a measurement of AI
quality, and every result it produces is tagged `isSimulated: true` (see
DECISIONS.md, "Honestly recording which provider actually served a
call") — rendered with a purple "simulated" badge/banner throughout the
app, and excluded entirely from AI Operations' live metrics.

9 of the 10 fixture scenarios are answered "correctly" (matching their
`expectedOutcome` exactly); the 10th (`known-technical-issue`) is
answered **deliberately wrong on purpose** — a misclassification that
leads to an incorrect resolution — specifically to prove the scorer
detects and reports a real failure through the actual pipeline, not just
inside an isolated unit test.

**Actual results from the last run:**

| Scenario | Result | Score |
|---|---|---|
| password-reset | ✓ pass | 1.00 |
| duplicate-billing | ✓ pass | 1.00 |
| prohibited-refund | ✓ pass | 1.00 |
| legitimate-refund | ✓ pass | 1.00 |
| failed-payment | ✓ pass | 1.00 |
| known-technical-issue | ✗ **fail (deliberate)** | 0.43 |
| technical-escalation | ✓ pass | 1.00 |
| suspicious-activity | ✓ pass | 1.00 |
| ambiguous-request | ✓ pass | 1.00 |
| multi-domain | ✓ pass | 1.00 |

9 passed, 1 failed (as designed), 0 failed to run. Notably,
`suspicious-activity` scored a perfect 1.00 — this specifically exercises
the policy-grounding-via-Risk-agent scorer fallback (see DECISIONS.md,
"Evaluation scorer must accept policy grounding cited by any agent"),
confirming that fix works through the real, live-wired pipeline and not
only in its own unit test. `known-technical-issue`'s failure notes
correctly identify all three mismatches (intent, routing, resolution),
exactly as the deliberately-wrong fixture was designed to produce.

## Pre-flight: expected call count and cost for a real run (estimate, not measured)

Before the first real run, a pre-flight audit (AUDIT.md, Audit #5) computed
what to expect from the actual pipeline code and `modelRouting.ts`'s
pricing table, without making any live call:

- **Expected calls**: 35 total for all 10 scenarios (1 classifier call per
  scenario + 1 call per agent in that scenario's `expectedAgents`) —
  assuming the real classifier's output matches each scenario's designed
  routing. A real model's classification can legitimately diverge from
  that (the same `selectAgents()` override rules that route fixture
  scenarios also apply to real classifier output), so the actual count
  could differ. The structural ceiling is 6 calls/ticket (5 agents +
  classifier, since agent selection is a set) × 2 attempts (the retry
  built into `callWithStructuredRetry`, `src/lib/ai/parse.ts`) × 10
  tickets = 120 — a deliberately conservative worst case, not a realistic
  expectation.
- **Estimated cost**: roughly **$0.10–$0.15** for the nominal 35-call run
  (~$0.02 across the Haiku-routed classifier/billing/policy calls, ~$0.09
  across the Sonnet-routed technical/risk/response calls), with a generous
  allowance up to **~$0.30** for real-world prompt/response variance or
  retries. This is derived from reading actual prompt-building code and
  `modelRouting.ts`'s per-token pricing, not from a tokenizer run against
  real output — treat it as a rough estimate to sanity-check an actual
  run against, not a measured figure. Once a real run happens, its
  persisted `AgentInvocation.estimatedCostUsd` values are the real number.

## Running the suite for real

```bash
npm run db:eval:setup            # once: create + seed the separate eval.db (re-running resets it)
npm run eval -- duplicate-billing   # exactly one scenario (recommended first live call)
npm run eval                     # all 10 scenarios
npm run dev:eval                 # view the results (dev server on eval.db)
```

Live results are written to `eval.db` (override with `EVAL_DATABASE_URL`),
not `dev.db`, so `npm run test:e2e`'s reseed can't destroy them — see
DECISIONS.md, "Live evaluation runs against a separate database".
An unknown scenario name fails immediately, listing the valid ones.

Requires `ANTHROPIC_API_KEY` in `.env` — the script checks for it and
refuses to run otherwise, rather than silently falling back to anything
else. When run, for each selected `EvaluationCase` it:

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
