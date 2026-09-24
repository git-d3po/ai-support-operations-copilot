# TODO

Backlog for work explicitly deferred, plus P2 findings from AUDIT.md.
Phase 2 (real orchestration end to end) is done — see ARCHITECTURE.md and
DECISIONS.md. This is what's left.

## Awaiting a decision from the user (not a defect — see AUDIT.md PM-5, Audit #4, Audit #5)

- **Run a real evaluation pass.** `npm run eval` exists, is tested for
  safety, and refuses to run without a real `ANTHROPIC_API_KEY` (see
  EVALUATION.md, DECISIONS.md). No key is configured in this environment,
  and this project's standing rule is that a real model credential is
  never used without being asked first. The Evaluations page will keep
  honestly showing "not run" until the user provides a key and asks for
  this to happen. **Audit #4 confirmed the system is engineering-ready**
  for this — `npm run eval:dry-run` validated the full pipeline end to
  end (9/10 correct scenarios passed, 1 deliberately-wrong scenario
  correctly failed) against a deterministic fixture, so a real run should
  need no further plumbing changes. **Audit #5 is a pre-flight audit done
  specifically for the moment a real credential is about to be added** —
  it re-verified credential handling, provider-selection gating, and
  live/simulated labeling directly against the code (no issues found) and
  computed what to expect from a real run: ~35 model calls and roughly
  $0.10–$0.30 for all 10 scenarios (see EVALUATION.md, "Pre-flight:
  expected call count and cost for a real run" — labeled an estimate, not
  a measured figure). Still open, deliberately left to the user: whether
  the first real run should be one smoke-test scenario or all 10 at once.

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
- Loading, empty, and error states for every page (AUDIT.md DES-3).
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
  Audit #8). Next
  passes, in order:
  - Loading states (`loading.tsx`) for the first load after a demo restart.
- Ticket not-found title: for an unknown ticket id the document title settles on
  the layout default instead of "Page not found", because the ticket page has no
  `generateMetadata` (DECISIONS.md, "Application not-found and error states").
- Knowledge: show each policy's text, so a citation lands on something
  readable (AUDIT.md DES-25); optionally re-add the arrival highlight with a
  small client-side hash listener (the `:target` version was removed, since
  Next's `pushState` navigation never triggers `:target`).
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
- Remove the unused default Next.js `public/*.svg` assets once the UI
  phase replaces them with real assets (or confirms none are needed).

## Explicitly not planned (unless product direction changes)

- Real payment processing, real email/chat delivery, multi-tenant auth —
  out of scope per PRODUCT_SPEC.md, "Non-goals."
- Mobile-responsive layout — this is a desktop-first operational tool by
  design.
