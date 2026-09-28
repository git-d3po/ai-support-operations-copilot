# Architecture

See PRODUCT_SPEC.md for what the product does and DECISIONS.md for why each
choice below was made. This document is the "how it's built" reference.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack), TypeScript, React 19 |
| Styling | Tailwind CSS v4 |
| Database | SQLite (file-based), via Prisma ORM 7 with the `@prisma/adapter-better-sqlite3` driver adapter |
| Validation | Zod 4 |
| AI provider | Anthropic (`@anthropic-ai/sdk`), behind a provider abstraction — see "Model provider abstraction" |
| Unit tests | Vitest |
| Integration tests | Vitest, against the real local database |
| E2E / regression tests | Playwright (`@playwright/test`) |
| Synthetic data | `@faker-js/faker` (seeded) + a small hand-written deterministic RNG |

A single Next.js app is both the UI and the "backend" (Server Components +
Server Actions + route handlers reading/writing SQLite directly) — there is
no separate API service. This is a deliberate simplicity choice for a
project whose point is to demonstrate orchestration, evaluation, and
product judgment, not distributed-systems plumbing.

## Directory structure

```
prisma/
  schema.prisma          # data model (see "Data model" below)
  seed.ts                # deterministic synthetic-data generator (entry point)
  data/                  # static reference datasets consumed by seed.ts
    products.ts           # Halcyon's product/plan catalog
    policies.ts           # synthetic company policy documents
    productDocs.ts        # synthetic product documentation / KB articles
    scenarios.ts           # the 11 curated evaluation tickets + expected outcomes
    ticketTemplates.ts     # templates for ordinary background inbox tickets

scripts/
  runEvaluation.ts        # `npm run eval` CLI entry — refuses to run without a real API key

src/
  app/                    # Next.js routes (Inbox, Ticket Detail, AI Operations,
                          # Evaluations, Knowledge, Settings)
    tickets/[id]/
      page.tsx             # renders the latest OrchestrationRun's findings/resolution/response
      actions.ts            # "Run AI analysis" Server Action
      RunAnalysisButton.tsx  # client component: pending/error state, never gets stuck
  components/             # shared UI components
  lib/
    db.ts                 # Prisma client singleton (driver-adapter wired)
    databaseUrl.ts         # single source of truth for the SQLite file path
    format.ts              # UI display formatting helpers
    synthetic/
      rng.ts               # seeded PRNG used by prisma/seed.ts
    ai/
      schemas.ts           # Zod schemas for every AI-produced artifact
      parse.ts             # structured-output parsing + retry/fallback
      providers/
        types.ts            # ModelProvider interface + request/result types
        anthropic.ts         # the ONLY file allowed to import @anthropic-ai/sdk
        mock.ts               # deterministic, network-free provider used in unit tests
        demoProvider.ts        # public Demo Mode: deterministic scripted replay, no model, no key
        provenance.ts          # the one definition of simulated-vs-real provenance
        registry.ts            # ProviderKey, getProvider()/registerProvider(), AI_MODE selection
    demo/
      recordings.ts          # scripted responses for the 11 curated scenarios (Demo Mode + dry-run)
    orchestrator/
      types.ts             # SpecialistAgent contract, AgentContext, ModelRoutingConfig, PipelineStepKey
      context.ts            # loadTicketContext() — the one DB read that assembles TicketDataContext
      evidence.ts            # deterministic pre-computation (duplicate detection, days-since-charge)
                              # and keyword-based policy/doc retrieval — see "Evidence & retrieval"
      prompts.ts              # buildSystemPrompt() + shared prompt-formatting helpers
      runStructuredStep.ts     # the retry+metrics wrapper every model call goes through
      modelRouting.ts           # per-pipeline-step provider + model + cost config
      modelClient.ts             # callModel() — the only way orchestrator/agents call a model
      selectAgents.ts       # dynamic agent-selection logic (pure, tested)
      classify.ts           # real ticket classification (calls "classifier" via callModel)
      resolve.ts             # deterministic resolution/escalation aggregation
      orchestrator.ts        # wires classify -> selectAgents -> agents -> resolve -> response
      persist.ts              # writes an OrchestrationOutcome as DB rows
      analyzeTicket.ts         # loadTicketContext + runOrchestration + persist, never throws
      agents/
        billingAgent.ts, policyAgent.ts, technicalAgent.ts,
        riskAgent.ts, responseAgent.ts   # real SpecialistAgent implementations
        registry.ts                       # AgentKey -> SpecialistAgent map
        fallback.ts                        # honest degraded results when a model call fails
    evaluation/
      score.ts              # scoreOutcome() — compares a real outcome to an expected one
      runEvaluation.ts        # runs every curated case through analyzeTicket() and scores it

tests/
  unit/                   # Vitest — pure logic, no I/O, no network
  integration/             # Vitest — real local database, still no network
  e2e/                      # Playwright — against a production build + seeded DB
```

## Data model

See `prisma/schema.prisma` for the authoritative definition. Five domains:

1. **Core SaaS domain** — `Customer`, `Account`, `Product`, `Subscription`,
   `SubscriptionItem`, `Invoice`, `Transaction`. Standard normalized
   billing shape; nothing AI-specific.
2. **Support domain** — `Ticket`, `Message`. A ticket optionally carries a
   `scenarioKey`, marking it as one of the 11 curated evaluation tickets.
3. **Knowledge domain** — `Policy`, `ProductDoc`. What specialist agents
   ground findings in.
4. **AI orchestration domain** — `OrchestrationRun` (one per "Run AI
   analysis" click) with JSON columns for the classification, resolution,
   escalation, and response artifacts (each validated against a Zod schema
   before being written — see "Structured outputs" below), plus
   `errorMessage` for a run that aborted entirely; and `AgentInvocation`
   (one row per model call actually made for that run — the classifier
   plus every specialist agent invoked — with its finding/classification
   JSON, model, tokens, latency, estimated cost, and `errorMessage` if that
   specific step degraded).
5. **Evaluation domain** — `EvaluationCase` (one per curated ticket, with
   its `expectedOutcome`) and `EvaluationResult` (one scored row per
   evaluation run against an `OrchestrationRun`).

JSON columns store schema-validated structured data, not free text — the
Zod schema is the actual contract; the DB column is just its storage.

## Orchestration pipeline

```
Ticket
  → classifyTicket()                       [classify.ts]        (real model call, "classifier" step)
  → selectAgents(classification)            [selectAgents.ts]    (pure, deterministic)
  → billing/policy/technical/risk .run()     [agents/*.ts]        (real model calls, whichever were selected)
  → resolveOutcome(classification, findings)  [resolve.ts]        (pure, deterministic)
  → responseAgent.run() — WITH the resolution in context           [agents/responseAgent.ts]
  → persistOrchestrationRun()                                       [persist.ts]
```

`runOrchestration()` in `orchestrator.ts` wires the model-calling steps
together as a plain async function — no agent framework, no hidden control
flow — and stays DB-free (context loading and persistence are separate
concerns: `context.ts`, `persist.ts`, `analyzeTicket.ts`), which is what
keeps it directly unit-testable (`orchestrator.test.ts` drives it entirely
through a `MockProvider`).

**One deliberate ordering deviation:** the Response agent does not run as
"just another selected agent" alongside billing/policy/technical/risk — it
runs *after* `resolveOutcome()`, with the resolution and escalation
decision already in its context. Its job is to communicate a decision that
has already been made, not help make it — see DECISIONS.md ("Response
agent runs after resolution, not as a uniform pipeline step"). This is
verified by a dedicated test in `orchestrator.test.ts` that fails if the
Response agent's prompt doesn't already contain the resolution.

Every step's output is a Zod-validated structured type from
`src/lib/ai/schemas.ts`. Every step that calls a model goes through
`runStructuredStep()` (validate, retry once with the specific error fed
back, accumulate real metrics across every attempt) and, on final failure,
returns an honest "this step failed" result (`agents/fallback.ts`) rather
than ever letting malformed output enter the system — Policy/Risk failures
fail *safe* specifically: a failed Policy Agent yields `policyDecision:
null` (never a fabricated decision) and a failed Risk Agent recommends
escalation rather than silently passing.

## Evidence & retrieval

Two different things happen under "evidence," deliberately kept separate:

1. **Deterministic pre-computation** (`evidence.ts`) for facts that are
   exact and mechanically checkable — duplicate-charge detection (same
   amount, same invoice, within 48 hours), days-since-a-charge, most
   recent failed payment. These are computed in TypeScript and handed to
   the model as pre-verified evidence, because asking a model to do date
   arithmetic or cross-reference transactions itself is a real source of
   error for something code can just get right. See DECISIONS.md.
2. **Keyword-overlap retrieval** (`evidence.ts`: `retrieveRelevantPolicies`,
   `retrieveRelevantProductDocs`) for which policy documents or product
   docs are relevant to a ticket — a deterministic routing table by intent
   for policies, and simple keyword-overlap scoring against ticket text
   for product docs. Not semantic search or embeddings: the knowledge base
   is a handful of documents, and this is enough to be genuinely useful
   without adding a vector store for a dataset this size.

The model's job is the part that's genuinely a judgment call: given the
retrieved policy text and the pre-verified facts, does this refund
request actually meet the policy's conditions? Given the retrieved
known-issue doc and the conversation, has the customer already tried the
documented workaround? That's real reasoning over real, grounded evidence
— not the model re-deriving facts a computer already computed exactly.

## Structured outputs, not chain-of-thought

Every AI-facing schema in `src/lib/ai/schemas.ts` — `TicketClassification`,
`AgentFinding` (and its Policy/Risk extensions), `PolicyDecision`,
`ResolutionDecision`, `EscalationDecision`, `CustomerResponse`,
`EvaluationResult` — is a closed, validated shape: a summary, evidence, a
confidence score, citations, and a decision. Nothing in the product
persists or displays a reasoning transcript. Model output is run through
`parseStructuredOutput()` / `callWithStructuredRetry()`
(`src/lib/ai/parse.ts`), wrapped by `runStructuredStep()`, which:

1. Extracts JSON even if the model wrapped it in prose or a markdown fence.
2. Validates it against the Zod schema.
3. On failure, retries once with the specific validation error fed back
   into the prompt.
4. Accumulates real token/latency/cost metrics across every attempt made
   (a retry is a real, billed call).
5. Returns `data: null` on final failure — callers construct an honest
   degraded result (`agents/fallback.ts`) rather than letting a malformed
   or fabricated value flow downstream.

**Policy and Risk agents extend the base `AgentFinding` shape** —
`PolicyAgentFindingSchema` adds a required (nullable) `policyDecision`;
`RiskAgentFindingSchema` adds `escalationRecommended`/`targetTeam`/
`severity`. Narrowing `AnyAgentFinding` (the union of all three shapes) to
one of these uses `isPolicyFinding()`/`isRiskFinding()` type guards
exported from `schemas.ts` — a plain `finding.agentKey === "policy"` check
does **not** narrow the union for TypeScript here, because the base
schema's `agentKey` field isn't literal-typed; this bit anyone touching
agent-finding code should know before reaching for a `.agentKey ===`
check and being surprised it doesn't narrow.

## Model provider abstraction

Agents and the orchestrator never call `@anthropic-ai/sdk`, or any other
provider SDK, directly. They depend on one interface:

```ts
// src/lib/ai/providers/types.ts
interface ModelProvider {
  readonly key: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}
```

`src/lib/ai/providers/anthropic.ts` implements it for Anthropic and is —
by convention, not by a build-time restriction — **the only file in the
codebase allowed to import `@anthropic-ai/sdk`** (verified: `grep -rl
"@anthropic-ai/sdk" src/` returns exactly that one file). `src/lib/ai/
providers/mock.ts` implements the same interface with canned, deterministic
responses for unit tests. `src/lib/ai/providers/registry.ts` resolves a
`ProviderKey` (`"anthropic" | "mock"`) to a `ModelProvider` instance,
lazily — importing the registry or even constructing an `AnthropicProvider`
never requires `ANTHROPIC_API_KEY` to be set; only actually calling
`.complete()` does (verified: `npm run build` succeeds with no API key
set).

On top of that, `src/lib/orchestrator/modelClient.ts` exports the one
function every agent and the classifier actually call:

```ts
callModel(stepKey: PipelineStepKey, request: Omit<CompletionRequest, "model">): Promise<ModelCallResult>
```

`callModel` looks up `stepKey` (one of the 5 agent keys, or `"classifier"`)
in `modelRouting.ts`, resolves its configured provider via the registry,
calls it, and returns the result plus latency and estimated cost. **An
agent's code never knows or cares which provider handled its call** —
verified by `grep -rn "claude-" src/lib/orchestrator/agents/` returning
nothing; every agent file is provider- and model-agnostic. Adding a new
provider (OpenAI, a local/open-weight model server) is: implement
`ModelProvider`, add one `case` in `registry.ts`'s `createProvider()`,
done — no change to any agent, to `orchestrator.ts`, or to any schema.

**Public Demo Mode (`AI_MODE`):** `registry.ts`'s `createProvider("anthropic")`
reads the server-only `AI_MODE` variable (`src/lib/ai/mode.ts`). Unset or
`live` returns the real `AnthropicProvider`, exactly as before. `demo`
returns `DemoProvider`, a deterministic replay of the scripted responses in
`src/lib/demo/recordings.ts`, so the real orchestrator, routing, agents,
resolution rules and response guard all run and only the model call is
replaced. In that mode `AnthropicProvider` is never constructed (even if an
API key is set), an unknown value of `AI_MODE` is an error, and
`npm run eval` refuses to run. Demo runs are persisted like any other but
with `isSimulated = true` and provider `demo` on every invocation, which is
what keeps them out of AI Operations' real metrics; that flag comes from one
shared rule (`provenance.ts`), including for failed runs. The Server Action
delegates to `requestAnalysis()`, which in Demo Mode runs only curated
scenarios, rejects anything else before persisting, and persists at most one
demo run per ticket, whether it completed or failed (a failed demo run is
returned as its stored error and not retried; an unexpected database error is
returned as a failure). That guarantee is a database lookup plus a
process-local in-flight guard, so it holds for a single server process (the
intended public demo) and is not multi-instance-safe. Demo Mode performs no
external action: scripted replies may say "Refund processed", and the ticket
page states that nothing was actually executed. The check lives *inside*
`createProvider` rather than in an external Next.js instrumentation hook
because Next's per-route bundling gives an instrumentation hook and a Server
Action separate module instances of `registry.ts`; reading `process.env`
inside `createProvider` works regardless of bundling, since env vars are
process-wide. See DECISIONS.md ("Public Demo Mode") for the reasoning,
including why the earlier test-only fixture provider was retired instead of
promoted.

## Model routing

`src/lib/orchestrator/modelRouting.ts` maps each pipeline step (5 agent
keys + `"classifier"`) to a **provider and model id** plus per-token
pricing (for cost estimation only — nothing is actually billed). Changing
which model — or which provider — a step uses is a one-line config change;
no agent or orchestrator code references a model id or provider directly.
This is intentionally a small, boring module — model routing is
configurable because it's good engineering hygiene, not because it's the
product's centerpiece (see DECISIONS.md).

## Synthetic data strategy

`prisma/seed.ts` is the single entry point. It:

1. Resets the database (idempotent — safe to re-run).
2. Seeds static reference data: the product catalog, policy documents, and
   product docs (`prisma/data/`).
3. Materializes the 11 curated scenarios from hand-authored fixtures in
   `prisma/data/scenarios.ts` — specific customers, accounts, billing
   history, and conversations constructed so a *correct* AI analysis is
   actually determinable (this is what EVALUATION.md scores against).
4. Generates ~90 additional background customers procedurally (accounts,
   subscriptions, invoices, transactions, and 0-3 ordinary tickets each)
   for realistic inbox volume and AI Operations metrics.

Every random decision — which plan a background customer is on, how many
invoices they have, which ticket template applies — goes through
`createRng(SEED)` (`src/lib/synthetic/rng.ts`, a small dependency-free
mulberry32 implementation) or `faker.seed(SEED)`. Given the same seed, the
script produces byte-identical data every run; verified by running it
twice and diffing the resulting row counts (`npm run db:seed` twice in a
row produces the same "Seeded 101 customers, 92 tickets..." summary).

## Running AI analysis: the request path

1. Operator clicks "Run AI analysis" on a Ticket Detail page
   (`RunAnalysisButton.tsx`, a client component using `useTransition`).
2. It calls the `runAnalysisAction` Server Action (`app/tickets/[id]/
   actions.ts`), which delegates entirely to `analyzeTicket(ticketId)`.
3. `analyzeTicket()` loads real ticket data (`context.ts`), runs the
   pipeline (`orchestrator.ts`), and persists the result (`persist.ts`) —
   or, if anything throws (most realistically: no `ANTHROPIC_API_KEY`
   configured), persists a `status: "failed"` `OrchestrationRun` with the
   error message and returns a clean error. **It never throws** — the
   Server Action never needs its own try/catch around model-calling code.
4. The action calls `revalidatePath` so the Ticket Detail page re-renders
   with the freshly persisted run. The button shows a definite result —
   success or an inline error with a retry option — never an indefinite
   spinner.

## Testing strategy

- **Unit (Vitest, `tests/unit/`)**: schema validation, structured-output
  parsing/retry, RNG determinism, dynamic agent selection against all 11
  curated scenarios, the deterministic evidence/retrieval helpers
  (`evidence.test.ts`), each specialist agent and the classifier in
  isolation (via `MockProvider` and the `TASK:`-marker-based
  `createTaskMockProvider` test helper — see `tests/unit/testSupport/`),
  `resolveOutcome()`'s full branch coverage, the evaluation scorer
  (`score.test.ts`), the orchestrator's real end-to-end control flow, the
  provider abstraction, and the Anthropic provider's response-mapping with
  the SDK mocked. Fast, no I/O, no database, **no network** whatsoever.
- **Integration (Vitest, `tests/integration/`, `npm run test:integration`)**:
  persistence against the real local SQLite database (`persist.test.ts`)
  and the evaluation runner's safety property — it never fabricates a
  score when the pipeline can't actually run (`runEvaluation.test.ts`).
  Every test creates its own throwaway rows and cleans them up; the seeded
  demo dataset is never left mutated.
- **E2E (Playwright, `tests/e2e/`)**: runs against a production build
  (`npm run build && npm run start`) and the seeded database. `smoke.spec.ts`
  covers every top-level route; `runAnalysis.spec.ts` covers the primary
  "Run AI analysis" journey (Inbox → open ticket → run analysis → observe
  the completed orchestration → inspect findings, resolution, and
  response) against the **real** orchestrator, with only the model
  provider swapped for a deterministic fixture (see "Model provider
  abstraction," above, and DECISIONS.md) — because there is no
  `ANTHROPIC_API_KEY` in this environment and, per project policy, no
  automated test ever uses a real one.

## What's deliberately not built yet

See TODO.md for the full list. In one line: the full pipeline is now
genuinely model-backed end to end and persisted. When this was written, the
evaluation suite had not yet been *run* against a real provider (it requires
`ANTHROPIC_API_KEY`, which, per project policy, is never used without being
explicitly asked for first). Live runs have since been made: the historical
2026-09-20 results remain preserved in the local `eval.db`, and the current
live baseline, a single run of all 11 scenarios on 2026-09-24, is stored
separately in the local `eval-2026-09-24.db` (see EVALUATION.md, "Current
status"). Neither database is part of the deployment: the 2026-09-24 run is
shipped as a committed, verified record and shown on the Evaluations page as a
dated historical run, separate from the deployment's own (in Demo Mode, empty)
evaluation state. UI visual polish, editable model routing
from Settings, and Inbox filtering/pagination also remain deferred.
