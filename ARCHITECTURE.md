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
| AI provider | Anthropic (`@anthropic-ai/sdk`) |
| Unit tests | Vitest |
| E2E / regression tests | Playwright (`@playwright/test`) |
| Synthetic data | `@faker-js/faker` (seeded) + a small hand-written deterministic RNG |

A single Next.js app is both the UI and the "backend" (Server Components +
route handlers reading/writing SQLite directly) — there is no separate API
service. This is a deliberate simplicity choice for a project whose point
is to demonstrate orchestration, evaluation, and product judgment, not
distributed-systems plumbing.

## Directory structure

```
prisma/
  schema.prisma          # data model (see "Data model" below)
  seed.ts                # deterministic synthetic-data generator (entry point)
  data/                  # static reference datasets consumed by seed.ts
    products.ts           # Halcyon's product/plan catalog
    policies.ts           # synthetic company policy documents
    productDocs.ts        # synthetic product documentation / KB articles
    scenarios.ts           # the 10 curated evaluation tickets + expected outcomes
    ticketTemplates.ts     # templates for ordinary background inbox tickets

src/
  app/                    # Next.js routes (Inbox, Ticket Detail, AI Operations,
                          # Evaluations, Knowledge, Settings)
  components/             # shared UI components
  lib/
    db.ts                 # Prisma client singleton (driver-adapter wired)
    databaseUrl.ts         # single source of truth for the SQLite file path
    format.ts              # display formatting helpers
    synthetic/
      rng.ts               # seeded PRNG used by prisma/seed.ts
    ai/
      schemas.ts           # Zod schemas for every AI-produced artifact
      parse.ts             # structured-output parsing + retry/fallback
      providers/
        types.ts            # ModelProvider interface + request/result types
        anthropic.ts         # the ONLY file allowed to import @anthropic-ai/sdk
        mock.ts               # deterministic, network-free provider used in tests
        registry.ts           # ProviderKey, getProvider()/registerProvider()
    orchestrator/
      types.ts             # SpecialistAgent contract, AgentContext, ModelRoutingConfig, PipelineStepKey
      modelRouting.ts       # per-pipeline-step provider + model + cost config
      modelClient.ts         # callModel() — the only way orchestrator/agents call a model
      selectAgents.ts       # dynamic agent-selection logic (pure, tested)
      classify.ts           # ticket classification step (stub — see TODO.md)
      resolve.ts             # resolution/escalation aggregation (stub — see TODO.md)
      orchestrator.ts        # wires classify -> selectAgents -> agents -> resolve
      agents/
        billingAgent.ts, policyAgent.ts, technicalAgent.ts,
        riskAgent.ts, responseAgent.ts   # SpecialistAgent implementations (stubs)
        registry.ts                       # AgentKey -> SpecialistAgent map
        stub.ts                           # shared placeholder-result helper

tests/
  unit/                   # Vitest — pure logic, no I/O
  e2e/                    # Playwright — against a production build + seeded DB
```

## Data model

See `prisma/schema.prisma` for the authoritative definition. Three domains:

1. **Core SaaS domain** — `Customer`, `Account`, `Product`, `Subscription`,
   `SubscriptionItem`, `Invoice`, `Transaction`. Standard normalized
   billing shape; nothing AI-specific.
2. **Support domain** — `Ticket`, `Message`. A ticket optionally carries a
   `scenarioKey`, marking it as one of the 10 curated evaluation tickets.
3. **Knowledge domain** — `Policy`, `ProductDoc`. What specialist agents
   ground findings in.
4. **AI orchestration domain** — `OrchestrationRun` (one per "Run AI
   analysis" click) with JSON columns for the classification, resolution,
   escalation, and response artifacts (each validated against a Zod schema
   before being written — see "Structured outputs" below), and
   `AgentInvocation` (one row per specialist agent actually invoked for
   that run, with its finding plus model/tokens/latency/cost).
5. **Evaluation domain** — `EvaluationCase` (one per curated ticket, with
   its `expectedOutcome`) and `EvaluationResult` (one scored row per
   evaluation run against an `OrchestrationRun`).

JSON columns store schema-validated structured data, not free text — the
Zod schema is the actual contract; the DB column is just its storage.

## Orchestration pipeline

```
Ticket
  → classifyTicket()          [src/lib/orchestrator/classify.ts]
  → selectAgents()             [src/lib/orchestrator/selectAgents.ts]
  → AGENT_REGISTRY[key].run()  [src/lib/orchestrator/agents/*]  (per selected agent)
  → resolveOutcome()           [src/lib/orchestrator/resolve.ts]
  → (Response agent's output becomes the proposed CustomerResponse)
```

`runOrchestration()` in `orchestrator.ts` wires these together as a plain
async function — no agent framework, no hidden control flow. Every step's
output is a Zod-validated structured type from `src/lib/ai/schemas.ts`.

**Foundation-phase status:** the control flow above is real and unit-tested
end to end. `classifyTicket()`, `resolveOutcome()`, and every agent's
`run()` currently return deterministic placeholder values (clearly marked
`stub_not_implemented` / "Phase 2" in code) rather than calling a model —
see TODO.md. `selectAgents()` is the one step that's fully real today,
because agent *selection* is a routing decision, not something that itself
needs a model call, and it's the piece EVALUATION.md's "routing accuracy"
dimension depends on. When `classifyTicket()` and each agent's `run()` are
implemented, they'll call `callModel()` (see "Model provider abstraction,"
below) — not a provider SDK — so this pipeline diagram and every test
against it stay valid regardless of which provider ends up handling the
call.

## Structured outputs, not chain-of-thought

Every AI-facing schema in `src/lib/ai/schemas.ts` — `TicketClassification`,
`AgentFinding`, `PolicyDecision`, `ResolutionDecision`,
`EscalationDecision`, `CustomerResponse`, `EvaluationResult` — is a closed,
validated shape: a summary, evidence, a confidence score, citations, and a
decision. Nothing in the product persists or displays a reasoning
transcript. Model output is run through `parseStructuredOutput()` /
`callWithStructuredRetry()` (`src/lib/ai/parse.ts`), which:

1. Extracts JSON even if the model wrapped it in prose or a markdown fence.
2. Validates it against the Zod schema.
3. On failure, retries once with the specific validation error fed back
   into the prompt.
4. Returns a typed `{ ok: true, data }` / `{ ok: false, error }` result —
   callers branch on this rather than throwing, because a malformed model
   response is an expected, handleable failure mode.

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
codebase allowed to import `@anthropic-ai/sdk`**. `src/lib/ai/providers/
mock.ts` implements the same interface with canned, deterministic
responses, used by tests so "unit tests have no network" (CLAUDE.md) stays
true once agents make real calls. `src/lib/ai/providers/registry.ts`
resolves a `ProviderKey` (`"anthropic" | "mock"` today) to a `ModelProvider`
instance, lazily — importing the registry or even constructing an
`AnthropicProvider` never requires `ANTHROPIC_API_KEY` to be set; only
actually calling `.complete()` does (verified: `npm run build` succeeds
with no API key set, including the Settings page that reads routing
config).

On top of that, `src/lib/orchestrator/modelClient.ts` exports the one
function agent code will call in Phase 2:

```ts
callModel(stepKey: PipelineStepKey, request: Omit<CompletionRequest, "model">): Promise<ModelCallResult>
```

`callModel` looks up `stepKey` (one of the 5 agent keys, or `"classifier"`
for the classification step) in `modelRouting.ts`, resolves its configured
provider via the registry, calls it, and returns the result plus latency
and estimated cost — computed the same way regardless of provider. **An
agent's code never knows or cares which provider handled its call.**
Adding a new provider (OpenAI, a local/open-weight model server) is:
implement `ModelProvider`, add one `case` in `registry.ts`, done — no
change to any agent, to `orchestrator.ts`, or to any schema. See
DECISIONS.md ("Model provider abstraction") for the full rationale.

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
3. Materializes the 10 curated scenarios from hand-authored fixtures in
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
row produces the same "Seeded 100 customers, 89 tickets..." summary).

## Testing strategy

- **Unit (Vitest, `tests/unit/`)**: schema validation
  (`schemas.test.ts`), structured-output parsing and retry behavior
  (`parse.test.ts`), RNG determinism (`rng.test.ts`), dynamic agent
  selection against all 10 curated scenarios (`selectAgents.test.ts`), the
  orchestrator's control-flow shape (`orchestrator.test.ts`), the provider
  abstraction's routing/cost/latency behavior via `MockProvider`
  (`modelClient.test.ts`), and the Anthropic provider's response-mapping
  and error handling with the SDK mocked (`anthropicProvider.test.ts`).
  Fast, no I/O, no database, **no network** — including for the provider
  layer, which is the point of `MockProvider`.
- **E2E (Playwright, `tests/e2e/`)**: runs against a production build
  (`npm run build && npm run start`) and the seeded database, asserting on
  specific seeded records by name (e.g. "Marcus Webb", "eval:
  multi-domain"). This is the deterministic regression layer described in
  CLAUDE.md — see DECISIONS.md for why Playwright specifically, and why
  native browser/computer-use tools are used for exploration instead.

## What's deliberately not built yet

See TODO.md for the full list. In one line: the orchestrator's control
flow, data model, schemas, and every product surface exist and are
tested; the actual model-backed reasoning inside each pipeline step (real
classification, real agent findings, real resolution aggregation, a live
"Run AI analysis" API route, and the evaluation scorer that runs the suite
against real orchestrator output) is Phase 2.
