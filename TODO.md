# TODO

Backlog for work explicitly deferred out of the foundation phase, plus P2
findings from AUDIT.md. Organized by what unlocks what — Phase 2 items are
mostly gated on real model-backed agent logic existing at all.

## Phase 2 — Real orchestration (top priority)

The single biggest gap: every orchestrator step is currently a labeled
stub. In dependency order:

1. **`classifyTicket()`** (`src/lib/orchestrator/classify.ts`) — real
   Claude call (routed per `modelRouting.ts`), validated through
   `callWithStructuredRetry(TicketClassificationSchema, ...)`.
2. **Specialist agents** (`src/lib/orchestrator/agents/*.ts`) — replace
   `stubAgentResult()` with real prompts per agent, each reading the
   relevant slice of `context.accountContext` (billing history for
   Billing, policy docs for Policy, product docs for Technical, risk
   signals for Risk) and citing evidence from it.
3. **`resolveOutcome()`** (`src/lib/orchestrator/resolve.ts`) — real
   aggregation logic from agent findings to a `ResolutionDecision` +
   optional `EscalationDecision` (currently a placeholder that only checks
   for a `requires_escalation` flag).
4. **Response Agent** — return a real `CustomerResponse`, not an
   `AgentFinding`; thread it through `orchestrator.ts`'s `response` field
   (currently hardcoded `null`).
5. **API route** — a `POST /api/tickets/[id]/analyze` (or similar) route
   handler that calls `runOrchestration()`, persists an `OrchestrationRun`
   + `AgentInvocation` rows, and returns the result.
6. **"Run AI analysis" button** on the Ticket Detail page, wired to the
   route above, replacing the current "not yet implemented" placeholder.
7. **Evaluation runner** (`npm run eval`, not yet created) — runs
   `runOrchestration()` against all 10 curated cases, scores against
   `expectedOutcome`, writes `EvaluationResult` rows. See EVALUATION.md.

## Phase 2 — AI Operations, once real runs exist

- Automation/containment rate, escalation rate, per-agent usage, latency,
  and estimated cost — all computable from `AgentInvocation` /
  `OrchestrationRun` once Phase 2 items above produce real rows. The page
  already has the query structure in place for ticket volume; extend it
  rather than rewrite it.
- Failure/retry rate — surfaced once `callWithStructuredRetry`'s retry
  path actually fires in practice.

## Phase 2 — Settings

- Make model routing editable from the Settings UI (currently
  read-only, reflecting `modelRouting.ts` directly). Needs a decision on
  whether routing config lives in a DB table or stays code-configured with
  an admin override layer — flag for product input if it comes up.

## UI implementation phase

- Adopt a component library / design system (see DECISIONS.md, "Deferring
  a UI component library") once real visual design direction exists.
- Loading, empty, and error states for every page (AUDIT.md DES-3).
- Inbox: filtering, search, sort, and pagination (AUDIT.md PM-2, PM-3).
- Ticket Detail: render the AI orchestration timeline, per-agent findings,
  confidence, policy references, and model/latency/cost — the schema and
  data model already support this; only the read side needs building once
  real `OrchestrationRun` rows exist.
- General visual pass: hierarchy, spacing, color usage consistent with "a
  credible modern B2B SaaS app" (PRODUCT_SPEC.md) rather than plain tables.

## Smaller / cleanup

- `vitest.config.ts` prints a benign Vite ESM/CJS warning (AUDIT.md ENG-5)
  — revisit if the project ever adopts `"type": "module"`.
- No integration test yet persists an `OrchestrationRun` end-to-end
  (AUDIT.md ENG-4) — add once Phase 2 gives it real content worth
  asserting on.
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
- Multi-provider LLM abstraction — see DECISIONS.md, "AI provider:
  Anthropic SDK."
