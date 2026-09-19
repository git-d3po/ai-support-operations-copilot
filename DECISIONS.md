# Decision Log

Format per entry: Decision, Context, Options considered, Decision made,
Rationale, Tradeoffs, When we'd reconsider. Entries are added as decisions
are actually made — nothing here is retroactively invented to look tidy.

---

## 2026-09-18 — Why we use Claude Code to build this project

**Context:** This project's stated purpose includes demonstrating
"autonomous development workflows" as a skill, alongside product/AI/
engineering judgment. The tool used to build it is itself part of what's
being demonstrated.

**Options considered:** Manual development with an AI pair-programming
assistant used ad hoc; a different agentic coding tool; Claude Code with an
explicit self-audit/decision-log/testing workflow (this repo's
CLAUDE.md).

**Decision made:** Build with Claude Code, operating under the explicit
BUILD → TEST → AUDIT → PRIORITIZE → FIX loop defined in CLAUDE.md, with a
persistent decision log and TODO backlog.

**Rationale:** The interesting thing to demonstrate isn't "AI wrote code" —
it's a *repeatable, inspectable, self-correcting development process*:
documented architecture, a running decision record, and automated
verification (tests) gating what counts as "done." That process is the
same kind of judgment the product itself is meant to showcase (structured,
inspectable AI outputs; evaluation as a first-class concern), so building
it that way is coherent with what's being built.

**Tradeoffs:** Slower per-feature than writing code by hand for a very
small, well-understood task; the overhead (docs, decision log, tests) only
pays off because the project is meant to be explained and defended later,
not shipped as fast as possible.

**When we'd reconsider:** Not applicable to how the finished product runs —
this decision only affects the development process, not runtime
architecture.

---

## 2026-09-18 — Why native browser/computer-use for exploration, Playwright for regression

**Context:** CLAUDE.md requires "prefer automated verification over
assuming something works." Two different tools are available for browser
verification: Claude Code's built-in browser/computer-use pane, and
Playwright as a code-based test framework. The task brief specifically
asked for a Playwright MCP server as "the deterministic browser
testing/regression layer" — no such MCP server was available in this
session (confirmed via tool search), so the standalone `@playwright/test`
npm package was installed and used directly instead.

**Options considered:** (a) Use only the built-in browser pane for all
verification; (b) use only Playwright for everything, including one-off
exploratory checks; (c) split by purpose — Playwright for repeatable,
codified regression coverage; the built-in browser for one-off exploratory
and visual checks during development.

**Decision made:** (c). Playwright tests live in `tests/e2e/` and are
checked into the repo as the project's actual regression safety net — they
ran and passed against the production build during this phase (root
redirect, inbox contents, ticket detail, and every other top-level route).
The built-in browser pane was used for quick visual sanity checks (e.g.
confirming the inbox and ticket-detail pages actually render sensibly) but
nothing observed there is treated as "verified" unless it's also asserted
in a Playwright test.

**Rationale:** A visual check by a human or an agent looking at a
screenshot is valuable for judgment calls ("does this look reasonable") but
is not repeatable or diffable. A Playwright test is code: it runs the same
way every time, fails loudly on regression, and is itself part of the
codebase's documentation of expected behavior. Treating Playwright as
"just browser access" would waste its actual value, which is regression
coverage over time as the orchestrator and UI get built out in later
phases.

**Tradeoffs:** Playwright tests are slower to write than an exploratory
click-through, and the production-build requirement (`npm run build && npm
run start`) makes the e2e suite slower to run than hitting a dev server.

**When we'd reconsider:** If a real Playwright MCP server becomes available
in this environment, it should replace ad hoc `npx playwright test`
invocations for interactive debugging of a failing test, but the checked-in
`tests/e2e/` suite and its role as the regression layer don't change.

---

## 2026-09-18 — Why we built our own orchestrator instead of an agent framework

**Context:** Section 2 of the product spec requires an *explicit*
orchestrator with a fixed pipeline shape and dynamic, per-ticket agent
selection.

**Options considered:** (a) A general-purpose agent framework (e.g. a
graph/DAG-based multi-agent library) with agents as framework-managed
nodes; (b) a hand-rolled orchestrator as plain async functions.

**Decision made:** (b) — `src/lib/orchestrator/orchestrator.ts` is a plain
function calling `classifyTicket()` → `selectAgents()` → each selected
agent's `run()` → `resolveOutcome()`, with every intermediate value a typed,
inspectable object.

**Rationale:** A framework's value is managing complex control flow
(retries, parallelism, dynamic graphs) the framework author anticipated;
this pipeline's control flow is simple, fixed, and known up front. A
framework here would add a dependency, a learning curve for anyone
reviewing the code, and an abstraction layer between "what actually ran"
and "what the framework's internal state says ran" — directly working
against the product's own requirement that orchestration be inspectable
and explainable. Plain functions are also trivially unit-testable (see
`tests/unit/selectAgents.test.ts`, `orchestrator.test.ts`) without any
framework test harness.

**Tradeoffs:** If the pipeline later needs real parallelism (e.g. running
independent specialist agents concurrently rather than sequentially), or
much more complex branching, a framework's built-in support for that would
be reimplemented by hand. Current agent invocation is sequential
(`for` loop with `await`), which is simpler to reason about but not the
fastest possible wall-clock time once agents make real model calls.

**When we'd reconsider:** If agent count or pipeline branching complexity
grows enough that hand-rolled control flow becomes the bulk of the
maintenance burden, or if concurrent agent execution becomes a real
latency problem worth the added complexity.

---

## 2026-09-18 — Why structured agent outputs, never chain-of-thought

**Context:** The product must expose *why* it reached a decision without
exposing a raw reasoning transcript — both for UX (operators need a
scannable artifact, not an essay) and for safety/quality (freeform
reasoning text is not a stable, gradable, or citable contract).

**Options considered:** (a) Let agents return freeform text and parse/
summarize it downstream; (b) require every agent and orchestrator step to
return a schema-validated structured object from the start.

**Decision made:** (b) — `src/lib/ai/schemas.ts` defines closed Zod schemas
for every artifact; `src/lib/ai/parse.ts` validates all model output
against them with a retry-on-failure path.

**Rationale:** Structured output is what makes the product's other
requirements possible at all: a UI that shows "agents invoked, evidence,
confidence, policy references, decision" needs those exact fields to
exist and be typed; an evaluation suite needs a stable shape to score
against; "never expose chain-of-thought" is trivially satisfied when the
schema simply has no field for it.

**Tradeoffs:** Structured output is more brittle than freeform text — a
model can fail to conform to the schema, which is why `parseStructuredOutput`
includes a retry path rather than assuming success. Schemas also need to be
designed up front and evolve carefully (changing a field can invalidate
stored `OrchestrationRun` JSON).

**When we'd reconsider:** Not likely to reconsider the structured-output
requirement itself; would revisit specific schema shapes as real model
integration (Phase 2) surfaces fields that are missing or unused.

---

## 2026-09-18 — Why synthetic data, and why it's deterministic

**Context:** The product needs realistic-looking customers, billing
history, and tickets, without using real personal or company data, and the
evaluation suite needs the same tickets to exist with the same properties
every time it runs.

**Options considered:** (a) Hand-write a small fixed dataset; (b) use an
unseeded data-generation library for volume; (c) use a seeded generator
(faker + a custom seeded PRNG) so output is both realistic-looking and
byte-reproducible.

**Decision made:** (c). `prisma/seed.ts` combines `faker.seed(SEED)` for
realistic names/companies with a small hand-written deterministic PRNG
(`src/lib/synthetic/rng.ts`) for every business-logic random choice (plan
mix, status mix, invoice counts, ticket assignment). The 10 curated
evaluation tickets are hand-authored fixtures (`prisma/data/scenarios.ts`),
not randomly generated, because their entire purpose is having a
*correct, determinable* expected outcome.

**Rationale:** Determinism is required for the evaluation suite to mean
anything — if the underlying data changed between runs, "the AI got this
scenario right" wouldn't be a stable claim. It also makes the running app
itself reproducible across machines (a fresh clone + `npm run db:seed`
produces the identical demo state described in this repo's docs).

**Tradeoffs:** Deterministic generation is more code than "just call
faker with no seed" — the custom RNG module, weighted-choice helpers, and
scenario fixtures are all bespoke. Changing the seed or the generation
logic invalidates any previously-recorded evaluation results tied to
specific ticket IDs.

**When we'd reconsider:** If the project ever needed to simulate "new data
arriving over time" (e.g. a live-feeling demo where tickets appear on a
schedule) rather than a fixed reproducible snapshot.

---

## 2026-09-18 — Why evaluation is a first-class feature, not a demo-time afterthought

**Context:** It's easy to build a multi-agent demo that *looks* intelligent
without any way to check whether it actually is. The product spec requires
evaluation to be inspectable in the product itself.

**Options considered:** (a) Manual, ad hoc spot-checking of AI outputs
during development; (b) a dedicated Evaluations surface backed by curated
scenarios with machine-checkable expected outcomes and a scoring
framework.

**Decision made:** (b). Every curated ticket (`prisma/data/scenarios.ts`)
carries an `EvaluationExpectedOutcome` (expected intent, agents, policy,
escalation, and resolution action), stored in the `EvaluationCase` table
and validated by its own Zod schema (tested in `schemas.test.ts`). The
Evaluations page in the app reads this data directly — nothing about it is
a mockup.

**Rationale:** "The AI system is being measured, not merely demonstrated"
is a direct, explicit requirement. Baking expected outcomes into the seed
data (rather than writing them only in a separate eval script) means the
same tickets an operator sees in the Inbox are exactly what the evaluation
suite scores — there's no divergence between "the demo data" and "the eval
data."

**Tradeoffs:** Authoring good evaluation scenarios (grounded, plausible,
with an unambiguous correct answer) is materially more work than writing
ordinary sample tickets — most of the effort in `prisma/data/scenarios.ts`
went into making each scenario's expected outcome actually follow from its
billing/account fixtures, not just asserting an outcome by fiat.

**When we'd reconsider:** If the curated-scenario approach doesn't scale
(e.g. needing hundreds of graded cases), a generated/sampled evaluation set
with a rubric-based grader (rather than 10 hand-authored cases) might
become necessary — see EVALUATION.md, "Future extensions."

---

## 2026-09-18 — Why model routing is configurable but not the product's centerpiece

**Context:** The spec asks for per-agent configurable model routing with
usage/cost tracking, while explicitly warning not to make routing the
centerpiece.

**Options considered:** (a) Hardcode one model for everything; (b) build a
full routing/rules engine (e.g. dynamic model selection based on ticket
complexity, fallback chains, A/B testing); (c) a small static config
object mapping agent → model + pricing, easy to change, with no runtime
routing logic.

**Decision made:** (c) — `src/lib/orchestrator/modelRouting.ts`. (Later
extended to route *provider* as well as model per step — see "Model
provider abstraction," below — without changing this decision's substance:
it's still a small static config object, not a routing engine.)

**Rationale:** The product being demonstrated is support-operations
orchestration and evaluation, not an LLM-routing platform. A static,
obviously-correct config satisfies "the architecture is easy to change
later" without spending complexity budget on a feature that isn't the
point. Cost/latency/token tracking (the `AgentInvocation` columns) makes
the config's real-world effect visible in AI Operations without needing
any routing intelligence.

**Tradeoffs:** No automatic model fallback, no cost-based routing
decisions, no per-ticket override. Good enough for a portfolio
demonstration; would be a real gap in a production system handling
variable load or model outages.

**When we'd reconsider:** If a later phase wants to demonstrate
cost/latency tradeoffs explicitly (e.g. "what changes if the Risk Agent
runs on a cheaper model"), the config is already positioned for that
without a rewrite.

---

## 2026-09-18 — Why agents are dynamically selected rather than all invoked

**Context:** The most common failure mode of "multi-agent demos" is
running every agent on every input regardless of relevance, which is both
wasteful and undermines any claim of intelligent orchestration.

**Options considered:** (a) Always invoke all 5 agents and let each decide
internally whether it has anything to say; (b) a routing step
(`selectAgents()`) that decides which agents run at all, based on the
ticket's classification plus a small set of explicit safety-net business
rules.

**Decision made:** (b). `src/lib/orchestrator/selectAgents.ts` starts from
the classifier's `domains` and layers on explicit overrides (e.g. always
include Risk for `account_security` or angry/urgent sentiment; always
include Policy for `refund_request` and `cancellation`) — see the function
for the full rule set. Unit-tested against all 10 curated scenarios'
`expectedAgents`.

**Rationale:** "Dynamically determine which specialist agents are
relevant... do NOT simply invoke every agent for every ticket" is an
explicit, testable requirement. Making selection a pure, synchronous
function (rather than something itself decided by a model call) makes it
directly unit-testable and keeps routing accuracy measurable as its own
evaluation dimension, independent of classification accuracy.

**Tradeoffs:** The override rules are hand-authored business logic, not
learned — they need to be maintained explicitly as new intents or edge
cases are added, and a rule can be wrong. A pure classifier-driven
approach (agents = exactly `classification.domains`) would be simpler but
would rely entirely on classifier quality for cases (like a customer that
undersells their own security concern) where a rule-based safety net is
worth the extra code.

**When we'd reconsider:** If false-negative agent selection (missing a
relevant agent) shows up as a real evaluation failure mode once real
classification (Phase 2) is in place, the override rules would need
tuning rather than removal.

---

## 2026-09-18 — Why live/demo metrics are separated from evaluation metrics

**Context:** AI Operations (live ticket activity) and Evaluations (scored
curated scenarios) are both "numbers about how the AI is doing," and it
would be easy to blend them into one dashboard.

**Options considered:** (a) One unified metrics view; (b) two distinct
surfaces (AI Operations vs. Evaluations) that never mix a live-traffic
number with a curated-scenario score.

**Decision made:** (b), per the product spec's explicit requirement to
"clearly distinguish live/demo activity from synthetic evaluation
results."

**Rationale:** A live escalation rate computed over background/demo
traffic and a "escalation accuracy" score computed over 10 hand-graded
scenarios answer different questions (how much does it escalate vs. does
it escalate *correctly*) and conflating them would misrepresent both —
exactly the kind of "arbitrary metric" the project explicitly avoids.

**Tradeoffs:** Two surfaces instead of one means an operator has to look
in two places to get the full picture of system health; acceptable given
how different the two questions actually are.

**When we'd reconsider:** If a future summary/executive view is added, it
should visually label which numbers come from which source rather than
merging this decision away.

---

## 2026-09-18 — Stack: Next.js + TypeScript + Tailwind, single full-stack app

**Context:** Needed a stack that can credibly host a dense internal B2B
tool, do server-side data fetching against a database, and be understood
quickly by a reviewer (e.g. an interviewer skimming the repo).

**Options considered:** (a) Separate frontend (e.g. Vite/React SPA) +
backend (e.g. Express/Fastify API) as two services; (b) a single Next.js
App Router application doing both UI and data access.

**Decision made:** (b).

**Rationale:** The product doesn't need independent scaling or deployment
of frontend/backend, and a single app is dramatically simpler to run,
review, and reason about — one `npm run dev`, one repo, one deployment
target. Next.js Server Components let pages query Prisma directly, which
keeps the "every number on screen is a real query" principle (see
PRODUCT_SPEC.md) easy to verify by reading the page component.

**Tradeoffs:** Less architecturally "impressive" than a microservice
split, and couples UI and data-access deployment lifecycles. Irrelevant at
this project's scale.

**When we'd reconsider:** If the orchestrator's specialist-agent model
calls need to run somewhere with different scaling/timeout characteristics
than the UI (e.g. long-running agent jobs), API routes could be split out
without changing the overall single-repo structure.

---

## 2026-09-18 — Database: SQLite + Prisma 7, with an explicit driver adapter

**Context:** Needed a database that's zero-setup for anyone cloning the
repo (no external server), while still being a real relational database
with migrations, matching the "deterministic synthetic-data strategy"
requirement.

**Options considered:** (a) Postgres (via a hosted free tier or Docker);
(b) SQLite as a local file.

**Decision made:** (b) — `prisma/schema.prisma` targets `sqlite`, with
`@prisma/adapter-better-sqlite3` as the required Prisma 7 driver adapter
(Prisma 7 removed implicit env-based connections from the generated
client; every `PrismaClient` now needs an explicit adapter — see
`src/lib/db.ts`).

**Rationale:** SQLite means `git clone && npm install && npm run db:seed
&& npm run dev` is the entire setup — no Docker, no hosted database
credentials, no network dependency for local development or for someone
else evaluating the repo. It's a real relational database with real
migrations (`prisma/migrations/`), so the "clear architecture, strong
typing, migrations" engineering-quality bar is still met.

**Tradeoffs:** SQLite doesn't reflect a real production multi-tenant SaaS
database (no separate connection pooling, no built-in replication);
`better-sqlite3` is synchronous and native, which is fine for a
single-process app but wouldn't be the choice for genuine horizontal
scaling.

**When we'd reconsider:** If this were ever deployed somewhere with
multiple concurrent server instances writing to the same database (SQLite
file-level locking becomes a real constraint), or if the project wanted to
specifically demonstrate a production-grade Postgres setup.

---

## 2026-09-18 — Validation: Zod

**Context:** Needed runtime validation for AI structured outputs (schemas
can't rely on TypeScript's compile-time-only guarantees against
model-produced JSON) and for evaluation expected-outcome data.

**Options considered:** Zod; alternatives like Yup, io-ts, or hand-written
validators.

**Decision made:** Zod 4.

**Rationale:** Widely used, good TypeScript inference (`z.infer<>`
generates the TS type directly from the schema, so there's exactly one
definition per artifact, not a type and a separate validator that can
drift), and its `safeParse` API fits the "return typed results, don't
throw" pattern used throughout `src/lib/ai/parse.ts`.

**Tradeoffs:** None significant at this scale; Zod is a mature, common
choice for this exact problem.

**When we'd reconsider:** No planned reconsideration.

---

## 2026-09-18 — AI provider: Anthropic SDK

> **Superseded in part** by "Model provider abstraction" (below, same day,
> pre-Phase-2 architecture review). The "called directly, no abstraction
> layer" decision made here turned out to be wrong before any agent code
> was actually written against it — see that entry for why it changed and
> what replaced it. The choice of Anthropic as the first/default provider
> stands; the "no abstraction layer" part does not. Left here, corrected
> rather than deleted, so the log reflects what was actually decided and
> when.

**Context:** Needed an LLM provider for the (currently stubbed) agent
reasoning.

**Options considered:** Anthropic (`@anthropic-ai/sdk`); OpenAI; a
provider-agnostic abstraction layer.

**Decision made:** Anthropic, called directly (no abstraction layer) —
`@anthropic-ai/sdk` is installed and `modelRouting.ts` references Claude
model ids (`claude-haiku-4-5-20251001`, `claude-sonnet-5`).

**Rationale:** This project is built with and evaluated through Claude
Code; using the same provider for the product's own AI features keeps the
project coherent and avoids maintaining a multi-provider abstraction for a
single-provider need. Model routing (see above) is still per-agent
configurable within the one provider.

**Tradeoffs:** No multi-provider fallback; switching providers later would
touch every agent's model-call implementation directly rather than a
provider-abstraction layer. Acceptable given the project's actual scope.

**When we'd reconsider:** ~~If the project wanted to specifically
demonstrate provider-agnostic architecture, or needed a fallback provider
for reliability.~~ Reconsidered same day, before Phase 2 began — see below.

---

## 2026-09-18 — Model provider abstraction

**Context:** A pre-Phase-2 architecture review, requested specifically to
happen *before* any real model-powered agent was built. The concern: the
previous entry's "call Anthropic directly, no abstraction layer" decision
would, the moment Phase 2 wrote real agent code, scatter
`new Anthropic(...)` calls across 5 agent files and the classifier. At that
point, evaluating a different model or provider — the explicit point of
EVALUATION.md — would mean touching agent logic to swap it out, and every
future model comparison would be confounded by whatever else changed in
the process of doing that swap.

**Options considered:**
1. Keep calling `@anthropic-ai/sdk` directly from each agent (the original
   decision) — simplest, but couples every agent to one provider's request/
   response shape.
2. A full agent framework or LLM-routing library with built-in
   multi-provider support — solves the problem but is exactly the
   "unnecessary infrastructure" this project explicitly avoids, and would
   dictate agent structure around the framework's abstractions rather than
   this product's own orchestration model.
3. A small, hand-written `ModelProvider` interface (`complete(request):
   Promise<result>`) that any provider implements, resolved through a
   tiny registry, with a single `callModel(stepKey, request)` entry point
   for agent code — no framework, no dependency beyond what's already
   installed.

**Decision made:** (3). Added `src/lib/ai/providers/` (`types.ts` — the
`ModelProvider` interface and request/result shapes; `anthropic.ts` — the
Anthropic implementation, and the *only* file permitted to import
`@anthropic-ai/sdk`; `mock.ts` — a deterministic implementation for tests;
`registry.ts` — `ProviderKey` + `getProvider()`/`registerProvider()`) and
`src/lib/orchestrator/modelClient.ts` (`callModel(stepKey, request)`, the
one function Phase 2 agents will call). `ModelRoutingConfig` now carries a
`provider` field alongside `model` per pipeline step (`modelRouting.ts`),
and covers a 6th step, `"classifier"`, that isn't a specialist agent but
still needs its own routed model — a gap the previous config didn't have a
slot for at all.

**Rationale:** This makes the constraint the task asked for — "the
agents/orchestrator can eventually use Anthropic, other hosted providers,
or a local/open-weight model, without requiring changes to agent logic or
orchestration flow" — a property that's actually verified, not just
asserted: `tests/unit/modelClient.test.ts` calls `callModel()` against a
`MockProvider` through the exact same code path a real agent will use, and
`tests/unit/anthropicProvider.test.ts` verifies the Anthropic adapter's
response-mapping with the SDK mocked, so **no unit test makes a network
call**, including for the provider layer itself. Doing this now, before
Phase 2 writes a single real agent, cost nothing in rework — there was no
existing agent code to migrate.

**Tradeoffs:** One more layer of indirection than "just call the SDK" —
an agent's model call is now `callModel("billing", {...})` resolving
through routing config and a registry, rather than a single direct call.
`ModelProvider`'s `complete()` shape (system + user/assistant messages +
max tokens, returning text + token counts) is deliberately the lowest
common denominator across providers; a provider-specific feature (e.g.
prompt caching, tool use) would need either a widened interface or an
escape hatch on `CompletionRequest` — not designed yet, because no agent
needs it yet. `PROVIDER_KEYS` currently only has `"anthropic"` and
`"mock"` — adding OpenAI or a local model server means implementing
`ModelProvider` and adding one case to `registry.ts`'s `createProvider()`,
which is the abstraction working as intended, not a gap.

**When we'd reconsider:** If `complete()`'s minimal shape can't express
something a real agent genuinely needs (structured tool-calling, streaming,
prompt caching) — widen the interface then, driven by an actual
requirement, not speculatively now.

---

## 2026-09-18 — Deferring a UI component library (e.g. shadcn/ui) to the UI-implementation phase

**Context:** The product spec asks for a "credible modern B2B SaaS"
visual design eventually, but explicitly says not to spend foundation-phase
time on UI polish.

**Options considered:** (a) Install and configure a component library
(e.g. shadcn/ui) now, ahead of any real design pass; (b) ship the
foundation phase with plain Tailwind utility classes and defer component
library selection to the dedicated UI phase.

**Decision made:** (b).

**Rationale:** Adopting a component library well requires a design
direction to configure it against (theme, density, tone) — doing that now
would mean redoing the configuration once real design work starts anyway.
Tailwind alone is enough to build functional, testable pages for this
phase.

**Tradeoffs:** Current pages are visually minimal (see AUDIT.md, P2
findings) — expected and tracked, not a hidden gap.

**When we'd reconsider:** At the start of the dedicated UI-implementation
phase (see TODO.md).
