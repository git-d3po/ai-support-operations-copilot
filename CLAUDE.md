@AGENTS.md

# CLAUDE.md — Operating Manual

This file governs how work happens in this repository. It is deliberately
concise; the reasoning behind each rule lives in [DECISIONS.md](DECISIONS.md),
and the current backlog lives in [TODO.md](TODO.md).

## What this project is

An AI-powered support operations copilot for **Halcyon**, a fictional B2B
SaaS workflow-automation company. It is a portfolio project, but the rule in
[PRODUCT_SPEC.md](PRODUCT_SPEC.md) is: **it must not look like one.** Every
screen, metric, and AI output must trace back to real underlying data and
real logic — never a hardcoded number standing in for intelligence, and
never a metric with no query behind it. As of Phase 2, orchestration is
genuinely model-backed end to end (see ARCHITECTURE.md); this rule now
applies with no "currently stubbed" asterisk.

## Architecture principles

1. **Explicit orchestrator, not a framework.** The pipeline is
   `Ticket → Classification → Agent selection → Specialist execution →
   Structured findings → Resolution/escalation → Customer response`,
   implemented as plain, readable TypeScript functions in
   `src/lib/orchestrator/`. See DECISIONS.md for why.
2. **Dynamic agent selection is load-bearing, not decorative.** The
   orchestrator must never invoke every specialist agent for every ticket.
   `selectAgents()` is pure and unit-tested against all 11 curated
   scenarios — changes to routing logic must keep those tests passing or
   deliberately update the scenario's expected outcome (with justification).
3. **Structured outputs only.** Every AI-produced artifact (classification,
   agent finding, policy decision, resolution, escalation, customer
   response, evaluation result) is a Zod schema in `src/lib/ai/schemas.ts`.
   No agent or orchestrator step may return free-form prose as its
   contract, and **no chain-of-thought is ever persisted or displayed** —
   only concise, structured artifacts (summary, evidence, confidence,
   citations, decision).
4. **Provider-agnostic model calls.** Agents and the orchestrator call
   `callModel(stepKey, request)` (`src/lib/orchestrator/modelClient.ts`),
   never a provider SDK. `src/lib/ai/providers/anthropic.ts` is the only
   file allowed to import `@anthropic-ai/sdk`. Adding a provider (OpenAI, a
   local/open-weight model) means implementing `ModelProvider` and adding
   one case in `src/lib/ai/providers/registry.ts` — nothing else changes.
5. **Model routing is configurable, not central.** `src/lib/orchestrator/
   modelRouting.ts` maps each pipeline step to a provider + model. Changing
   a step's model or provider must never require touching agent logic or
   the orchestrator.
6. **Synthetic data is deterministic.** Every random decision in
   `prisma/seed.ts` goes through the seeded RNG in
   `src/lib/synthetic/rng.ts` (seed constant in the same file). Never use
   `Math.random()`, unseeded `faker` calls, or wall-clock time in seed data.
   `faker.seed(SEED)` must be called before any faker usage.
7. **Evaluation is a first-class feature, not an afterthought.** The 11
   curated tickets in `prisma/data/scenarios.ts` carry hand-authored
   expected outcomes. Any change to orchestrator behavior should be checked
   against these scenarios (see EVALUATION.md).

## Coding standards

- TypeScript strict mode is on; do not weaken it.
- Prefer plain functions and explicit data flow over abstraction layers,
  base classes, or dependency-injection containers. This is a mid-sized
  single app, not a platform.
- Server Components by default; add `"use client"` only where interactivity
  requires it.
- All Prisma access goes through `src/lib/db.ts` (the shared client
  singleton) — never instantiate `PrismaClient` ad hoc outside seed/test
  setup.
- Validate all AI model output through `parseStructuredOutput` /
  `callWithStructuredRetry` (`src/lib/ai/parse.ts`). Never `JSON.parse` a
  model response directly in agent code.
- Never import a model-provider SDK outside `src/lib/ai/providers/`. Agent
  and orchestrator code calls `callModel()`; if you find yourself importing
  `@anthropic-ai/sdk` (or any future provider SDK) anywhere else, stop —
  that's the coupling the provider abstraction exists to prevent.
- Don't add abstractions, config flags, or "future-proofing" for
  requirements that don't exist yet. Three similar agent files are better
  than a premature `BaseAgent` class.

## Testing requirements

- **Unit tests (Vitest, `tests/unit/`)**: schema validation, RNG
  determinism, agent-selection logic, structured-output parsing/retry, and
  the model-provider layer. Pure logic — no database, **no network**: the
  provider layer is tested via `MockProvider` and a mocked SDK, never a
  live API call (see `modelClient.test.ts`, `anthropicProvider.test.ts`).
- **Integration tests (Vitest, `tests/integration/`, `npm run test:integration`)**:
  touch the real local SQLite database via `src/lib/db.ts` — persistence
  and the evaluation runner's safety behavior live here, not in
  `tests/unit/`. Never point these at a real model provider either; the
  point is testing DB round-trips and graceful-failure paths, both of
  which are exercised without any live call.
- **E2E tests (Playwright, `tests/e2e/`)**: the deterministic regression
  layer. Run against a production build (`npm run build && npm run start`)
  and the seeded database, so assertions can reference specific seeded
  tickets/customers by name. The app runs in Demo Mode (`AI_MODE=demo`,
  set in `playwright.config.ts`; the deterministic `DemoProvider` in
  `src/lib/ai/providers/`, see DECISIONS.md, "Public Demo Mode") so the
  "Run demo analysis" journey never makes a live call either. This is the
  project's actual regression safety net — treat failing e2e tests as
  blocking, not advisory.
- **Never use a real model credential in any automated test, at any test
  level.** If a task seems to need one (e.g. actually running the
  evaluation suite for real), stop and ask first — see `npm run eval`'s
  own refusal-without-a-key behavior for the pattern to follow.
- **Exploratory/visual checks**: use the Claude Code built-in
  browser/computer-use tools for one-off "does this look right" passes
  during development. These are not a substitute for Playwright coverage —
  anything worth checking twice belongs in `tests/e2e/`.
- Before calling a feature done: `npm run typecheck && npm run lint && npm
  run test && npm run build`, plus `npm run test:integration` when
  persistence changed and `npm run test:e2e` when UI changed.

## AI safety / quality requirements

- No hidden chain-of-thought anywhere in the product — API responses, DB
  rows, and UI must only ever contain the structured artifacts in
  `src/lib/ai/schemas.ts`.
- Malformed model output must be handled gracefully: validate, retry once
  with the error fed back, and surface a clear failure state — never crash
  a request or silently coerce invalid data.
- All customer/account/ticket data is synthetic. Never introduce real
  personal data, even as a "just for testing" placeholder.
- Escalation and policy decisions must always cite the specific policy slug
  or evidence they relied on — "unclear" or an uncited decision is a bug,
  matching the synthetic Escalation Policy's own rule.

## Self-audit workflow

Iterate as `BUILD → TEST → AUDIT → PRIORITIZE → FIX → TEST → AUDIT → …`.
During AUDIT, evaluate the current state from three perspectives — Senior
Product Manager, Principal AI Engineer, Design Lead — and record findings in
[AUDIT.md](AUDIT.md) as P0 (broken/wrong), P1 (materially weak), or P2
(polish). Fix P0 and P1 autonomously when the fix doesn't require a product-
direction call; log P2s in [TODO.md](TODO.md). Re-test and re-audit after
fixes. Stop escalating to the user once remaining issues are P2 or need
genuine product judgment.

## When to ask vs. decide autonomously

**Decide autonomously:** implementation details, library choices within the
existing stack, schema field additions, test coverage, refactors, bug
fixes, UI layout within the existing design direction, and anything
reversible.

**Ask first:** a genuinely consequential product-direction change (e.g.
changing the specialist agent roster, the orchestration pipeline shape, or
what the product demonstrates), a missing credential with no reasonable
fallback (e.g. no `ANTHROPIC_API_KEY` when live model calls are required),
or a decision whose cost of being wrong is high and hard to reverse (e.g.
deleting seed data, force-pushing, changing the fictional company's
identity). When in doubt, prefer shipping a reversible version and noting
the open question in TODO.md over stopping to ask.

Every significant decision — architectural, product, or tooling — gets
logged in [DECISIONS.md](DECISIONS.md) as it's made, not retroactively.
