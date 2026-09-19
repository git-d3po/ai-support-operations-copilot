# TODO

Backlog for work explicitly deferred, plus P2 findings from AUDIT.md.
Phase 2 (real orchestration end to end) is done — see ARCHITECTURE.md and
DECISIONS.md. This is what's left.

## Awaiting a decision from the user (not a defect — see AUDIT.md PM-5)

- **Run a real evaluation pass.** `npm run eval` exists, is tested for
  safety, and refuses to run without a real `ANTHROPIC_API_KEY` (see
  EVALUATION.md, DECISIONS.md). No key is configured in this environment,
  and this project's standing rule is that a real model credential is
  never used without being asked first. The Evaluations page will keep
  honestly showing "not run" until the user provides a key and asks for
  this to happen.

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

- Adopt a component library / design system (see DECISIONS.md, "Deferring
  a UI component library") once real visual design direction exists.
- Loading, empty, and error states for every page (AUDIT.md DES-3).
- Inbox: filtering, search, sort, and pagination (AUDIT.md PM-2, PM-3).
- De-duplicate the "Run AI analysis" failure message, which currently
  shows once as the button's own inline error and again in the persisted
  "Analysis failed" panel after revalidation (AUDIT.md DES-5) — both are
  correct, just redundant once both are visible.
- General visual pass: hierarchy, spacing, color usage consistent with "a
  credible modern B2B SaaS app" (PRODUCT_SPEC.md) rather than plain tables.

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
- Remove the unused default Next.js `public/*.svg` assets once the UI
  phase replaces them with real assets (or confirms none are needed).

## Explicitly not planned (unless product direction changes)

- Real payment processing, real email/chat delivery, multi-tenant auth —
  out of scope per PRODUCT_SPEC.md, "Non-goals."
- Mobile-responsive layout — this is a desktop-first operational tool by
  design.
