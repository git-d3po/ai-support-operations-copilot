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

---

## 2026-09-18 — Response agent runs after resolution, not as a uniform pipeline step

**Context:** Implementing Phase 2's real agents surfaced a genuine
sequencing requirement the foundation-phase skeleton didn't have yet: the
product spec says the Response agent's draft "should be grounded in the
resolution produced by the orchestration pipeline" and must not
independently invent a policy or resolution decision. The foundation-phase
orchestrator ran every selected agent — including Response — in one
uniform loop *before* `resolveOutcome()` even existed, because Response
was a stub with nothing to ground itself in yet.

**Options considered:** (a) Keep Response in the uniform per-agent loop
and have it re-derive an approximation of the resolution from the other
agents' findings itself; (b) split the pipeline so investigative agents
(billing/policy/technical/risk) run first, `resolveOutcome()` computes a
real decision, and only then does Response run, with that decision already
in its context.

**Decision made:** (b). `orchestrator.ts` filters `selectAgents()`'s
output into investigative keys vs. Response, runs the investigative agents
first accumulating `priorFindings`, calls `resolveOutcome()`, and only then
invokes Response with `resolution`/`escalation` populated on its
`AgentContext`. `selectAgents()` itself did not change — it still decides
*whether* Response runs, just not *when* relative to resolution.

**Rationale:** Option (a) would have made "the response should be grounded
in the resolution" true only by accident (two independent computations
that happen to usually agree), not by construction — and would have
doubled the aggregation logic. Option (b) makes the guarantee structural:
Response literally cannot draft a reply without the actual resolution
object in hand, and `orchestrator.test.ts` has a dedicated test that fails
if Response's prompt doesn't already contain `action=refund_customer`
before it responds.

**Tradeoffs:** `AgentContext` now has two fields (`resolution`,
`escalation`) that are `undefined` for four of the five agents and only
populated for Response — a small, honestly-documented asymmetry in an
otherwise-uniform interface, rather than a second, parallel context type
for one agent.

**When we'd reconsider:** If a future agent also needs "the resolution so
far" before it runs (unlikely given the current five-agent roster), this
pattern generalizes directly — no rework needed.

---

## 2026-09-18 — Policy and Risk agents extend AgentFinding with their own structured decision

**Context:** The product spec's `PolicyDecisionSchema` (applicable policy,
decision, justification, conditions) and the Risk agent's escalation
recommendation are each a genuinely distinct structured artifact beyond
the generic `AgentFinding` envelope (summary/evidence/confidence/flags)
every agent shares — but `resolveOutcome()` needs to read them in a
type-safe way, and the UI needs to render them.

**Options considered:** (a) Encode the decision as strings inside
`AgentFinding.flags` (e.g. `"policy_decision:approve"`); (b) a separate,
disconnected schema/table just for policy decisions, joined by
orchestration-run id; (c) `PolicyAgentFindingSchema` /
`RiskAgentFindingSchema` as Zod `.extend()`s of `AgentFindingSchema`,
stored in the same `AgentInvocation.finding` JSON column every agent uses.

**Decision made:** (c).

**Rationale:** (a) is stringly-typed and exactly the kind of "structured
data smuggled through an unstructured field" this project's whole
structured-output principle exists to avoid. (b) adds a table and a join
for two extra fields, with no benefit — the finding already lives in
`AgentInvocation.finding`, and Policy/Risk's extra fields are additional
facts about that same finding, not a separate entity. (c) required zero
schema/database changes (the JSON column already stores "whatever's
valid"), keeps every agent's raw output going through the identical
`runStructuredStep()` → validate → persist path, and lets the UI render
every agent uniformly while still reading the extra fields when present
(`isPolicyFinding()`/`isRiskFinding()` type guards in `schemas.ts`).

**Tradeoffs:** `AgentFinding.agentKey` is typed as the full `AgentKey`
enum (not literal-narrowed per variant), so a plain `finding.agentKey ===
"policy"` check does not narrow the `AnyAgentFinding` union for
TypeScript — anyone touching this code needs to use the exported type
guards instead of the "obvious" check. Documented in ARCHITECTURE.md
specifically so this doesn't get rediscovered as a confusing compiler
error later.

**When we'd reconsider:** If a third agent needs its own extended shape,
the same `.extend()` pattern applies directly — no reason to reconsider
this approach at that point, just repeat it.

---

## 2026-09-18 — Deterministic evidence pre-computation for mechanically-checkable facts

**Context:** Several policy decisions hinge on exact facts — is a charge
within a 14-day window, are two transactions within 48 hours of each
other, same amount, same invoice. Models are a well-known weak point for
precise arithmetic and date math; getting "day 13 vs. day 15" wrong would
directly flip a refund decision.

**Options considered:** (a) Give the model the raw transaction/invoice
records and ask it to compute date differences and duplicate-matching
itself; (b) compute these specific, exactly-defined facts in TypeScript
and hand the model the *result* (e.g. "days since most recent charge: 5",
"confirmed duplicate: yes, 2 pairs") alongside the raw records as
supporting evidence.

**Decision made:** (b) — `src/lib/orchestrator/evidence.ts`:
`detectDuplicateCharges()`, `daysSince()`, `mostRecentSucceededCharge()`,
etc. Billing, Policy, and Risk agents' prompts include both the raw
records (for context/citation) and these pre-computed facts (for the
specific quantitative claims their decision depends on).

**Rationale:** This directly serves "the data supports the decision" (the
product's own quality bar, not just a nice-to-have): the exact,
mechanically-checkable part of the reasoning is guaranteed correct by
code, and the model's job narrows to the genuinely judgment-based part
(does this refund story hold up, does this pattern look like fraud) —
which is what a model is actually good at and what the product is meant
to demonstrate. It also makes these specific facts unit-testable in
isolation (`evidence.test.ts`) independent of any model behavior.

**Tradeoffs:** More upfront code than "just give the model everything and
ask" — a deliberate area was carved out and hand-written rather than
delegated. If policy conditions get more numerous or complex, more
pre-computation functions will need to be added by hand rather than
"letting the model figure it out."

**When we'd reconsider:** If a policy condition is genuinely fuzzy (not a
sharp threshold), pre-computation isn't the right tool — that's exactly
the kind of judgment call left to the model already.

---

## 2026-09-18 — `resolveOutcome()` stays a deterministic function, not a model call

**Context:** With Policy and Risk agents now producing real structured
decisions, it would be possible to have a sixth "resolution" model call
that reads all the findings and decides the final action — mirroring how
classification and each agent are model calls.

**Options considered:** (a) A model call that synthesizes all findings
into a final resolution; (b) a deterministic, rule-based function reading
the already-structured findings (`policyDecision.decision`, Risk's
`escalationRecommended`, Technical's flags) and applying an explicit
priority order.

**Decision made:** (b) — `src/lib/orchestrator/resolve.ts`, a pure
function with 12 explicit, ordered rules (see its own comments and
`resolve.test.ts`'s 15 tests, one per branch).

**Rationale:** By the time `resolveOutcome()` runs, every genuinely
judgment-based question has already been answered by a specialist agent
in structured form — "does this ticket warrant escalation" (Risk), "is
this refund approved" (Policy), "is there a known-issue workaround"
(Technical). Combining already-structured decisions into a final action is
a priority/routing problem, not a reasoning problem, and a rule-based
function is deterministic, instantly explainable ("why did it escalate? —
rule 2, Risk recommended it"), and directly unit-testable across every
branch — properties a seventh model call would trade away for no
corresponding benefit. This mirrors the exact argument already made for
`selectAgents()` staying deterministic (see "Why agents are dynamically
selected," above).

**Tradeoffs:** The rule order and specific flag vocabulary
(`KNOWN_AGENT_FLAGS` in `schemas.ts`) is hand-authored business logic that
has to be kept in sync with what each agent's prompt actually asks it to
produce — a new agent flag that `resolveOutcome()` doesn't have a rule for
silently falls through to the generic confidence-based default rather than
being wrong loudly.

**When we'd reconsider:** If resolution logic needs true natural-language
judgment beyond combining pre-existing structured decisions (hard to
picture given the current five-agent design, but not impossible for a
future domain).

---

## 2026-09-18 — E2E coverage for the AI analysis flow uses a fixture model provider

**Context:** `runAnalysis.spec.ts` needs to exercise the real "Run AI
analysis" journey end to end. There is no `ANTHROPIC_API_KEY` configured
in this environment, and — separately — the user has an explicit standing
instruction that no automated test may ever use a real model credential.
Even setting that aside, a live call would make the suite non-deterministic
and billed per run, contradicting CLAUDE.md's own definition of the e2e
suite as "the deterministic regression layer."

**Options considered:** (a) Skip e2e coverage of the analysis flow
entirely and only test the graceful-error path (which needs no live call);
(b) register a `MockProvider` from a Next.js `instrumentation.ts`
server-startup hook, gated on an env var only `playwright.config.ts` sets;
(c) same idea, but the env-var check lives inside
`registry.ts`'s `createProvider()` itself rather than an external hook.

**Decision made:** (c), after (b) was tried first and demonstrably failed.

**What happened with (b):** `instrumentation.ts`'s `register()` really was
called at server startup (confirmed via logging) and really did call
`registerProvider("anthropic", mockInstance)` — but the Server Action that
later called `getProvider("anthropic")` still hit the real
`AnthropicProvider` and threw the missing-API-key error. Next.js's
per-route bundling gives the instrumentation hook and a Server Action
separate bundled copies of `registry.ts`, each with its own module-level
`instances` Map — a registration made in one bundle's copy doesn't reach
another bundle's copy, even though both are "the same file" in source.
This was diagnosed by adding temporary logging and manually driving the
built app in the browser pane before concluding the mechanism was
unreliable, not the config.

**Rationale for (c):** `process.env` is process-wide, not bundle-scoped —
reading `USE_MOCK_MODEL_PROVIDER` inside `createProvider()` itself gives
the same answer no matter which bundle's copy of the module actually runs,
because the decision is made locally at the moment a provider is actually
requested, not communicated across an external registration step. This
keeps the override auditable in one place (`registry.ts`), narrow (checked
only for the `"anthropic"` key), and inert everywhere except when
Playwright's `webServer.env` sets the flag.

**Tradeoffs:** `registry.ts` (otherwise pure production code with no
awareness of tests) now has one explicit, narrow, clearly-commented
test-fixture branch. This is a deliberate, documented exception, not
scope creep — precedented by how many real systems gate a "test mode" at
the exact point a live integration would otherwise fire.

**When we'd reconsider:** If Next.js's instrumentation hook is later
documented to share module state reliably with Server Actions (or if the
app moves to a standalone Node backend where this bundling concern doesn't
apply), the check could move back out of `registry.ts` — not urgent, since
the current approach works and is well-contained.

---

## 2026-09-18 — The evaluation runner refuses to run without a real, user-provided API key

**Context:** EVALUATION.md and the product spec both require that
evaluation "measures actual behavior" and never displays an invented
result. Separately, the user gave an explicit standing instruction: no
real API key is ever used without being asked first, in this project.

**Options considered:** (a) Let `npm run eval` run against whatever
provider `registry.ts` resolves, including silently falling back to a
mock if no key is present; (b) have the runner itself refuse to start at
all when `ANTHROPIC_API_KEY` is unset, with a clear message, rather than
falling back to anything.

**Decision made:** (b) — `scripts/runEvaluation.ts` checks for
`ANTHROPIC_API_KEY` before calling `runEvaluationSuite()` at all and exits
with an explanatory error if it's missing. `runEvaluationSuite()` itself
calls the real orchestrator (`analyzeTicket()`) with no provider override
— it was never given a code path to run against `MockProvider` in the
first place.

**Rationale:** Option (a)'s "fall back to a mock" would have silently
produced ten "passing" evaluation results that only reflect a hand-written
test fixture, not the product's actual AI behavior — precisely the
"invented performance metric" the project is built to avoid, and exactly
what the user's standing instruction is meant to prevent. Refusing loudly
is safer than succeeding quietly with the wrong thing. Because no key is
configured in this project's development environment, the suite has not
been run for real; the Evaluations page still honestly shows "not run"
rather than any score.

**Tradeoffs:** None really — this is a pure safety gate with no
functional downside once a real key is actually provided.

**When we'd reconsider:** Never, for the credential-safety part. If the
project later wants a distinct "dry run against mock, for pipeline-wiring
verification only" mode, that would need to be a clearly-labeled separate
command that never writes to the same `EvaluationResult` table real scores
live in — not a change to this command's behavior.

---

## 2026-09-18 — Classification is tracked as a pipeline step, not folded into an existing agent

**Context:** Classification makes a real model call and has real
cost/latency/tokens worth tracking in AI Operations, but it isn't one of
the 5 specialist agents in `AGENT_KEYS` — it runs before agent selection
even happens.

**Options considered:** (a) Don't persist classification's own metrics at
all — only track the 5 agents; (b) attribute classification's cost to
whichever agent happened to run first; (c) treat `"classifier"` as its own
`PipelineStepKey`, with its own `modelRouting.ts` entry and its own
`AgentInvocation` row (reusing that table rather than adding a new one).

**Decision made:** (c).

**Rationale:** Classification is a real, billable model call — omitting it
(a) would understate AI Operations' cost/latency numbers, and attributing
it to another agent (b) would misattribute cost to work that agent didn't
do. `AgentInvocation.agentKey` is a plain string column already (not a DB
enum), so storing `"classifier"` there required zero schema changes — this
is the "smallest necessary change" the task explicitly allowed for when a
concrete requirement (accurate cost tracking) made the existing shape
insufficient.

**Tradeoffs:** `AgentInvocation` now holds rows for something that isn't
technically an "agent" by the product's own vocabulary — mitigated by
clear labeling in the UI ("Classification" vs. e.g. "Billing Agent") and
in code comments (`PipelineStepKey = AgentKey | "classifier"`).

**When we'd reconsider:** If more non-agent pipeline steps that call
models are added later, the same `PipelineStepKey` pattern extends
directly.

---

## 2026-09-18 — Enforcing, not just prompting for, grounded policy citations

**Context:** A deep implementation audit (see AUDIT.md, Audit #3) asked
specifically whether policy citations are *actually* grounded in the
synthetic policy data or merely model-invented references. Reading the
code (not just the prompts) showed the answer was "prompted for, but not
verified": `PolicyReferenceSchema` validates that a citation is shaped
like `{slug: string, title: string}`, but nothing checked that the slug
was real or was among the policies actually retrieved and shown to the
model for that specific call. A model could, in principle, cite a
plausible-sounding but fabricated or previously-seen-elsewhere slug, and
it would flow through validation, into `resolveOutcome()` (for the Policy
Agent's `policyDecision`, which drives real `refund_customer`/
`deny_request` actions), into the UI, and into evaluation scoring — all
looking exactly as "grounded" as a real citation.

**Options considered:** (a) Trust the prompt instructions alone (already
strongly worded: "Ground your decision ONLY in the policy text provided,"
"do not force-fit an unrelated policy") and rely on evaluation to catch
drift over time; (b) add a code-level check, after parsing, that any cited
slug is a member of the specific policy list retrieved for that call — not
just any real `Policy` row, but the ones this call actually saw.

**Decision made:** (b). `src/lib/orchestrator/evidence.ts` adds
`filterGroundedPolicyReferences()` and `isPolicyGrounded()`. Every agent
that can emit a policy citation now enforces this after parsing:
- **Policy Agent** (`policyAgent.ts`): if `policyDecision.applicablePolicy
  .slug` isn't grounded, the decision is discarded entirely (`policyDecision:
  null`, confidence reset to 0, a new `ungrounded_policy_citation` flag
  added) — `resolveOutcome()` already treats a null decision as "needs
  human review," so this fails safe automatically, with no resolve.ts
  changes needed. Its `policyReferences` array is filtered the same way.
- **Risk Agent** (`riskAgent.ts`): its citations are filtered the same way,
  but since its core decision (`escalationRecommended`/`targetTeam`) isn't
  citation-dependent, an ungrounded reference is just stripped rather than
  invalidating the whole finding. Its prompt was also fixed — it previously
  showed a JSON template with `"policyReferences":[]` hardcoded, which
  actively discouraged citing the security/escalation policy it's supposed
  to be grounded in; the prompt now explicitly asks it to cite the policy
  that informed its decision.
- **Billing and Technical Agents**: never shown any policy documents in
  the first place, so any citation they emit is filtered against an empty
  set — i.e., always stripped. This formalizes what their prompts already
  implied ("policyReferences": always `[]`) as an enforced guarantee
  instead of a hoped-for convention.

**Rationale:** This is the general principle CLAUDE.md already states
("never allow malformed model output to silently enter the system")
applied to a case the schema alone can't catch, because a fabricated
citation isn't malformed JSON — it's valid-shaped, wrong content. A
mechanical, O(1) membership check is cheap, requires no product-direction
judgment, and closes a real gap between what the product claims ("policy
citations are grounded in synthetic policy data") and what the code
previously guaranteed (nothing, beyond a strongly-worded prompt).

**Tradeoffs:** None material — this only removes citations that were
never legitimate, and its failure mode (treat as "no decision," escalate
for review) is the same conservative failure mode already used for parse
failures.

**When we'd reconsider:** If agents ever need to cite something outside
their own retrieved set on purpose (not anticipated), this check would
need an explicit opt-out rather than being loosened generally.

---

## 2026-09-18 — Evaluation scorer must accept policy grounding cited by any agent, not only the Policy Agent

**Context:** The same audit checked whether the evaluation scorer's
criteria actually correspond to the pipeline's real outputs. The
`suspicious-activity` curated scenario expects `expectedPolicySlug:
"account-security-policy"` but does **not** expect the Policy Agent to run
at all (`expectedAgents: ["risk", "response"]`) — by design, a suspected
compromise is supposed to be grounded in that policy via the *Risk*
agent's citation, escalating directly, without a separate Policy Agent
decision. `scoreOutcome()`'s `policyCorrect` dimension, however, only ever
read the Policy Agent's own `policyDecision.applicablePolicy.slug`. For
this scenario, that's always `null` (no Policy Agent finding exists to
read), so `policyCorrect` would score `false` even when the pipeline
behaves exactly as intended — and because `policyCorrect` carries weight
1.5 in `overallScore`, this alone could push a genuinely correct run for
this scenario below `PASS_THRESHOLD` (0.85), misreporting a correct
behavior as a failure.

**Options considered:** (a) Change the scenario's `expectedPolicySlug` to
`null` for this case, since Policy Agent doesn't run — but that would stop
checking a real, meaningful property (is the escalation actually grounded
in the right policy) that the scenario is specifically designed to test;
(b) make `scoreOutcome()` check the Policy Agent's decision first, and if
that doesn't match, fall back to checking whether *any* agent's
(grounding-enforced) `policyReferences` cites the expected slug.

**Decision made:** (b) — `src/lib/evaluation/score.ts`.

**Rationale:** Option (a) would be papering over the scorer's limitation
by weakening what's tested, exactly backwards from what an evaluation
suite is for. Option (b) matches how the product itself is designed:
policy grounding can legitimately come from more than one agent (Policy's
formal decision, or Risk's citation of the policy that drove an
escalation), and the scorer should recognize either, since the fallback
only ever checks *actual* `policyReferences` — which are themselves
grounding-enforced (see the decision above) — never a claim made without
a real citation somewhere in the outcome.

**Tradeoffs:** None material. This makes `policyCorrect` slightly more
permissive (any agent's citation counts, not just Policy's), which is
correct given the product's own multi-agent design, not a loosening of
rigor.

**When we'd reconsider:** If a future scenario needs to specifically
verify that the *Policy Agent itself* (not any other agent) grounds a
decision, that would need a separate, more specific expected-outcome
field — not a reason to revert this fallback for the general case.

---

## 2026-09-18 — Honestly recording which provider actually served a call

**Context:** Preparing to validate the evaluation pipeline end-to-end
against the deterministic fixture provider (see the next entry) surfaced a
real gap: `AgentInvocation.model` and `AgentRunMetrics.model` always
recorded the model `modelRouting.ts` *routed* a call to (e.g.
`"claude-sonnet-5"`), never whether that call was actually answered by the
real `AnthropicProvider` or by a mock. A run entirely served by a fixture
would have persisted and rendered **identically** to a real model run —
directly contradicting the requirement that fixture/simulated results
never be displayed as if they measure real model performance.

**Options considered:** (a) Leave it as-is and rely on callers to
remember which runs were simulated (e.g. by tracking ticket IDs
out-of-band); (b) record, per model call, which `ModelProvider.key`
actually served it — independent of what was configured — and roll that
up to `OrchestrationRun`/`EvaluationResult` as an `isSimulated` flag.

**Decision made:** (b). `ModelCallResult` (modelClient.ts) now includes
`provider: provider.key` (the *actual* server), separate from `model`
(the *intended* target). This flows through `AgentRunMetrics` and
`ClassifyResult.metrics` into `AgentInvocation.provider` (schema
migration `add_provider_provenance_tracking`), and
`persistOrchestrationRun()` computes `OrchestrationRun.isSimulated =
true` whenever any invocation's actual provider is `"mock"`.
`runEvaluationSuite()` copies this onto `EvaluationResult.isSimulated`.
The UI (Ticket Detail, Evaluations, AI Operations) reads this flag
directly rather than inferring it — a purple "simulated" badge/banner
wherever a simulated result could otherwise be mistaken for a real one,
and AI Operations excludes simulated runs from its aggregates entirely
rather than silently inflating "real" activity numbers.

**Rationale:** Option (a) is exactly the kind of implicit convention that
breaks the first time someone forgets it, and it can't be enforced or
tested. Option (b) makes the guarantee structural and independently
verifiable — `tests/integration/persist.test.ts` proves a run with any
mock-served invocation is tagged simulated, and a run with only
real-provider invocations is not. This is the same "enforce, don't just
document" principle already applied to policy-citation grounding (see
above).

**Tradeoffs:** One more column on two tables, and `AgentRunMetrics`
becomes a required (not optional) field everywhere a metrics object is
constructed — a handful of test fixtures needed updating to add it
explicitly, which is the point: it can no longer be silently omitted.

**When we'd reconsider:** If a real second provider (e.g. OpenAI) is
added, `isSimulated` should stay defined as "provider is specifically the
mock/fixture key," not "provider differs from the default" — a real
alternate provider must never be miscategorized as simulated.

---

## 2026-09-18 — Evaluation dry-run fixture: validating the harness, not the model

**Context:** Asked explicitly to run the evaluation suite end-to-end
against a deterministic fixture provider, without a real
`ANTHROPIC_API_KEY`, to verify the evaluation *machinery* (orchestrator →
persistence → scorer → UI) is wired correctly across all 10 curated
scenarios — as distinct from `runAnalysis.spec.ts`'s e2e fixture, which
only covers one ticket for a UI-journey test, and distinct from a real
evaluation run, which `scripts/runEvaluation.ts` refuses to do without a
real key.

**Options considered:** (a) Skip this and only trust unit tests
(`score.test.ts`, `resolve.test.ts`) that exercise the scorer in
isolation; (b) extend `e2eMockProvider.ts` to cover all 10 scenarios,
overloading its stated purpose; (c) a new, separate script
(`scripts/runEvaluationDryRun.ts`) and fixture set
(`scripts/evaluationDryRunFixtures.ts`) purpose-built for this, calling
`runEvaluationSuite()` — the exact same function a real evaluation run
uses — with a comprehensive fixture registered under `"anthropic"`.

**Decision made:** (c). The fixture set answers 9 of the 10 scenarios
"correctly" (matching their `expectedOutcome`) and **one scenario
(`known-technical-issue`) deliberately wrong on purpose** — a
misclassification that leads to an incorrect resolution — specifically to
prove the scorer detects and reports a real failure through the actual
runner and persistence layer, not just inside an isolated unit test.
Every result this produces is tagged `isSimulated: true` (see the
decision above) and rendered with a purple "simulated" badge everywhere
in the UI; `scripts/runEvaluationDryRun.ts` also prints "NOT a live
model" banners in its own output.

**Rationale:** Option (a) doesn't prove the *wiring* is correct — unit
tests call `scoreOutcome()` directly with hand-built inputs, never
touching `analyzeTicket()`, persistence, or the real `selectAgents()`
routing a real classification produces. Option (b) would have muddied
`e2eMockProvider.ts`'s single stated purpose (one ticket, for Playwright).
Option (c) is a small, additive, clearly-separate tool that reuses
`runEvaluationSuite()` verbatim — if this dry run passes, the same code
path is proven correct for when a real key is provided; nothing about
`runEvaluationSuite()` itself needed to change to support this.

**Actual result of running it** (see EVALUATION.md): 9/10 scenarios
passed with a perfect 1.00 score, including `suspicious-activity` — which
specifically exercises the policy-grounding-via-Risk-agent fallback fixed
earlier in this same audit cycle (see "Evaluation scorer must accept
policy grounding cited by any agent," above) — proving that fix works
through the real pipeline, not only in its own unit test. The one
deliberately-wrong scenario scored 0.43 and failed, exactly as designed,
proving the scorer's failure-detection path also works end-to-end.

**Tradeoffs:** The fixture content (~10 scenarios × several agents) is
nontrivial hand-authored data that must be kept loosely in sync with
`prisma/data/scenarios.ts` if that file's tickets change — mitigated by
importing `SCENARIOS` directly for subject-matching rather than
duplicating ticket text, and by the dry-run script throwing a clear error
(rather than guessing) if it's ever asked for a scenario/task pairing it
doesn't have a fixture for.

**When we'd reconsider:** This tool's purpose is permanently narrow
(harness validation); it should never be pointed at real evaluation
scoring or presented as measuring model quality. If that boundary starts
to blur in practice, the fix is clearer labeling, not removing the tool.

---

## 2026-09-19 — Explicit output-token budget (`DEFAULT_MAX_OUTPUT_TOKENS = 2048`)

**Context:** The baseline audit before the first live run found that no
pipeline step sets `maxTokens`, so `anthropic.ts` silently fell back to a
hardcoded `1024` for every call. Every step must return one complete JSON
object; a response cut off by the token limit is invalid JSON, which
`callWithStructuredRetry` retries (same limit, same truncation) and then
degrades into an honest fallback — a live run would look like "the model
failed" when the real cause was our ceiling.

**Options considered:** (a) keep 1024; (b) per-agent budgets in
`modelRouting.ts`; (c) one explicit constant for all steps.

**Decision made:** (c) — `DEFAULT_MAX_OUTPUT_TOKENS = 2048` in
`src/lib/ai/providers/types.ts`, used by `anthropic.ts` when a request
doesn't set `maxTokens` (a caller still can). Unit-tested in
`anthropicProvider.test.ts`.

**Rationale:** Sized from `schemas.ts`'s field caps, not guessed. The
largest artifacts are the Policy finding (400-char summary, up to 8 evidence
items, up to 5 citations, a 400-char justification, uncapped
conditionsMet/Unmet lists) and the Response (body up to 3000 chars plus
next steps) — roughly 1,000 tokens worst case, i.e. right at the old limit.
2048 is ~2x that: comfortable headroom, while a response that still hits it
signals a genuinely runaway output rather than normal variation. It is a
ceiling, not a spend — only generated tokens are billed, so the pre-flight
cost estimate in EVALUATION.md is unaffected. Per-agent budgets (b) would
add config for a difference no step needs.

**Tradeoffs:** A single value is slightly generous for the classifier and
Billing (small outputs). Truncation is still only detected indirectly (as a
parse failure); surfacing the SDK's `stop_reason` is a possible later
improvement, not needed for the first smoke test.

**When we'd reconsider:** If the smoke test/eval shows real outputs
approaching the limit, or a schema's caps are raised.

---

## 2026-09-19 — Live evaluation runs against a separate database (`eval.db`)

**Context:** `playwright.config.ts` runs `npm run db:seed` — a full reset —
against `dev.db` before every e2e server boot, and integration tests use
`dev.db` too. A live evaluation stored there would be destroyed by the next
`npm run test:e2e` (the audit observed exactly this: the earlier dry-run
results were already gone).

**Options considered:** (a) leave it and tell people to export results
first; (b) change e2e/integration to use their own DB (touches the tested
workflow); (c) leave dev/e2e on `dev.db` untouched and give the live
evaluation its own SQLite file.

**Decision made:** (c). The database was already selected by `DATABASE_URL`
(`src/lib/databaseUrl.ts`); nothing in Prisma or the app changed.
- `npm run eval` sets `DATABASE_URL` to `EVAL_DATABASE_URL` (default
  `file:./eval.db`) before `db.ts` loads (dynamic import in
  `scripts/runEvaluation.ts`), prints which database it is using, and
  refuses with a clear message if the file doesn't exist yet.
- `npm run db:eval:setup` creates and seeds `eval.db` (`prisma migrate
  deploy` + seed, both pointed at it). It is also the reset: re-running it
  wipes prior live results, which is why it is a separate, explicit command.
- `npm run dev:eval` runs the dev server against `eval.db` to view the
  results on the Evaluations/Ticket pages.
- `/eval.db` (+ journal) is gitignored.
`eval:dry-run`, `db:seed`, `test:e2e`, `test:integration` and `dev` are
unchanged and still use `dev.db`.

**Rationale:** Smallest change that makes the separation structural: a
different file, chosen in one place, visible in the eval script's output.
The existing e2e/dev behavior is preserved exactly (verified: 9/9 e2e).

**Tradeoffs:** Live results don't appear on a plain `npm run dev` (that
shows `dev.db`) — use `npm run dev:eval`. The npm scripts use inline
`VAR=value` syntax, so they're POSIX-shell only (fine for macOS/Linux; would
need `cross-env` on Windows). Nothing prevents someone from setting
`EVAL_DATABASE_URL=file:./dev.db`; that's an explicit override, not an
accident.

**When we'd reconsider:** If a hosted/shared deployment ever needs real
result storage — that's a different database decision (see "Database:
SQLite + Prisma 7").

---

## 2026-09-19 — Single-scenario evaluation filter (`npm run eval -- <scenarioKey>`)

**Context:** `npm run eval` always ran all 10 scenarios, so a first live
call couldn't be limited to one.

**Decision made:** `runEvaluationSuite({ scenarioKey? })` in
`src/lib/evaluation/runEvaluation.ts` narrows the case list; the loop,
`analyzeTicket()`, scoring and persistence are the same code as the full
run. An unknown key throws — before any model call or persisted row — with
the list of valid keys. `npm run eval -- duplicate-billing` and
`npm run eval:dry-run -- duplicate-billing` both use it; no argument runs
all 10 as before. Covered by two integration tests (one scenario runs via
the real pipeline; unknown key rejected, nothing persisted). Scoring and
routing are untouched.

---

## 2026-09-19 — Deterministic routing for consequential policy decisions, and an enforced refund-authorization contract

**Context:** The first real live call (`npm run eval -- duplicate-billing`,
Haiku 4.5 classifier/Billing, Sonnet 5 Response) completed cleanly — auth,
JSON parsing, the 2048-token budget, persistence and provider provenance all
worked — but scored 0.47 and exposed two related defects that no
deterministic test could:
1. The real classifier returned `intent: duplicate_charge`, `domains:
   ["billing"]`. `selectAgents()` only forced Policy for `refund_request` and
   `cancellation`, so for `duplicate_charge` Policy depended on the classifier
   volunteering `"policy"`. It didn't; Policy never ran, no policy decision
   existed, and `resolveOutcome()` (which refunds *only* on a grounded Policy
   "approve") fell through to the confidence default, `reply_and_close`.
   The e2e and dry-run fixtures hard-coded `["billing","policy"]`, and Audit
   #3's hand-trace assumed a classifier output matching `expectedOutcome`, so
   this divergence was invisible until a real model answered.
2. The Response agent, given a vague resolution ("Resolved based on
   specialist agent findings"), nevertheless told the customer "Refund Being
   Processed" — promising money the pipeline had not authorized. Its prompt
   already said never to state a different outcome than the resolution;
   prompt wording alone didn't hold.

**Options considered:**
- *Routing:* (a) tighten the classifier prompt; (b) add `duplicate_charge`
  to `selectAgents()`'s existing deterministic overrides; (c) a model call
  to decide routing.
- *Response contract:* (a) stronger prompt only; (b) a self-declared
  `promisesRefund` field in the response schema; (c) derive the authorized
  commitments from the resolution, state them in the prompt, and validate
  the output deterministically through the existing schema → retry →
  fallback path.

**Decision made:** Routing (b), Response (c).
- `selectAgents.ts`: `duplicate_charge` deterministically adds **billing and
  policy** (Billing supplies the duplicate-charge evidence; Policy is the only
  thing that can authorize the refund). The classifier stays model-based and
  routing stays a pure function; no new model call.
- Reviewed the other overrides rather than adding agents to make a score
  pass: `refund_request` and `cancellation` were already correct and remain
  covered by tests. `failed_payment` does **not** get Policy — its scenario
  is billing-only `reply_and_monitor`, and no policy decision is needed to
  say a retry is pending. `billing_question` was left alone (see below).
- New `src/lib/orchestrator/responseGuard.ts`: the Response prompt now
  carries an explicit "Authorized commitments" line derived from
  `resolution.action` (a refund IS authorized only for `refund_customer`),
  and `customerResponseSchemaFor(action)` extends `CustomerResponseSchema`
  with a `superRefine` that rejects a reply whose subject/body/nextSteps
  promise a refund under any other action. A rejection is an ordinary
  validation failure: `runStructuredStep` retries once with the reason fed
  back, and a persistent violation degrades to the existing safe fallback
  reply (which mentions no refund) with the step flagged `agent_failed` —
  an over-promise is never persisted. The resolution is the persisted
  authority; the Response agent cannot widen it.
- No schema shape change, no new persisted field, no chain-of-thought.
  Evaluation expectations are untouched: `duplicate-billing` still expects
  billing + policy + response, `duplicate-charge-policy`, `refund_customer`.

**Rationale:** Routing for an intent whose outcome moves money must not hinge
on a model remembering to list a domain — the same principle behind the
existing Risk/Policy overrides. For the Response contract, a prompt is an
instruction, not a guarantee; (b) relies on the same model self-reporting
honestly, while (c) checks the actual text in code against a rule the
pipeline (not the model) decided. (c) also needed no schema/fixture churn.

**Tradeoffs:** The refund-promise detector is a conservative sentence-level
heuristic (refund term + commitment verb + no negation/conditional), not
language understanding. It errs toward flagging: a false positive costs one
retry and at worst the generic fallback reply, which is safe and visible to
the operator; a false negative is what it exists to prevent. It only covers
*refund* promises, not every possible over-commitment (e.g. a promised
credit under another name). Forcing Billing+Policy on every
`duplicate_charge` also means Policy runs even when the ticket text is
ambiguous — acceptable, since Policy can return `requires_review`.

**Still open (not changed here):** the `multi-domain` scenario
(`billing_question` intent, expects Policy and `refund_customer`) still
relies on the classifier including `"policy"`; forcing Policy for all
`billing_question` tickets would add an agent to many informational tickets,
so that was deliberately not done without live evidence. The full 10-scenario
live run should show whether it matters.

**When we'd reconsider:** If live runs show the heuristic missing real
promises or over-flagging legitimate replies, or if other intents that lead
to money movement appear.

---

## 2026-09-19 — Tell the Technical Agent its summary limit; keep the 400-character schema cap

**Context:** The first full live evaluation (10 scenarios, real Anthropic
models) exposed a robustness bug. `AgentFindingSchema.summary` is capped at
400 characters, but the Technical Agent's prompt never told the model that
limit. In two of five Technical calls (`password-reset` and `multi-domain`)
the model wrote a longer summary on both attempts, so validation failed with
`summary: Too big: expected string to have <=400 characters`, the retry hit
the same error, and the step degraded to an `agent_failed` fallback. The
consequences were real: in `password-reset` the failed step made
`resolveOutcome()` escalate a ticket on an "agent failure" basis, and in
`multi-domain` the Technical agent's evidence was lost. The retry feedback
only repeats the validation error; it doesn't teach the model a budget. The
failure never surfaced in deterministic tests, whose hand-written fixtures
never exceed the cap.

**Options considered:** (a) raise the schema limit; (b) truncate an
over-long summary to 400 characters in code; (c) keep the schema as is and
state the contract explicitly in the Technical Agent's prompt.

**Decision made:** (c). The 400-character constraint is unchanged. The
Technical Agent's system prompt (which is rebuilt identically for every
attempt, so it also applies on the retry) now says `summary` MUST be 400
characters or fewer and that a longer one is rejected, asks for a concise,
factual summary of only the single most relevant technical finding, and
tells the model to put supporting detail in `evidence` instead. The limit is
one exported constant, `AGENT_SUMMARY_MAX_CHARS` (`src/lib/ai/schemas.ts`),
used by both the schema and the prompt so the two cannot drift apart.

**Rationale:** (a) would quietly accept longer outputs and weaken a contract
the UI and stored data are sized for, when the actual defect was that the
model wasn't told the rule. (b) is rejected deliberately: cutting a
structured field mid-sentence could drop or corrupt meaning (e.g. clip
"workaround already tried and failed" to "workaround already tried"), and
silently coercing invalid model output contradicts the project's rule that
malformed output is validated, retried once with feedback, and otherwise
surfaced as an honest failure — never repaired invisibly. (c) fixes the
cause, adds no new failure mode, and leaves the retry/fallback behavior
exactly as it was.

**Evidence and tests:** Three unit tests in `tests/unit/technicalAgent.test.ts`
cover the contract: the prompt states exactly the schema's limit; both the
first attempt and the retry carry it, and a compliant retry recovers with the
validation error still fed back; and a summary that stays over the limit is
not truncated but fails honestly as `agent_failed`. A targeted live re-run of
the two affected scenarios then showed the Technical step succeeding in both
(summaries of 199 and 329 characters, with input-token counts consistent with
a single attempt — retry counts are not persisted, so that part is
inferred). `multi-domain` moved from fail (0.84) to pass (0.88). This entry
covers only the output-length failure; it makes no claim about any other
finding from that evaluation.

**Tradeoffs:** Compliance still depends on the model following an instruction,
so an occasional over-long summary can recur; the retry and safe fallback
remain the backstop, unchanged. The instruction is scoped to the Technical
Agent, which is where the failures were observed; Billing, Policy and Risk
share the same cap but didn't fail in the live run, so their prompts were not
touched.

**Scope:** A robustness fix based on observed live-model behavior. It changes
no routing, policy logic, `resolveOutcome()`, evaluation expectations or
scoring, model selection, token budgets, or schema shapes.

**When we'd reconsider:** If live runs show over-long summaries from the
other agents, apply the same explicit-limit instruction to their prompts (the
shared constant is already exported). If instruction-following alone proves
insufficient, consider raising the cap deliberately as its own decision, not
truncating.

---

## 2026-09-19 — password-reset stays the canonical routine (`auto_resolve`) scenario; the ticket is rewritten, not the expectation

**Context:** The first full live evaluation scored `password-reset` as a
failure. Investigating it showed the scenario was internally inconsistent
from the foundation commit: its description ("Standard password reset request
with no security flags"), notes, `EVALUATION.md` ("Standard case, no
escalation") and expected outcome (`auto_resolve`, no escalation) all define a
routine request, but the ticket text described a repeated reset-email
delivery failure ("requested a password reset three times ... the email never
shows up, even in spam"). Everything in the design points at auto-resolution:
the Account Security Policy says password resets are automatic unless the
account has an open security flag; the Technical Agent's prompt uses "a
routine password reset with no security flags" as its `auto_resolvable`
example; `resolveOutcome()` has an explicit rule 7 for it; and it is the only
scenario that exercises that branch end to end. No document or policy said a
delivery failure needs Engineering.

**Options considered:** (a) leave the ticket and expectation as they were;
(b) keep the ticket and redesign the scenario as a technical escalation —
adding a "known issue" knowledge document and expecting `escalate`;
(c) keep the design and rewrite the ticket so it is actually routine.

**Decision made:** (c). (b) was drafted and explicitly rejected.
- `prisma/data/scenarios.ts`: only the password-reset ticket changed
  (subject "Forgot my password — can't log in"; message "I forgot my password
  and can't log in. Can you help me reset it?"). Channel, priority, account
  context, description, notes and the whole expected outcome are unchanged:
  `password_reset`, technical + response, no policy, no escalation,
  `auto_resolve`.
- `prisma/data/productDocs.ts`: a new neutral article, `password-reset-guide`
  ("Resetting Your Password"), stating only the standard self-service,
  verified-email reset flow that the Account Security Policy already
  describes. It exists for grounding and retrieval — without it, keyword
  retrieval surfaced only unrelated docs for a password ticket (the 2FA doc
  matches on "reset"). It prescribes no outcome.
- `scripts/evaluationDryRunFixtures.ts`: only the password-reset entry
  changed, to a routine finding (`auto_resolvable`, grounded in the new doc)
  and a routine reply.
- `tests/unit/passwordResetScenario.test.ts` guards the design: the ticket is
  a plain reset request, the expectation is unchanged, the doc is neutral and
  ranks first under the real retrieval, and the fixtures flow through the real
  Technical agent and `resolveOutcome()` to `auto_resolve`.

**Rationale:** (b) would have been a post-hoc change — made after seeing the
live model escalate — and would have written that observed behavior into the
knowledge base: a document telling the agent to escalate this exact case makes
the "expected" outcome true by construction, so a pass would measure
document-following, not judgment. It would also have duplicated the existing
`technical-escalation` coverage (same flags, same rule, same team), removed
the suite's only `auto_resolve` scenario, invented facts not in the synthetic
product (a ticket number, a cause, "support cannot resend the email"), and
contradicted the seeded background password-reset tickets, whose agents
answer a missing reset email by triggering a fresh one. The argument that the
system "cannot actually reset a password" was also wrong: no code executes
any resolution action — `refund_customer` included; the copilot proposes and
the operator acts (PRODUCT_SPEC). The defect was the ticket contradicting its
own specification, so the ticket is what changed. This does not change the
live-run record: the earlier `password-reset` results in `eval.db` were
produced against the old ticket text and are not comparable to a run on the
new one.

**Tradeoffs:** The trigger for revisiting the ticket was still a live
failure, but the justification is independent of it: the design artifacts
above define the case, and the ticket was the outlier. The new ticket no
longer probes how the Technical Agent handles an undocumented issue.

**Open (not addressed here):** a separate scenario for a reset-email delivery
failure, or more generally an undocumented technical issue, may be worth
adding later. It would probe a real gap — the Technical prompt says such a
case "needs manual investigation", but no flag or resolution maps to that
(the live model chose `requires_escalation`, contradicting the prompt's own
"clear evidence of a product defect" condition) — and it needs a product
decision on what action represents "investigate". It is outside this change.
The Technical agent also cannot verify "no security flags", since it is not
given the account's risk data.

**When we'd reconsider:** If the routine scenario proves flaky against a live
model even with a grounded, routine ticket, that is a finding about the
`auto_resolvable` prompt contract, to be handled as its own decision.

---

## 2026-09-19 — Deterministic Technical coverage for `password_reset`

**Context:** The first live evaluation of the corrected `password-reset`
scenario (a plain "I forgot my password and can't log in" ticket) scored 0.57
and failed. The real classifier returned `intent: password_reset` but
`domains: []`. `selectAgents()` starts from the classifier's `domains` and
adds specialists only through explicit intent overrides, and there was none
for `password_reset`, so the Technical Agent never ran. `resolveOutcome()`
then hit its "no specialist agents ran" rule and produced `reply_and_monitor`
("requesting clarification") for a clear, routine request, where the design
expects `auto_resolve`. The classifier's output was permissible: its prompt
explicitly allows an empty `domains` list. The deterministic tests and the
dry-run fixture all supplied `domains: ["technical"]` for this intent, so the
dependency was invisible until a live model answered — the same class of gap
as the `duplicate_charge` finding.

**Options considered:** (a) instruct the classifier, in its prompt, to always
list `technical` for password resets; (b) add a deterministic
`password_reset` → Technical rule in `selectAgents()`; (c) change the
scenario or its expectation.

**Decision made:** (b). `selectAgents()` now always includes `technical` for
`password_reset`, exactly like the existing `duplicate_charge`, `refund_request`
and `cancellation` overrides. The classifier, its prompt, the scenario, the
fixtures, scoring and model routing are unchanged. Selection is still a
`Set` filtered through `AGENT_KEYS`, so agents stay unique and in the stable
order, and `response` still runs last. A differential check of the old and new
function over every intent × domain subset × sentiment (640 combinations)
showed exactly 32 results changed — all `password_reset` without a `technical`
domain — and each gained only `technical`; nothing was removed.

**Rationale:** Which specialist a routine password reset needs is a property
of the intent, not something the model should have to volunteer through an
optional field. Leaving it to the classifier made required coverage
model-dependent: it worked when the model happened to list `technical` and
silently degraded to a wrong default when it didn't. (a) would only ask the
model to be more consistent; a rule in code cannot vary. This is an
orchestration contract, not a correction of the classifier — a classifier
returning `domains: []` here is valid output and is left as is. (c) is
rejected: the scenario is valid, and the failure occurred before any step
that could test its expectation.

**Tests:** New cases in `tests/unit/selectAgents.test.ts` cover `domains: []`
and `["technical"]` (no duplicate), no Policy/Billing/Risk added, stable order
with extra domains and the sentiment override, `response` last, and the
existing `duplicate_charge`, `refund_request`, `cancellation` and
`failed_payment` routing as pinned at their existing inputs. An
orchestrator-level test drives a `domains: []` classification through to
`auto_resolve`. These prove routing and resolution, not live model behavior:
the corrected scenario has not yet been re-run against a live model, so
whether the Technical Agent then produces `auto_resolvable` (and respects its
summary limit) on this ticket is still unmeasured.

**Tradeoffs / still open:** Only `password_reset` was changed. Other intents
still depend on the classifier's `domains` for their primary specialist —
notably `technical_issue` (Technical), `failed_payment` and `billing_question`
(Billing) — and the same failure mode is possible there. They were not changed
without live evidence; the live evaluation reported `technical_issue`
classified with `["technical"]` each time so far. That is a candidate for a
follow-up audit, not part of this decision.

**When we'd reconsider:** If live runs show another intent losing its primary
specialist to an empty or partial `domains` list, apply the same deterministic
pattern, or move the intent → specialist mapping into a single explicit table.

---

## 2026-09-19 — Formalize the intent taxonomy and define a primary-intent rule (documentation only)

**Context:** The ten intents in `TICKET_INTENTS` were only a list of names.
The classifier prompt says "exactly one of" and no document defined any
intent or said how to choose one when a ticket contains several issues, yet
`expectedIntent` is graded by exact match. A live evaluation surfaced the
consequence on the `multi-domain` scenario (expected `billing_question`,
classified `duplicate_charge`), and a read-only audit then found that the
underlying gap is broader than that one scenario: no intent is formally
defined, the seeded data uses `billing_question` and `account_security`
inconsistently, and there is no primary-intent rule.

**Options considered:** (a) document the taxonomy and a primary-intent rule,
changing no behavior; (b) change the `multi-domain` expected intent on its own;
(c) change the classifier prompt or taxonomy; (d) introduce a separate
multi-intent concept.

**Decision made:** (a). `EVALUATION.md` gains a section, "Intent taxonomy and
primary-intent rule", which documents the *intended product specification*
and, explicitly, not current classifier behavior. It contains:
- what `intent` and `domains` each represent. That `intent` names the single
  issue that should govern handling, and that secondary issues are carried by
  `domains` and never by an extra or "mixed" intent, are **specification
  choices**, labeled as such; no pre-live artifact states them;
- a definition of each of the ten intents with its evidence and an evidence
  strength (strong, limited, or insufficient; "limited" also covers
  conflicting evidence), so that "clear by usage" is distinguished from
  "formally specified" and no definition is more precise than its evidence;
- a general primary-intent rule: (1) specificity: `billing_question`,
  `feature_question` and `general_inquiry` are designated fallbacks, used only
  when no issue has a more specific intent (a specification decision);
  (2) precedence by tier: `account_security`, then Policy-decided outcomes
  (`duplicate_charge`, `refund_request`, `cancellation`), then technical
  (`technical_issue`, `password_reset`), then billing status
  (`failed_payment`); (3) ties go to the issue the customer states first, a
  stated convention, not derived from evidence; (4) all other issues are
  secondary and expressed through `domains`;
- an audit of all ten curated scenarios against the rule.

**What the evidence does and does not support:** The evidence used is limited
to artifacts that predate any live evaluation: the seeded ticket templates,
the scenario descriptions, rationales and expectations, the policies and
product docs, the schema descriptions, and the pre-live product and evaluation
documentation. They show how intents are used and how routing, policy and
resolution work; they do not, by themselves, define what `intent` is for or
how to choose among several issues, so the rule is an interpretation of that
evidence subject to the specification choices above. The support differs by
tier and no single source is credited with every tier:
- *Tier 1 (`account_security`)*: the product spec's description of the Risk
  agent, the scoring notes and `resolveOutcome()` checking Risk first, the
  Account Security and Escalation Policies, and the pre-live Risk routing rule.
- *Tier 2 above tier 3*: the scoring notes (Policy's decision is checked before
  Technical's flags) and the order of `resolveOutcome()`'s rules; that these
  intents are Policy-decided comes from the relevant policies, the expected
  agents of the scenarios, and the pre-live routing rules that add Policy.
- *Tier 3 (technical)*: the Technical agent's role in the product spec, the
  Technical-flag rules in `resolveOutcome()`, the technical scenarios, and the
  Technical prompt's `auto_resolvable` example.
- *Tier 4 (`failed_payment` below technical)*: **limited, single-source
  evidence.** Only the rule order in `resolveOutcome()` places Billing's
  payment-status handling after Technical's. The scoring notes and the product
  spec do not establish a Billing-versus-Technical precedence, and no curated
  scenario exercises it. It is recorded as a specification interpretation that
  could be revisited.

No live classifier output was used to define any intent or the rule, and the
routing overrides added after live findings were not cited as evidence. The
`account_security` definition is taken from the Account Security Policy, the
Escalation Policy and the `suspicious-activity` scenario; the seeded template
for that intent ("Enabling SSO for our team") does not fit it and is recorded
as a known, unresolved inconsistency rather than silently used to bend the
definition. The pre-live evidence for `billing_question` is **conflicted**
(informational templates and FAQ versus the `multi-domain` scenario, which
expects it for a mixed ticket), so its definition is limited to the
informational core and no exclusion of remedy or problem tickets is claimed.

**Audit result:** Nine of ten scenarios are consistent with the rule.
`multi-domain` is inconsistent under this specification, and the verdict has
two parts on different footing. What the artifacts independently support is the
ordering of its two issues, a Policy-decided outcome (tier 2) above a technical
one (tier 3), which selects `duplicate_charge` over `technical_issue`. That
`billing_question` is not an eligible primary intent follows from designating
it a fallback, which is a specification decision, not an established fact. The
tier order was fixed from the pre-live evidence before it was applied to any
scenario; that it selects the same label the live classifier chose is recorded
as a consistency observation and context only, not as the basis of the rule.

**Not changed:** No evaluation expectation, scenario, fixture, test,
production code, classifier prompt, schema, routing, scoring or threshold was
changed, and no live evaluation was run. The `multi-domain` expected intent
therefore stays `billing_question` for now. Whether to change it, or to
specify `billing_question` differently, is deferred to a separate, documented
decision; it must not be combined with any scoring or threshold change.

**Tradeoffs:** The definitions and rule are specification only. The classifier
currently receives just the intent list, not this taxonomy or the precedence
rule, so classifier behavior is unchanged; whether to tell the model is a
separate prompt decision, needing a fresh full evaluation. The tie-break is a
convention, and the fallback designation and the tier order are specification
decisions or interpretations. Several intents rest on limited evidence
(`feature_question`, `general_inquiry`, and `billing_question`, whose evidence
also conflicts), and the boundaries between them, and the intent for an
SSO-setup question, remain insufficiently specified rather than invented.
`cancellation`, `feature_question`, the tie-break and the `failed_payment`
tier placement are not exercised by any curated scenario.

**When we'd reconsider:** If new scenarios or seeded data show the rule giving
an unreasonable primary intent, or if the classifier prompt is later changed
to convey it, revisit the tiers, the fallback designation and the tie-break
together and re-baseline.
