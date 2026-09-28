# TODO

Backlog for work explicitly deferred, plus P2 findings from AUDIT.md.
Phase 2 (real orchestration end to end) is done — see ARCHITECTURE.md and
DECISIONS.md. This is what's left.

## Awaiting a decision from the user (not a defect — see AUDIT.md PM-5, Audit #4, Audit #5)

- **Mobile layout** (AUDIT.md Audit #10). Listed below as not planned, but at 390px the
  fixed sidebar leaves 166px for content and the ticket's context panel overlaps the
  title (horizontal scroll). A minimal fallback (sidebar to a top bar, ticket page to one
  column below `md`) would remove that; it needs a product decision to reverse the scope.
- **Evaluations in Demo Mode** (Audit #10): **resolved.** The Evaluations page shows the
  2026-09-24 live run as a dated, committed record, separate from the deployment's own
  evaluation state (DECISIONS.md, "Recorded live evaluation shipped as a verified
  snapshot"). A future live run gets its own record; this one is never edited.

- **Live evaluation: open questions from the 2026-09-24 baseline.** The first
  real evaluation passes ran on 2026-09-19/20 (historical results preserved in
  `eval.db`), and the current live baseline is a single run of all 11 scenarios
  on 2026-09-24 in `eval-2026-09-24.db`: 11/11 scored and passed (EVALUATION.md,
  "Current status"; DECISIONS.md, "Live evaluation refresh on a separate
  database"). Passing did not settle these; items 1-3 are not implementation tasks
  until decided:
  1. **`multi-domain` expected intent.** Live runs return `duplicate_charge`, which
     the documented primary-intent rule selects; the scenario expects
     `billing_question`. Decide the expectation, or specify `billing_question`
     differently (EVALUATION.md, "Audit of the curated scenarios against the rule").
  2. **Risk for `technical-escalation`.** The scenario expects Risk, but Risk runs
     only if the classifier reports angry/urgent sentiment or a risk domain; both
     live runs said `frustrated`. Decide whether Risk is actually required.
  3. **`failed-payment` expected agents.** It expects only `[billing]`, but live
     classification sometimes includes Technical (two of the three recorded
     classifications). Decide whether that expectation should stand.
  4. **Billing `policyReferences` contract failure** (`prohibited-refund`,
     2026-09-24): **resolved after the run.** The Billing agent emitted a malformed
     entry twice and was degraded; since `29fd3c0`, Billing and Technical no longer
     parse citations they never use, so this cannot degrade them (DECISIONS.md,
     "Billing and Technical do not parse policy citations"). Not yet measured live.
  Any further live run is a deliberate, paid, user-requested step (the standing
  rule is unchanged), to a separate `eval-<run>.db` so earlier results are kept.

## AI Operations — polish, once there's more real usage data to show

- Trend over time (e.g. escalation rate this week vs. last) — not
  meaningful yet with only a handful of runs; revisit once there's more
  live activity.
- Surface `AgentInvocation.errorMessage` text somewhere in AI Operations
  (currently only visible per-run on the Ticket Detail page), so a
  systemic failure pattern is visible without opening individual tickets.

## Settings

- Make model routing editable from the Settings UI (currently
  read-only, reflecting `modelRouting.ts` directly). Needs a decision on
  whether routing config lives in a DB table or stays code-configured with
  an admin override layer — flag for product input if it comes up.

## UI implementation phase

- Component library: not adopted. A small in-house primitive layer
  (`src/components/ui/`) covers current needs; revisit if interactive
  components (menus, dialogs, comboboxes) are needed (DECISIONS.md,
  "Design foundation: semantic tokens, presentation labels, and a
  decision-first ticket page").
- Inbox: filtering, search, sort, and pagination (AUDIT.md PM-2, PM-3).
- De-duplicate the "Run AI analysis" failure message, which currently
  shows once as the button's own inline error and again in the persisted
  "Analysis failed" panel after revalidation (AUDIT.md DES-5) — both are
  correct, just redundant once both are visible.
- General visual pass: hierarchy, spacing, color usage consistent with "a
  credible modern B2B SaaS app" (PRODUCT_SPEC.md) rather than plain tables.
  Done so far (AUDIT.md Audits #6 and #7): shared UI primitives and the
  purple/indigo removal; neutral tokens with AA-passing muted text and a
  dark-mode surface hierarchy; shared presentation labels
  (`src/lib/labels.ts`); the decision-first ticket page; grouped navigation
  with a route-aware active state (AUDIT.md DES-10); an AI Operations page
  that explains Demo Mode's empty run metrics (AUDIT.md DES-23); not-found
  and error states (AUDIT.md DES-24); interaction, focus and motion (AUDIT.md
  Audit #8); loading and pending states (AUDIT.md Audit #9); correctness and
  credibility (AUDIT.md Audit #10). The items below are the remaining UI follow-ups.
- Measure client-side navigation on the deployed demo (locally 45–103ms). If it is
  regularly above ~300ms, add a delayed pending hint to the nav with `useLinkStatus`
  (NavLink is already a client component); not `loading.tsx`, which would make an unknown
  ticket return 200 instead of 404 (DECISIONS.md, "Loading and pending states").
- Live mode only: during a first live analysis (seconds long), the AI section still shows
  "No AI analysis has been run on this ticket yet." beside the busy button. True, but
  could say the run is in progress; that needs the section's pending state, which lives in
  the client button, so it is deferred rather than moving server-rendered content to the client.
- Knowledge: optionally re-add a citation's arrival highlight with a small
  client-side hash listener (the `:target` version was removed, since Next's
  `pushState` navigation never triggers `:target`). Policy text is shown (DES-40).
- Live mode: the draft reply's "no … external action was actually executed" note
  appears only for simulated runs; a live draft that says "we've refunded it" has
  only the "Not sent" badge. Consider a mode-independent note (AUDIT.md Audit #10).
- Ticket page: provenance is stated four times (banner, SIMULATED RUN notice, draft
  note, per-step badges); consider consolidating without weakening it.
- Navigation naming: the "Operations" group (Inbox) vs the "Operations" item (AI
  Operations); single-item groups; page h1s that differ from nav labels.
- Agent naming: "Classification" beside "Billing Agent", "Response Agent", etc.
- Knowledge: product-doc categories are shown raw and mixed-case ("API-USAGE", "core").
- Extract the remaining repeated table-header and page-header markup into
  shared primitives.
- Dark mode: optionally lift the page background from near-black once there is
  something to tune against (AUDIT.md DES-13).
- Add an in-app light/dark toggle (currently `prefers-color-scheme`-only).

## Model provider abstraction — possible future extensions

- `ModelProvider.complete()`'s minimal shape (system + messages + max
  tokens → text + token counts) doesn't yet support provider-specific
  features like tool use, streaming, or prompt caching. Not needed by any
  current agent — widen the interface only when a real requirement shows
  up (see DECISIONS.md, "Model provider abstraction").
- Adding OpenAI or a local/open-weight model as a second real provider:
  implement `ModelProvider` in a new file under `src/lib/ai/providers/`,
  add one `case` to `registry.ts`'s `createProvider()`, point a pipeline
  step's `modelRouting.ts` entry at it. No agent or orchestrator code
  should need to change — that's the property to verify when this
  actually happens.

## Smaller / cleanup

- `EvaluationResult.orchestrationRunId` has no declared Prisma `@relation`
  to `OrchestrationRun` (pre-existing) — the Evaluations page works around
  this with a manual second query rather than `include`. Low priority
  (works correctly as-is); worth a proper relation if this page's queries
  grow more complex.
- `AgentInvocation.startedAt`/`finishedAt` are back-computed approximations
  (all invocations in a run share the same `finishedAt`) that don't
  reflect real sequential timing — `latencyMs` itself is accurate, only
  the derived timestamps aren't (AUDIT.md ENG-11). Fix by threading real
  wall-clock timestamps through `AgentResult` if AI Operations ever wants
  a real timeline view rather than durations.
- `KNOWN_AGENT_FLAGS.NO_BILLING_ISSUE_FOUND` has no dedicated
  `resolveOutcome()` branch — it falls through to the generic
  confidence-based default, which is already correct behavior, just
  implicit (AUDIT.md ENG-12). Not a bug; add an explicit branch only if
  it stops being obviously correct.
- `vitest.config.ts` / `vitest.integration.config.ts` print a benign Vite
  ESM/CJS warning (AUDIT.md ENG-5) — revisit if the project ever adopts
  `"type": "module"`.
- `npm audit` reports vulnerabilities only in `mysql2`/`deepmerge-ts`
  (transitive dev-time dependencies of the Prisma CLI's multi-database
  support — irrelevant since this project only uses the SQLite adapter).
  Revisit if `npm audit` ever flags something in a package actually used
  at runtime.
- **P2: the background seed is not temporally coherent.** `prisma/seed.ts`
  creates each background ticket 0-180 days before the anchor
  (`createdDaysAgo`) but lays out that account's invoices and charges at
  30-day multiples independently of it, so some charges post-date their own
  ticket (measured on a scratch seed: 23 of 79 background tickets have no
  charge at or before them). With refund timing now measured to the request time (DECISIONS.md,
  "Reference time"), the Policy agent prints "n/a" for a ticket whose account
  has no charge at or before it, which is a correct reading of incoherent
  data. It does not affect the 11 curated scenarios, which are coherent by
  construction. Fix by generating charges relative to the ticket, or creating
  tickets after the charge they concern; deliberately not changed here so the
  data was not adjusted to hide it.
- **Seed realism** (Audit #10): faker honorifics and domains ("Miss …", "memorable-pile.net"),
  multi-surname companies, Urgent priority on feature questions. A deliberate data pass,
  since it changes deterministic fixtures.
- Remove the unused default Next.js `public/*.svg` assets once the UI
  phase replaces them with real assets (or confirms none are needed).

## Explicitly not planned (unless product direction changes)

- Real payment processing, real email/chat delivery, multi-tenant auth —
  out of scope per PRODUCT_SPEC.md, "Non-goals."
- Mobile-responsive layout — this is a desktop-first operational tool by
  design.
