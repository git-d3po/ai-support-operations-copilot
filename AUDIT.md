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
| DES-3 | No loading, empty-result, or error states designed for any page (e.g. an Inbox with zero tickets, or a failed query). | P2 | **Resolved** — error states in 782bc71; empty states on AI Operations (DES-23) and the ticket page; loading investigated in Audit #9 and found unnecessary for routes (they render in 45–103ms, and `loading.tsx` would turn the ticket 404 into a 200). |
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

## Audit #6 — Design Lead: visual design audit (2026-09-23)

Scope: read-only visual/design review of every screen and shared component
(`src/app/**/page.tsx`, `src/app/tickets/[id]/**`, `src/components/**`,
`src/app/globals.css`), triggered by the goal of making the app read as a
polished, top-tier product rather than a functional scaffold. Not in scope:
orchestrator, evaluation, or data-model changes. One low-risk fix (the `body`
font-family bug and an additive design-token layer in `globals.css`) was
already applied ahead of this audit, at the user's request, and is re-verified
below rather than re-described.

### Design Lead review

| # | Finding | Severity | Status |
|---|---|---|---|
| DES-6 | `body` was hardcoded to `Arial, Helvetica, sans-serif`, ignoring the Geist font already loaded via `next/font` in `layout.tsx` — the loaded font was never actually applied. | P0 | **Fixed** (this session, prior to this audit) — `globals.css` now uses `var(--font-sans)`, verified by screenshot: Geist now renders. |
| DES-7 | There is no shared `Card`/`Badge`/`Panel` component. The exact string `rounded border border-zinc-200 p-3\|p-4 dark:border-zinc-800` is hand-retyped in at least 9 places (`nav.tsx`, `operations/page.tsx` ×4, `evaluations/page.tsx`, `knowledge/page.tsx` ×2, `tickets/[id]/page.tsx` ×5), and the colored "badge" pattern (`rounded bg-X-100 px-1.5 py-0.5 text-xs font-medium text-X-800 dark:bg-X-950 dark:text-X-300`) is retyped per usage across `inbox/page.tsx`, `evaluations/page.tsx`, and `tickets/[id]/page.tsx`. This is the highest-leverage single fix: every other visual change (radius, elevation, badge color) currently requires a multi-file find-and-replace instead of a one-component edit, and copy-paste drift has already produced DES-8 below. | P1 | **Fixed** (Phase 1, this session) — `src/components/ui/{tone.ts,Card.tsx,Badge.tsx,SectionHeading.tsx,Stat.tsx}` extracted, and every page (`inbox`, `operations`, `evaluations`, `knowledge`, `settings`, `tickets/[id]`, `RunAnalysisButton`) migrated onto them. `nav.tsx` is deliberately not touched here — it's Phase 3 (active-route state), a different kind of change, not a card/badge. |
| DES-8 | Two near-identical hues carry unrelated meanings: `indigo-100/700` marks "this ticket belongs to a curated eval scenario" (`inbox/page.tsx:99`, `tickets/[id]/page.tsx:75`), while `purple-100/800` marks "this result is simulated, not real" (`mode-banner.tsx`, and simulated badges in `evaluations/page.tsx`, `tickets/[id]/page.tsx` ×3). These read as nearly the same color at a glance (confirmed in the Inbox screenshot taken this session) — a viewer could misread a curated-scenario tag as a simulated-data warning, which is the opposite of what DECISIONS.md ("Honestly recording which provider actually served a call") is trying to keep unambiguous. | P1 | **Fixed** (this session, at the user's explicit request — "I don't like purples or indigos") — the eval-scenario tag is now `Badge tone="neutral"` (zinc, matching the app's own neutral-metadata convention) and "simulated" is now `tone="info"` (blue, previously unused in the app). Repo-wide grep confirms zero `purple`/`indigo`/`violet`/`fuchsia` classes remain in `src/`. Verified visually: screenshot of the Inbox and a ticket detail page (duplicate-billing, with its existing simulated demo run) shows the two are now unambiguous. |
| DES-9 | Confirmed by repo-wide grep: no `shadow-*`, `transition`, `duration-*`, or `ease-*` class exists anywhere in `src/`. Every card, table row, and button is flat and instant — hover states are a bare background-color swap, there is no button press/active state, no focus-visible treatment beyond the browser default, and no loading indicator beyond `RunAnalysisButton` swapping its label to "Running…" during a multi-second server round trip. | P1 | **Fixed** — elevation in Audit #7 (`shadow-sm` on the ticket recommendation panel only); focus rings, button busy state, transitions and the Inbox row in Audit #8. |
| DES-10 | The one always-visible, always-identical element on every screen — the sidebar nav (`src/components/nav.tsx`) — has no active-route indicator (a user on `/inbox` sees an identical nav to a user on `/settings`) and no icons, only text labels. The component's own comment says this was deliberate for the foundation phase ("without investing in visual design yet"). | P1 | **Fixed** (2026-09-23, navigation pass) — grouped destinations, route-aware active state (tickets mark Inbox as their section), Halcyon identity, visible focus ring; no icons, by decision. See DECISIONS.md ("Application navigation"). |
| DES-11 | `public/` still holds the five default Next.js starter SVGs (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`); confirmed by grep that none are referenced anywhere in `src/`. Scaffolding leftover, not a deliberate choice — undermines "credible product" on inspection (e.g. a recruiter opening dev tools or the repo). | P2 | **Fixed** (this session) — trivial and unreferenced, deleted while already doing a cleanup pass; no reason to defer it. |
| DES-12 | Inbox's Status and Priority columns are plain, uncolored text — "Urgent" reads identically to "Low" — despite the color system already existing and being used one column over (the AI-result badges). | P2 | **Fixed** (this session) — a natural byproduct of migrating Inbox onto `Badge`: `urgent`/`escalated` are `tone="danger"`, `high` is `tone="warning"`, `resolved`/`closed` are `tone="success"`; `medium`/`low`/other statuses stay plain text on purpose, so the column doesn't become a wall of color. |
| DES-13 | Dark mode is `prefers-color-scheme`-only (no in-app toggle) and is produced by swapping each `zinc-N` for `zinc-(1000-N)` per element rather than a deliberately tuned dark palette; background is pure near-black (`#0a0a0a`), harsher than the lifted dark grays typical of polished dark UIs (which read better once elevation/shadow is introduced). | P2 | **Surface hierarchy fixed** (Audit #7) — dark mode now has a deliberate `background` → `surface` lift and AA-passing muted text; the near-black background was kept. In-app toggle still open (TODO.md). |
| DES-14 | Confirmed still accurate from Audit #1's Design Lead pass and TODO.md's "UI implementation phase": no loading skeletons anywhere; the only two empty states (`operations/page.tsx`'s "No agent invocations recorded yet" and `tickets/[id]/page.tsx`'s "No AI analysis has been run yet") are plain, unstyled text with no affordance. | P1 | **Resolved** — empty states in Audits #7/DES-23; loading skeletons deliberately not added (Audit #9: measured, and they would flash and break the 404 status). |

### What's already better than it looks

Re-verified while reading every page: the *information architecture* is
sound and the color semantics, before DES-8's collision, are actually
coherent and used consistently — zinc for neutral structure, emerald for
approved/passed, amber for caution/escalation, red for denied/failed/error,
purple for simulated. Every page's typography already follows one consistent
three-step scale (`text-lg font-semibold` h1 / `text-sm font-semibold` h2-h3
/ `text-xs uppercase tracking-wide text-zinc-500` eyebrow). This is a real
foundation — the gap to "top-tier" is depth (elevation, motion, componentized
consistency, an active nav state) on top of an already-sound structure, not a
rebuild of the structure itself.

### Outcome (as first written)

No P0 remained open (the font bug was fixed ahead of this audit). Five P1s
(DES-7, 8, 9, 10, 14) required enough surface area — a shared component
layer touching every page, plus a nav rework — that CLAUDE.md's "ask first"
bar applied loosely here: not because any one of them was a product-direction
call, but because their honest scope was a multi-file visual pass, not an
autonomous drive-by fix. Scoped into phases (Phase 1: primitives, Phase 2:
elevation/motion, Phase 3: nav, Phase 4: ticket detail, Phase 5: remaining
pages/polish) and presented for the user's go-ahead rather than fixed inline.

### Phase 1 executed (2026-09-23, same day, on explicit go-ahead)

The user approved Phase 1 and added one constraint: no purple, no indigo.
`src/components/ui/{tone.ts,Card.tsx,Badge.tsx,SectionHeading.tsx,Stat.tsx}`
were extracted and every page migrated onto them (DES-7, fixed). The purple
→ blue / indigo → neutral recolor (DES-8) was folded into the same pass
since it's the tone map the new `Badge`/`Card` consume, plus two trivial P2s
already sitting in the same files (DES-11, DES-12). `--accent` in
`globals.css` was updated to match (blue, was purple).

Verified: repo-wide grep confirms zero `purple`/`indigo`/`violet`/`fuchsia`
classes remain in `src/`. `typecheck`, `lint`, `test` (412 passed), and
`AI_MODE=demo npm run build` all pass. Visually verified via screenshot
against the real seeded database: Inbox (neutral eval tags, colored
status/priority) and a ticket detail page with an existing simulated run
(blue "SIMULATED RUN" banner, blue "simulated (demo)" badges, Customer/
Account cards render correctly through the new `Card`).

DES-9 (elevation/motion, Phase 2), DES-10 (nav rework, Phase 3), DES-13
(dark-mode tuning), and the loading-skeleton half of DES-14 remain open —
carried forward as the next phases, not attempted in this pass.

**Readiness assessment:** Phase 1 complete and verified. Still visually a
generic-but-now-consistent scaffold — the elevation/motion and nav phases are
what actually move it toward "top-tier product."

## Audit #7 — Design Lead: pre-Phase-2 audit and first design pass (2026-09-23)

Scope: a read-only audit of the Phase 1 result (rendered in light and dark mode against the
seeded database, with contrast measured rather than eyeballed), then one implementation pass
on its top findings: the neutral token and dark-mode foundation, shared presentation labels,
and the ticket detail page. Navigation, Operations empty states, error/not-found/loading
states and motion were explicitly out of scope. Rationale in DECISIONS.md ("Design
foundation: semantic tokens, presentation labels, and a decision-first ticket page").

### Design Lead review

| # | Finding | Severity | Status |
|---|---|---|---|
| DES-15 | Muted text failed WCAG AA: `text-zinc-500` had no dark variant (3.7-4.1:1 in dark mode) and several secondary labels used `text-zinc-400` on white (2.56:1). | P1 | **Fixed** — `--muted-foreground` token (zinc-500 light, zinc-400 dark) wired as `text-muted-foreground` and used for every muted role. Measured in the browser on the ticket page, Inbox and Operations, both schemes: 0 AA failures (the check flags a 2.56:1 control sample). |
| DES-16 | Two sources of truth for the page background: `globals.css`'s unlayered `body` rule silently overrode `layout.tsx`'s `bg-white dark:bg-zinc-900`. In dark mode the nav (`zinc-950`) was indistinguishable from the page (`#0a0a0a`). Unused `--radius-*` tokens in `:root` overrode Tailwind's `rounded-md`/`rounded-lg`. | P1 | **Fixed** — `globals.css` is the only source; dead classes and colliding tokens removed; nav and context panels on the `surface` token. |
| DES-17 | Ticket page showed the agent trace first and the decision last (below the fold on `suspicious-activity`). | P1 | **Fixed** — decision-first order: recommendation panel, draft reply, then "How this was decided" with the trace collapsed. E2E asserts the recommendation renders above the trace. |
| DES-18 | Canonical values rendered raw to the operator (`refund_customer`, `trust_and_safety`, `account_security`, `past_due`, `in_app`). | P1 | **Fixed** — `src/lib/labels.ts`, the single source of presentation labels, used by Inbox, ticket page and Operations. Canonical values unchanged. E2E asserts no taxonomy identifier appears on the ticket page, trace included. |
| DES-19 | The same sentence rendered twice (resolution summary and escalation reason). | P2 | **Fixed** — the escalation reason is shown only when its text differs from the summary. |
| DES-20 | The orchestration (classification decides routing) was invisible; every step looked like one more card. | P1 | **Fixed** — a compact Classified → Routed → Resolved → Drafted strip from persisted run data only. |
| DES-21 | Evidence and policy citations were the smallest, lowest-contrast text; citations were not links. | P2 | **Fixed** — evidence at body size; citations link to `/knowledge#policy-<slug>` when that policy exists. |
| DES-22 | Every simulated step showed `model · 0ms · ~$0.00000`, which reads as broken. | P2 | **Fixed** — shown as "not called (scripted replay)" in quiet monospace; per-step provenance badges kept. |
| DES-23 | In Demo Mode, AI Operations shows all zeros and an empty state ("run AI analysis on a ticket") that following it cannot fill, because demo runs are excluded from real metrics. | P1 | **Fixed** (2026-09-23, Operations Demo Mode pass) — one explanation in Demo Mode when no real-model runs exist, naming Demo Mode as the reason, with the excluded count and a link to the Inbox. Exclusion and metric values unchanged. See DECISIONS.md ("AI Operations in Demo Mode"). |
| DES-24 | No `not-found.tsx` or `error.tsx`: a bad ticket id or database error shows Next's default page. | P2 | **Fixed** (2026-09-23, resilience pass) — root `not-found.tsx`, `error.tsx` and `global-error.tsx` sharing the page header layout; recovery via `retry()`. Verified with unit and E2E tests and in the browser against real failures (empty scratch database, invalid `AI_MODE`), including keyboard recovery and contrast in both schemes. See DECISIONS.md ("Application not-found and error states"). |
| DES-25 | The Knowledge page lists policy titles only; a citation lands on an entry whose text is not viewable. | P2 | **Fixed** (2026-09-24, correctness and credibility pass) — Knowledge renders each policy's stored text; see Audit #10, DES-40. |

### Outcome

Eight findings fixed (DES-15 to DES-22), three carried forward, plus DES-9 (motion half) and DES-10 (nav) from
Audit #6. Provenance and Demo Mode semantics deliberately unchanged: SIMULATED notice,
per-step badges, site banner, and simulated runs excluded from Operations metrics. Elevation is
used on exactly one surface (the recommendation panel), confirmed by counting shadowed elements
in the browser. A Knowledge arrival highlight (`:target`) was built and removed: Next's
client-side navigation uses `pushState`, which does not update `:target`, so it only appeared on
a full page load. Recorded agent evidence that quotes billing codes (`api_overage`,
`insufficient_funds`) is recorded text and was left as-is.

Verified: typecheck, lint, 417 unit tests (5 new, for the label contract), `AI_MODE=demo`
build, and 14 E2E tests pass. E2E assertions that expected raw values were rewritten to the new
user-facing contract; routing, idempotency, provenance and curated-only checks are unchanged.

**Readiness assessment:** the ticket page now reads as an operations tool rather than a
demo trace. Remaining visual gaps are navigation, the Operations Demo Mode state, error and
loading states, and motion.

## Audit #8 — Design Lead: interaction, accessibility and motion (2026-09-23)

Scope: every interactive element in `src/` (nav links, Inbox rows, "Run analysis", the agent
trace disclosure, policy/Operations/Evaluations links, not-found and error recovery controls),
inventoried against keyboard operation, focus visibility, semantics, busy/disabled state,
accessible names and motion, then verified in the browser. No links/buttons were misused and
no `<div>` had a click handler; findings below. Rationale in DECISIONS.md ("Interaction
conventions").

### Design Lead review

| # | Finding | Severity | Status |
|---|---|---|---|
| DES-26 | "Run analysis" became natively `disabled` while running, which drops a focused button's focus to `<body>` (measured: focus lost ~20ms after Enter), so a keyboard or screen-reader user lost their place on every run. | P1 | **Fixed** — `aria-disabled` plus a handler guard while busy (focus stays, no second submission); native `disabled` only for the permanent "curated only" case. E2E asserts focus is kept and exactly one request is sent; a negative control with the old behavior fails that test. |
| DES-27 | Focus treatment was inconsistent: a 2px foreground ring on nav and recovery controls (two copies of the same class string), the browser default everywhere else ("Run analysis", Inbox links, the trace summary, policy and in-text links). | P2 | **Fixed** — one global `:focus-visible` rule in `globals.css`; per-component copies removed. |
| DES-28 | Inbox rows highlighted on hover but only the subject text was a link (part of DES-9). | P2 | **Fixed** — whole-row link through the subject link's stretched `::after` (one link per row, no nested controls), with the focus ring drawn around the row. |
| DES-29 | The run's start, end and failure were not announced to assistive technology, and the busy label ("Running…") did not say what was running. | P2 | **Fixed** — "Running demo analysis…" / "Running AI analysis…", a polite status region ("Demo analysis complete."), and the failure message in an alert. |
| DES-30 | The "curated scenarios only" reason was shown next to the disabled button but not associated with it. | P2 | **Fixed** — `aria-describedby`; E2E asserts the button's accessible description. |

### Outcome

Five findings fixed, plus the motion half of DES-9. Verified: typecheck, lint, 433 unit tests,
the `AI_MODE=demo` build and 19 E2E tests (2 new: a keyboard-only flow from an Inbox row
through "Run analysis", its busy state and the agent trace; and a whole-row click). In the
browser, light and dark: a visible ring at every stop, including around the Inbox row (16.9:1
against the page in dark mode); the trace opens and closes with Enter and Space; text contrast
unchanged (0 AA failures on Inbox and ticket detail, both schemes); with reduced motion, colour
transitions collapse and the spinner is hidden (checked with Playwright's `reducedMotion`
emulation). One regression was introduced and fixed within the pass: the new colour transitions
also animated `outline-color`, so the focus ring faded in from the button's white text colour;
it now appears at once in its final colour.

## Audit #9 — Design Lead: loading, pending and in-progress states (2026-09-24)

Scope: every asynchronous boundary a user can see. There is one user-initiated action (the
"Run analysis" Server Action) and five dynamic server-rendered pages (Inbox, ticket, AI
Operations, Evaluations, Knowledge); no client-side fetching, `Suspense` or `loading.tsx`.
Timings measured in a production build (Playwright, headless). Rationale in DECISIONS.md
("Loading and pending states").

### Design Lead review

| # | Finding | Severity | Status |
|---|---|---|---|
| DES-31 | A request failure during "Run analysis" (for example a dropped connection) made the awaited Server Action throw, which escaped to the route error boundary: the whole ticket was replaced by "Something went wrong", the running status went silent, and "Try again" reloaded the page instead of the analysis. | P1 | **Fixed** — caught in the handler and shown in the existing inline alert, worded honestly (the result is unknown; check before re-running, since a live run is not idempotent). E2E aborts the request; a negative control with the old handler fails it. |
| DES-32 | In Demo Mode an analysis takes ~16–21ms, so the busy label and spinner (built for multi-second live runs) flashed for a single frame on every run. | P2 | **Fixed** — the visual busy state appears only after 400ms (CSS animation delay); semantic busy state stays immediate. E2E proves a 100ms run never shows it; a negative control with a 0ms delay fails. |
| DES-33 | The busy label changed the button's width (186px → 203px → 186px), so the header jittered on every run. | P2 | **Fixed** — both labels share one grid cell; width constant in both colour schemes and under reduced motion. |
| DES-34 | When the inline error appeared, the "Run analysis" button jumped left (the wrapper widened around the message). Pre-existing. | P2 | **Fixed** — the wrapper is end-aligned; the button moves 0px. |

### Investigated and left unchanged (with evidence)

- **Route loading:** page renders take 1–10ms on the server; client-side navigation measured
  45–55ms (103ms on the first click, which also loads JavaScript). A loading fallback would
  flash, and `loading.tsx` makes a route stream, which returns HTTP 200 for `notFound()`,
  breaking the 404 contract established in 782bc71. Not added; nor is `useLinkStatus`.
- **Loading before data:** every page is server-rendered, so the first HTML already holds the
  resolved state (data, empty state or Demo Mode notice); there is no "empty, then data".
- **Error recovery "Try again":** a re-fetch of a few milliseconds; no pending UI needed.
- **Duplicate submission:** re-verified: a double-click and a triple Enter each send one request.

### Outcome

Four findings fixed, DES-3 and DES-14 resolved. Verified: typecheck, lint, 433 unit tests, the
`AI_MODE=demo` build and 21 E2E tests (3 new); the three timing-sensitive tests passed 9/9 over
three repeats. Browser (Playwright screenshots, light and dark, with and without reduced motion):
busy state readable and focus ring kept; the inline failure message at 7.6:1 (light) and 8.4:1
(dark); focus stays on the button through a run and after a failure.

## Audit #10 — Design Lead + Senior PM: correctness and credibility (2026-09-24)

Scope: a read-only forensic audit of the rendered product (every route; 1440, 1024 and 390px;
light and dark; DOM-measured colors, headings, table structure and titles), followed by a bounded
implementation pass for its must-fix and should-fix findings. Rationale in DECISIONS.md ("Ticket
state vs AI recommendation, and a product voice without self-narration").

### Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| DES-35 | Evaluations table: 6 header cells over 5 data cells, so expected outcomes sat under "Ticket", "Expected"/"Actual" showed "—" and "Result" was always empty. | P0 | **Fixed** — the ticket has its own cell; E2E asserts 6 cells in every row. |
| DES-36 | Self-referential copy in the product ("not a placeholder", "nothing here is a mockup", "not a mockup", "nothing here is invisible to the operator"), source paths, references to DECISIONS.md/EVALUATION.md, and a stale "Phase 2" note on Settings. | P1 | **Fixed** — rewritten as operator-facing copy; provenance kept. |
| DES-37 | "Escalated" was red (status) and amber (AI column) in one row; proposed actions used success green while the ticket was Open and nothing had been executed. | P1 | **Fixed** — three vocabularies with separate tone rules (ticket-labels.tsx); E2E asserts "Escalate", not "Escalated", and a non-badge "Refund customer". |
| DES-38 | Invoices and transactions had no dates, so timing claims (refund window, charges hours apart) could not be checked. | P1 | **Fixed** — issue date and transaction date/time in the account panel. |
| DES-39 | AI Operations in Demo Mode (the public default) was a grid of seven 0/—/$0.0000 tiles plus an empty usage table; ticket volume was sorted alphabetically ("High, Low, Medium, Urgent"). | P1 | **Fixed** — ticket volume first, in workflow/urgency order; one notice with the two true zeros; the tile grid (real data only) no longer leaves an empty slot. |
| DES-40 | Policy citations landed on a card with only title, category, slug and version, though each policy's text is stored. | P1 | **Fixed** (DES-25) — Knowledge renders every policy's and document's text. |
| DES-41 | Every page had the same document title; an unknown ticket id kept the default title. | P2 | **Fixed** — per-page titles through a root template; ticket pages use the subject. |
| DES-42 | Inbox at 1024px: dates wrapped to three lines, breaking inside the date. | P2 | **Fixed** — date and time each stay whole (two lines at most); the Inbox is ~3% shorter at 1024px than before (measured). The `eval:` key may still wrap at a hyphen: an unbreakable key made the page 18% taller. |
| DES-43 | Evaluations showed raw identifiers (`intent: general_inquiry`, `action: reply_and_monitor`); badges mixed lower and sentence case. | P2 | **Fixed** — labels from labels.ts (scenario keys unchanged); sentence-case badges. |
| DES-44 | Settings: the step column mixed a name and agent descriptions; model ids wrapped mid-token; no Demo Mode context. | P2 | **Fixed** — step name plus description, mono unbroken model ids, one Demo Mode sentence. |
| DES-45 | Link underlines used the border token (~1.3:1), so citations read as plain text. | P2 | **Fixed** — muted-foreground underline (`LINK_CLASSES`). |
| DES-46 | Risk score had no scale. | P2 | **Fixed** — "n / 100", the range defined on `Account.riskScore`; no direction or threshold claimed. |
| DES-47 | AI Operations' seven metric labels were `h3` headings under the Demo notice's `h2`. | P3 | **Fixed** — tile labels are plain text (same appearance); real run metrics sit under their own "Run metrics" heading. |

### Deferred (TODO.md)

Mobile layout (broken at 390px: fixed sidebar, overlapping ticket aside; explicitly out of scope
and a product decision), a labelled snapshot of live evaluation results in Demo Mode (a product
decision), seed-data realism, a mode-independent "no action taken" note on live drafts,
consolidating provenance notices on the ticket page, navigation naming, and agent-name
consistency. Found while verifying: the duplicate-billing fixture seeds both charges at the same
moment while its scripted finding says "~10 hours apart" (closed; see the follow-up below).

### Follow-up: duplicate-billing evidence (closed, 2026-09-24)

| # | Finding | Severity | Status |
|---|---|---|---|
| DES-48 | Once transaction times were shown (DES-38), the duplicate-billing ticket displayed two $399.00 charges at the same time while the scripted Billing finding said "~10 hours apart". | P2 | **Fixed** — see below. |

A read-only forensic check established:
- **The stored data is authoritative.** Both transactions are stored at `2026-09-15T12:00:00.000Z`
  (`occurredDaysAgo: 3` twice in `prisma/data/scenarios.ts`, unchanged since the first commit).
  The live pipeline's deterministic duplicate detector computes 0 hours apart from them, and the
  live evaluation run on this scenario reported "0 hours apart" and passed.
- **The claim came from the recording.** "~10 hours apart" was hand-written in an early mock
  response and carried into `src/lib/demo/recordings.ts`; it was never derived from the scenario.
- **The scenario does not require a gap.** Its expectation, the Duplicate Charge Policy ("within
  48 hours") and the customer's message ("twice on the same day") are all satisfied at 0 hours.
  No test, scoring rule, prompt or resolution rule reads the evidence wording.

Correction: only the recording's two strings changed: evidence "~10 hours apart" became "0 hours
apart", and summary "within hours" became "on the same day". Seed data, scenario, policy,
orchestration, routing, scoring and evaluation expectations are unchanged; the recommendation is
still Refund customer (Billing and Policy, policy "approve", no escalation, no human review).
Verified: typecheck and lint clean, 129 targeted recording/provider/orchestrator tests and 454 unit
tests pass, 24/24 Demo Mode E2E tests pass (against a scratch database), and the `dev.db` and
`eval.db` checksums are unchanged.
