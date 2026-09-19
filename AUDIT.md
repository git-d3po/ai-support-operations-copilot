# Self-Audit Log

## Process

Each audit cycle, review the current state from three perspectives:

- **Senior Product Manager** — does this serve the actual user (a support
  operator) and the product's stated goals? Is anything a fake dashboard,
  an arbitrary metric, or decorative AI terminology?
- **Principal AI Engineer** — is the architecture sound, are outputs
  correctly validated, is the orchestration logic actually doing what it
  claims, are tests meaningful?
- **Design Lead** — is the information architecture clear, is the UI
  honest about its state (loading/empty/error), is it appropriately dense
  for an operational tool without being generic or over-decorated?

Classify each finding:

- **P0** — broken or fundamentally wrong. Fix immediately.
- **P1** — materially weak. Fix autonomously if it doesn't require a
  product-direction decision; otherwise log it and flag for input.
- **P2** — polish / improvement. Log in TODO.md; don't block on it.

After fixes: re-run `npm run typecheck && npm run lint && npm run test &&
npm run build` (+ `npm run test:e2e` if UI changed), then re-audit. Stop
escalating once remaining findings are P2 or require genuine product
judgment (see CLAUDE.md, "When to ask vs. decide autonomously").

---

## Audit #1 — Foundation phase (2026-09-18)

Scope: project scaffolding, data model, synthetic data, orchestrator
skeleton, schemas, minimal UI shell, and test infrastructure established in
this phase. Not in scope: real AI reasoning, visual design, or any Phase 2
feature — those are intentionally not built yet (see TODO.md), so their
absence is not counted as a finding below.

### Senior Product Manager review

| # | Finding | Severity | Status |
|---|---|---|---|
| PM-1 | There's no way to trigger "Run AI analysis" from the UI yet — the product's core value proposition isn't demonstrable end-to-end. | P1 | **Deferred by design.** This requires real agent/classification logic, which is explicitly Phase 2 scope (see TODO.md). Not a foundation-phase defect — flagged here so it's the visibly top priority for the next phase. |
| PM-2 | Inbox has no filtering, search, or sort controls beyond default recency ordering. | P2 | Logged in TODO.md. Not needed at ~89 seeded tickets; will matter once the inbox is a real workflow tool. |
| PM-3 | `Ticket` query in the Inbox page hardcodes `take: 100` with no pagination. | P2 | Logged in TODO.md; fine at current data volume. |

### Principal AI Engineer review

| # | Finding | Severity | Status |
|---|---|---|---|
| ENG-1 | `-invoices[0]?.amountCents ?? 0` in `prisma/seed.ts` had an operator-precedence bug: unary minus on `undefined` coerces to `NaN` (a `number`), so the `?? 0` fallback was dead code — an account with a chargeback but no invoices would have seeded a `NaN` transaction amount. Caught by `tsc` (`TS2869: unreachable`), not by a test. | P1 | **Fixed** — corrected to `-(invoices[0]?.amountCents ?? 0)`. |
| ENG-2 | The SQLite `DATABASE_URL` default (`"file:./dev.db"`) was duplicated in `src/lib/db.ts` and `prisma/seed.ts`, a drift risk. | P1 | **Fixed** — centralized into `src/lib/databaseUrl.ts`, imported by both. |
| ENG-3 | `selectAgents.ts` re-declared the agent order (`["billing","policy","technical","risk","response"]`) instead of importing the canonical `AGENT_KEYS` from `src/lib/ai/schemas.ts`, a second drift risk. | P1 | **Fixed** — now imports and filters `AGENT_KEYS` directly. |
| ENG-4 | No test yet exercises `runOrchestration()` against real persistence (writing an `OrchestrationRun` + `AgentInvocation` rows) — only pure in-memory unit tests exist. | P2 | Logged in TODO.md. Not meaningful until Phase 2 gives the pipeline real output worth persisting and asserting on. |
| ENG-5 | `vitest.config.ts` prints a benign Vite warning about ESM syntax in a CJS-loaded config file. | P2 | Logged in TODO.md; would require a `"type": "module"` project-wide decision out of scope for this phase. |

### Design Lead review

| # | Finding | Severity | Status |
|---|---|---|---|
| DES-1 | The Inbox table had no horizontal-scroll handling and visibly clipped columns on a narrow (≈600px) viewport during a manual browser check. | P2 | **Fixed** — wrapped in `overflow-x-auto` with a `min-w` on the table. |
| DES-2 | Visual design is intentionally unstyled beyond basic Tailwind utility classes — no component library, no real visual hierarchy or brand identity yet. | P2 | Expected and logged — see DECISIONS.md ("Deferring a UI component library"). Not a defect for this phase. |
| DES-3 | No loading, empty-result, or error states designed for any page (e.g. an Inbox with zero tickets, or a failed query). | P2 | Logged in TODO.md for the UI-implementation phase. |
| DES-4 | Layout is fixed-width desktop with no responsive/mobile handling. | Not a finding | Matches PRODUCT_SPEC.md's explicit non-goal ("Mobile support ... this is a dense, desktop-first operational tool"). Noted here only so it isn't rediscovered and mis-flagged later. |

### Outcome

3 P1s found and fixed in this cycle (ENG-1, ENG-2, ENG-3), plus one P2
visual bug fixed opportunistically (DES-1) since it was a one-line
Tailwind change discovered during the same verification pass. Re-ran
`npm run typecheck && npm run lint && npm run test && npm run build && npm
run test:e2e` after fixes — all green (40/40 unit tests, 7/7 e2e tests).
Remaining findings are P2 (polish, explicitly deferred UI work) or
explicitly out of scope for this phase (PM-1, tracked as the top Phase 2
priority). No P0s found.

---

## Audit #2 — Phase 2: real orchestration (2026-09-18)

Scope: real classification, real specialist agents, real deterministic
resolution, persistence, the "Run AI analysis" UI/Server Action, the
evaluation runner, and the associated test suites. Not in scope: actually
executing a real evaluation run (no `ANTHROPIC_API_KEY` is configured in
this environment, and per standing instruction no automated process may
use a real credential without being asked first) or UI visual polish.

### Senior Product Manager review

| # | Finding | Severity | Status |
|---|---|---|---|
| PM-1 (carried over) | "Run AI analysis" now exists end to end. | — | **Resolved.** The top priority from Audit #1 is done: real classification → dynamic routing → real agents → real resolution → real persisted response, verified live in the browser and via `runAnalysis.spec.ts`. |
| PM-4 | The Inbox's "AI" column only ever showed the curated-scenario badge or a static "not run" string — it never reflected whether a ticket had actually been analyzed, or what the outcome was, even after real analysis started producing results. | P1 | **Fixed** — Inbox now queries each ticket's latest `OrchestrationRun` and shows "not analyzed," "analysis failed," "escalated," or the actual resolution action, alongside the eval badge where applicable. |
| PM-5 | Evaluation has real infrastructure but no executed results — the Evaluations page still shows "not run" for all 10 scenarios. | Not a finding | Correct and honest given no API key is configured; see EVALUATION.md and DECISIONS.md ("The evaluation runner refuses to run without a real, user-provided API key"). Flagged for the user's decision in the phase report, not treated as a defect. |

### Principal AI Engineer review

| # | Finding | Severity | Status |
|---|---|---|---|
| ENG-6 | An `instrumentation.ts`-based approach to injecting the e2e fixture provider silently failed: `register()` ran and logged success, but the Server Action still hit the real `AnthropicProvider` and failed on a missing API key. Root cause: Next.js's per-route bundling gives the instrumentation hook and a Server Action separate module instances of `registry.ts`, so a `registerProvider()` call from one never reached the other. | P1 | **Fixed** — moved the `USE_MOCK_MODEL_PROVIDER` check inside `registry.ts`'s `createProvider()` itself, which is reliably the same code path a request actually resolves a provider through regardless of bundling. Diagnosed by adding temporary logging and manually driving the built app in the browser pane rather than assuming the config was wrong. `instrumentation.ts` was deleted. See DECISIONS.md for the full writeup. |
| ENG-7 | The initial `runAnalysis.spec.ts` and `smoke.spec.ts` both targeted the same ticket ("Charged twice this billing cycle"), so running analysis in one file's test made the other file's "not yet analyzed" assertion order-dependent and flaky. | P1 | **Fixed** — `smoke.spec.ts` now uses a different ticket ("Refund request — upgraded by mistake") that no other e2e test touches; `playwright.config.ts`'s `webServer.command` also reseeds the database before every fresh server boot so "not yet analyzed" is a safe assumption regardless of prior runs. |
| ENG-8 | Several `getByText()` e2e locators matched more than one element once real, richer content existed (e.g. "Resolution" matching both a heading and body text containing "resolution decision"). | P2 | **Fixed** — switched to `getByRole("heading", ...)` or `.first()`/`{exact: true}` where genuinely ambiguous. |

### Design Lead review

| # | Finding | Severity | Status |
|---|---|---|---|
| DES-5 | On analysis failure, the error appears twice: once as the `RunAnalysisButton`'s own inline message, and again in the persisted "Analysis failed" panel once the page revalidates — both correct, but redundant once both are visible. | P2 | Logged in TODO.md. Not fixed now: the two messages come from genuinely different moments (immediate client feedback vs. the persisted, reload-safe truth) and de-duplicating them cleanly is a small UI decision better made during the UI-polish phase, not a correctness issue. |
| DES-2 (carried over) | Visual design remains intentionally unstyled. | — | Still expected — see DECISIONS.md. The new Ticket Detail/Operations sections follow the same plain-Tailwind convention as everything else, so the page stays internally consistent even though it isn't polished yet. |

### Outcome

2 P1s found and fixed in Principal AI Engineer review (ENG-6, ENG-7), one
P1 found and fixed in Product review (PM-4), plus one P2 test-locator
cleanup (ENG-8). Re-ran the full suite after fixes — `typecheck`, `lint`,
113 unit tests, 6 integration tests, `build`, and 9/9 e2e tests all green.
No P0s found. Remaining items are P2 or, in PM-5's case, correctly
deferred pending a user-provided API key and explicit go-ahead — not a
defect.

---

## Audit #3 — Deep implementation audit: agent behavior and evidence flow (2026-09-18)

Requested explicitly as a code-reading audit, not a documentation review:
verify (by reading the actual agent/orchestrator/scorer code, not the
tests or docs) that each of 10 specific properties genuinely holds. No
live model call was made; no API key was used or requested. Scope:
`src/lib/orchestrator/**`, `src/lib/ai/schemas.ts`, `src/lib/evaluation/**`,
`prisma/data/scenarios.ts`.

### What's genuinely strong (verified by reading, not assuming)

- **Distinct agent responsibilities (item 1).** Each of the 5 agents'
  system prompts differs in framing, permitted output shape, and
  decision type — Billing surfaces facts only ("you do not decide policy
  questions"), Policy decides permission grounded only in retrieved text,
  Technical diagnoses against docs only, Risk is an escalation gate that
  reads every other agent's findings, Response communicates a decision it
  is explicitly forbidden from inventing. Confirmed these are not a
  templated prompt with swapped nouns.
- **Context minimization (item 2).** Verified per agent: Technical never
  sees billing or policy data (only product docs + conversation); Billing
  never sees policy documents; Risk sees other agents' *summaries* via
  `priorFindings`, not their raw source data; Response sees the resolution
  and finding summaries, never raw invoices/policies. Each agent's
  `buildRequest()` was read directly to confirm this, not inferred from
  comments.
- **Real data flow (item 5).** `context.ts`'s `loadTicketContext()` is a
  real Prisma query against `Customer`/`Account`/`Subscription`/
  `Invoice`/`Transaction`/`Policy`/`ProductDoc` — confirmed no
  agent-visible field is synthesized or hardcoded outside the seed data.
- **Response agent conditioning (item 6).** `responseAgent.ts`'s
  `buildRequest()` throws if `context.resolution` is absent, and its
  prompt includes the literal resolution `action`/`summary`.
  `orchestrator.test.ts` has a dedicated test that fails if the Response
  agent's prompt doesn't already contain the resolution — this is
  structurally enforced, not just documented.
- **Classifier → routing (item 7).** `selectAgents()` reads
  `classification.domains`/`.intent`/`.sentiment` directly; `orchestrator
  .ts` passes the real `classifyTicket()` output into it. No hardcoded
  routing path exists.
- **Malformed output can't silently succeed (item 8).** Traced the full
  path: `parseStructuredOutput` → `callWithStructuredRetry` (2 attempts) →
  `runStructuredStep` (`data: null` on final failure, real metrics
  accumulated across attempts) → every agent's `run()` uses `data ??
  degraded...Finding(...)`. No code path turns a failed parse into a
  finding that looks successful.
- **Resolution genuinely consumes findings (items 3, 9).** `resolve.ts`
  reads `policyDecision.decision`, `escalationRecommended`/`targetTeam`/
  `severity`, and specific `flags` — not placeholders. Traced all 12 rules
  against all 10 curated scenarios' expected outcomes by hand; each
  scenario's expected resolution is reachable through the actual rule
  order given a classifier output matching its `expectedOutcome`.
- **Persisted record fidelity (item 10, UI half).** `TicketDetailPage`
  renders exactly the persisted `finding`/`resolution`/`escalation`/
  `response` JSON with no re-derivation or hardcoding.

### What was superficial or misleading (the real findings)

| # | Finding | Severity | Status |
|---|---|---|---|
| ENG-9 | **Policy citations were prompted for but not enforced (item 4).** `PolicyReferenceSchema` validates shape only (`{slug: string, title: string}`) — nothing checked that a cited slug was ever actually retrieved and shown to the model for that call. A hallucinated or stale slug would have passed validation, driven `resolveOutcome()`'s `refund_customer`/`deny_request` branch, rendered in the UI as if verified, and scored as "correct" in evaluation if it happened to match. | **P1** | **Fixed** — `evidence.ts` adds `filterGroundedPolicyReferences()`/`isPolicyGrounded()`; Policy Agent nulls an ungrounded decision entirely (flag `ungrounded_policy_citation`); Risk Agent strips ungrounded citations; Billing/Technical citations are always stripped (they're never shown policies). See DECISIONS.md. |
| ENG-10 | **The evaluation scorer's `policyCorrect` dimension only read the Policy Agent's own decision — never any other agent's citation.** The `suspicious-activity` scenario expects policy grounding via the *Risk* agent (Policy Agent isn't even expected to run for it), so `policyCorrect` would score `false` for that scenario even on a perfectly correct run, and — because it carries weight 1.5 — could push a correct run's `overallScore` below the 0.85 pass threshold, misreporting correct behavior as failed. Found by manually cross-checking every scenario's `expectedAgents` against what `score.ts` actually reads, not by running the suite. | **P1** | **Fixed** — `score.ts` now falls back to checking whether *any* agent's (grounding-enforced) `policyReferences` cites the expected slug when the Policy Agent's own decision doesn't match. See DECISIONS.md. |
| ENG-11 | `AgentInvocation.startedAt`/`finishedAt` are back-computed from each invocation's own `latencyMs` at persist time, all relative to the *same* shared `now` — every invocation in a run gets an identical `finishedAt`, which misrepresents agents that actually ran sequentially as if they finished simultaneously. `latencyMs` (duration) itself is accurate; only the derived timestamps are approximate. | P2 | Not fixed — no decision or evaluation logic depends on these specific timestamps, only on `latencyMs`, which is correct. Logged in TODO.md; the real fix (threading actual wall-clock timestamps through `AgentResult`) is a small, well-contained change if AI Operations ever wants to show a real timeline rather than just durations. |
| ENG-12 | `KNOWN_AGENT_FLAGS.NO_BILLING_ISSUE_FOUND` is documented as an available Billing Agent flag but has no dedicated branch in `resolveOutcome()` — it falls through to the generic confidence-based default (rule 12), which happens to produce reasonable behavior, but the flag is otherwise inert. | P2 | Not fixed — behavior is already correct via the default rule; this is a minor consistency note (every flag "clearly" consumed vs. safely defaulted), not a bug. Logged in TODO.md. |

### Scenario/scorer cross-check (the other half of this audit)

Went through all 10 curated scenarios in `prisma/data/scenarios.ts`
against `resolve.ts`'s rule order and `score.ts`'s dimensions by hand:
9 of 10 scenarios' scoring logic was already correct as designed; the
10th (`suspicious-activity`) surfaced ENG-10 above, now fixed. No other
scenario has an `expectedPolicySlug` set without `"policy"` in
`expectedAgents`, so this was the only instance of that particular gap.

### Outcome

2 P1s found and fixed (ENG-9, ENG-10) — both required code changes across
multiple files (`evidence.ts`, `policyAgent.ts`, `riskAgent.ts`,
`billingAgent.ts`, `technicalAgent.ts`, `score.ts`) plus 9 new/updated unit
tests locking the new behavior in. Re-ran the full suite after fixes:
`typecheck`, `lint`, **122** unit tests (up from 113), 6 integration
tests, `build`, and 9/9 e2e tests all green — including the real,
seeded-database e2e run, confirming the grounding fix doesn't break a
genuinely-grounded citation. 2 P2 observations logged (ENG-11, ENG-12),
not fixed, both cosmetic/consistency issues with no effect on any
decision or score. No API key was used or requested at any point in this
audit.

---

## Audit #4 — Evaluation readiness: end-to-end audit + fixture-provider dry run (2026-09-18)

Requested explicitly: audit the evaluation system end-to-end using the
deterministic MockProvider/fixture provider (no API key, no live
evaluation), then actually execute the full 10-scenario suite against a
fixture provider. Scope: `src/lib/evaluation/**`,
`src/lib/orchestrator/persist.ts`/`modelClient.ts`, the Evaluations/AI
Operations UI, and a new dry-run tool built specifically for this audit.

### What's genuinely strong (re-verified by reading + by running)

- All 10 curated scenarios have an unambiguous `expectedOutcome` — quick
  re-confirmation of Audit #3's finding, unchanged.
- `runEvaluationSuite()` calls `analyzeTicket()` — the exact same function
  "Run AI analysis" uses — never an isolated function. Confirmed by
  tracing the call chain and by the dry run itself exercising real
  classification, real dynamic routing, real agents, real deterministic
  resolution, and real persistence for every scenario.
- The scorer cannot award a false pass, and cannot award a false fail
  because grounding comes from the wrong agent — both properties are now
  verified **live**, not just in unit tests: the dry run's one
  deliberately-wrong scenario correctly failed (0.43, all three
  mismatched dimensions correctly identified in `notes`), and
  `suspicious-activity` — the scenario that previously exposed the
  Policy-agent-only scoring bug (Audit #3, ENG-10) — correctly passed
  (1.00), proving that fix holds through the real pipeline.
- The Evaluations UI now clearly separates expected vs. actual outcome
  per dimension, per-dimension check/cross marks, a pass/fail badge with
  score, and visible failure notes — not just a hover tooltip as before.

### What was superficial or misleading (the real finding)

| # | Finding | Severity | Status |
|---|---|---|---|
| ENG-13 | **Persisted records never recorded which provider actually served a call — only which model it was routed to.** `AgentInvocation.model` (and `AgentRunMetrics`) always showed the *configured* target (e.g. `"claude-sonnet-5"`), even when a mock/fixture provider actually answered. A run entirely served by a fixture would have persisted and rendered **identically** to a real model run — meaning running this task's own fixture-based dry run, before this fix, would have silently produced database rows and UI screens indistinguishable from genuine live evaluation results. Found before writing a single fixture response, by reading `modelClient.ts`/`mock.ts` against property 9 of the request. | **P1** | **Fixed** — `ModelCallResult`/`AgentRunMetrics` now carry the actual `provider.key`; `AgentInvocation.provider` (schema migration) and `OrchestrationRun.isSimulated`/`EvaluationResult.isSimulated` (derived at persist time) make this queryable and renderable. Ticket Detail, Evaluations, and AI Operations all read this flag directly — AI Operations excludes simulated runs from its aggregates entirely rather than let them inflate "real" numbers. See DECISIONS.md. |

### The dry run itself

Built `scripts/runEvaluationDryRun.ts` + `scripts/evaluationDryRunFixtures.ts`
— a comprehensive fixture covering all 10 scenarios (9 correct, 1
deliberately wrong — see EVALUATION.md for the full rationale and
results table) — and ran it via `npm run eval:dry-run`. Result: **9/10
passed (1.00 each), 1/10 failed exactly as designed (0.43), 0/10 failed
to run.** Verified in the browser: the Ticket Detail page shows a
"SIMULATED RUN" banner and per-invocation "simulated (mock)" badges; the
Evaluations page shows a purple "simulated" badge distinct from pass/fail
and states plainly that live evaluation has not run yet; AI Operations
shows 0 orchestration runs and a note that 10 simulated runs exist and
are excluded. All confirmed by reading the actual persisted database
state (`provider` = `"mock"` on every invocation, `isSimulated` = `true`
on every run and result, zero non-simulated rows) as well as visually.

### Outcome

1 P1 found and fixed (ENG-13) before it could produce a single misleading
row — the dry run that followed the fix produced honestly-labeled results
throughout. Added 3 new integration tests proving provider provenance
round-trips correctly (mock → simulated=true; real → simulated=false;
one-mocked-invocation-among-many → simulated=true) and updated
`runAnalysis.spec.ts` to assert the SIMULATED banner appears and that AI
Operations correctly excludes that run. Full suite re-run after fixes:
`typecheck`, `lint`, **122** unit tests, **9** integration tests (up from
6), `build`, and **9/9** e2e tests all green. No P0s found; no P2s logged
this cycle beyond what Audit #3 already tracks. No API key was used or
requested at any point.

**Readiness assessment:** the system is ready for a first controlled
live-model evaluation. Every property requested for audit holds by
inspection and by this dry run; the only remaining gap (a real
`ANTHROPIC_API_KEY`) is a credential the user must explicitly provide,
per standing project policy — not an engineering readiness gap.

---

## Audit #5 — Pre-flight audit for the first real credential (2026-09-18)

Requested explicitly, before the user provides any real
`ANTHROPIC_API_KEY`: re-verify (by reading the code directly, not relying
on Audit #4's conclusions) that credential handling, provider-selection
gating, and live/simulated labeling are all still correct, and compute
what a real run will actually cost and call. No API key was requested,
read, or used; the evaluation was not run. Scope:
`src/lib/ai/providers/**`, `src/lib/orchestrator/modelRouting.ts`,
`scripts/runEvaluation.ts`, `next.config.ts`, `.gitignore`/`.env.example`,
plus the Anthropic SDK's own header/error-handling internals.

### What was re-verified (all held up; no regressions since Audit #4)

- `ANTHROPIC_API_KEY` is read in exactly one place
  (`src/lib/ai/providers/anthropic.ts`), lazily, never logged or returned.
  Traced the SDK's own internals to confirm a thrown `APIError` captures
  only *response* headers, never the outbound `X-Api-Key` request header —
  there's no path for a logged/thrown error to leak the key.
- Mock-provider selection is gated by exactly one condition
  (`USE_MOCK_MODEL_PROVIDER === "true"`) checked in exactly one place
  (`registry.ts`'s `createProvider()`), and that variable is set in
  exactly one file (`playwright.config.ts`, e2e-only) — confirmed by a
  repo-wide grep, not assumed from memory. `scripts/runEvaluation.ts`
  never sets it and never calls `registerProvider()`, so a real `npm run
  eval` cannot accidentally run against a fixture.
- `isSimulated` is derived from `ModelProvider.key` (a hardcoded literal
  per provider class), not from any config a caller could override — a
  live run and a simulated run cannot be mislabeled as each other.
- No `NEXT_PUBLIC_`-prefixed variable exists anywhere in the codebase and
  `next.config.ts` has no `env:` block, so there's no path for the key to
  reach a client bundle. `.gitignore`'s `.env*` (with `!.env.example`)
  correctly ignores a real `.env`; `git ls-files` and `git status
  --ignored` confirm only the empty-valued `.env.example` is tracked.
- `runEvaluationSuite()` calls the identical `analyzeTicket()` the "Run AI
  analysis" Server Action calls (`src/app/tickets/[id]/actions.ts`) — one
  code path, re-confirmed directly rather than by inference.

### New analysis: expected call count and cost

Computed from `prisma/data/scenarios.ts`'s `expectedAgents` per scenario
and `modelRouting.ts`'s pricing table: **~35 model calls and an estimated
$0.10–$0.30** for a full 10-scenario real run. Full breakdown and caveats
now live in EVALUATION.md ("Pre-flight: expected call count and cost for
a real run") rather than duplicated here — labeled throughout as an
estimate derived from prompt structure, not a measured figure.

### Outcome

No P0/P1 issues found — everything requested for re-verification held up
under direct inspection, so no code changes were made this cycle. One
open, deliberately-not-decided question was surfaced for the user: whether
the first real run should be a single smoke-test scenario (cheaply
catches an auth, schema-compliance, or latency/cost surprise before
spending on all 10) or all 10 scenarios immediately (one step, at the
cost of risking a wasted full run on an unanticipated first-call issue) —
left to the user, not decided here.

**Readiness assessment: READY** for a controlled first live-model
evaluation, pending the user providing `ANTHROPIC_API_KEY` and explicitly
authorizing the run.
