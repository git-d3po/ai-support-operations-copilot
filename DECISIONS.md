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

---

## 2026-09-19 — Deterministic Technical coverage for `technical_issue`

**Context:** A read-only audit of the routing contracts found a gap in
`selectAgents()` that follows from artifacts that predate any live testing.
The product spec gives the Technical Agent the job of diagnosing "technical
issues against product documentation and known-issue records"; the technical
rules in `resolveOutcome()` (escalate on a failed workaround, auto-resolve a
standard flow, reply on a known-issue workaround) can only act on a Technical
finding; the intent taxonomy in `EVALUATION.md` defines `technical_issue` as a
product malfunction, performance or integration problem; and both technical
curated scenarios expect Technical to run. Yet `selectAgents()` had no rule for
this intent: Technical ran only if the classifier happened to list `technical`
in `domains`, an optional field its prompt allows to be empty. Every existing
`technical_issue` routing test supplied `domains: ["technical"]` itself, which
hid the dependency. Run through the real code, `technical_issue` with no
domains selects only `response`, and `resolveOutcome()` then falls to its "no
specialist agents ran" rule (`reply_and_monitor`), so a technical ticket,
including one whose documented workaround already failed, could never reach the
rules written for it.

**Options considered:** (a) ask the classifier, in its prompt, to always list
`technical` for technical issues; (b) add a deterministic `technical_issue` →
Technical rule in `selectAgents()`; (c) change the scenarios or expectations.

**Decision made:** (b). `selectAgents()` now always includes `technical` for
`technical_issue`, in the same way as the existing intent overrides. Nothing
else changed: agents remain unique (a `Set`), in the stable `AGENT_KEYS` order,
with `response` last, and no other specialist is added by this rule. An
exhaustive differential comparison of the committed and new function over every
intent × domain subset × sentiment (640 combinations) showed exactly 32 results
changed, all `technical_issue` cases whose domains lacked `technical`; each
gained only `technical`; nothing was removed, duplicated, reordered or moved
ahead of `response`.

**Rationale:** Which specialist a technical issue needs is a property of the
intent, not something the model should have to volunteer through an optional
field; leaving it to the classifier made required coverage model-dependent.
This is an orchestration invariant, not a classifier correction: a classifier
returning `domains: []` for a technical issue is valid output and is left as
is. (a) would only ask the model to be more consistent, whereas a rule in code
cannot vary; (c) is rejected because the scenarios are consistent with the
specification and the defect is in routing.

**Tests:** New cases in `tests/unit/selectAgents.test.ts` cover `domains: []`
and `["technical"]` (no duplicate), unchanged domain-based Technical routing
for other intents, no Policy/Billing/Risk added by this rule, stable order with
extra domains and the sentiment override, `response` last, and the existing
`duplicate_charge`, `refund_request`, `password_reset`, `cancellation` and
`failed_payment` routing pinned at their existing inputs. An orchestrator-level
test drives a `technical_issue` classification with no domains to Technical and
an engineering escalation. One earlier test comment that called `technical_issue`
"still dependent on the classifier's domains" was updated so it stays true. No
live evaluation was run.

**No live result is used to justify the rule.** Its basis is the pre-live
product spec, the pre-live resolution rules, the taxonomy and the scenario
expectations. The gap was first noted as an open item in the earlier
`password_reset` decision and then confirmed by a read-only audit; those
observations prompted this change but are not its justification.

**Not changed:** No scenario, evaluation expectation, fixture, classifier
prompt, agent prompt, schema, `resolveOutcome()`, scoring, threshold, model
routing or token budget was changed, nor `failed_payment`, `account_security`
or refund routing. This rule does not make the Risk agent run for
`technical-escalation`: that still depends on the classifier's sentiment or
domains. The primary specialist for `failed_payment`, and a policy-mandated
escalation for `account_security`, are separate decisions.

**Tradeoffs:** Technical now runs for every `technical_issue` ticket, including
any the classifier judged to need no specialist, at some added cost; a technical
ticket warrants diagnosis by definition. The rule keys on the classified intent,
so a ticket mislabeled with a different intent is not covered.

**When we'd reconsider:** If more intents gain deterministic coverage, move the
intent → specialist mapping into a single explicit table instead of a growing
chain of conditions.

---

## 2026-09-19 — Mandatory escalation to Trust & Safety for `account_security`, enforced at the resolution layer

**Context:** The pre-live specification is explicit. The Account Security
Policy says reports of suspicious account activity "must always be escalated
to Trust & Safety" and are not to be resolved directly; the Escalation Policy
names Trust & Safety for "any suspected account compromise"; the evaluation
table for `suspicious-activity` says "Security always escalates, regardless of
other findings"; and the product spec calls Risk the safety net that can force
escalation regardless of other findings. `selectAgents()` already guaranteed
that the Risk agent runs for the `account_security` intent, but
`resolveOutcome()` left both whether to escalate and where to send it entirely
to the Risk agent's model output. Run through the real code, that allowed a
suspected compromise to be auto-closed (`reply_and_close`, no human review) when
Risk did not recommend escalation, to be sent to `senior_support` when Risk
named that team, left null, or failed, to be escalated to `engineering` or
resolved by a Technical or Policy finding when Risk stayed silent.

**Options considered:** (a) leave it to the Risk agent's judgment and its
prompt; (b) enforce only the destination when Risk recommends escalation;
(c) enforce a deterministic `account_security` → escalate → Trust & Safety
rule in `resolveOutcome()`.

**Decision made:** (c), in `src/lib/orchestrator/resolve.ts`, as an explicit
rule placed after the existing classification-failure rule and before the
Risk-recommended-escalation rule. When the classified intent is
`account_security` the outcome is `escalate`, `requiresHumanReview: true`,
target team `trust_and_safety`, whatever the Risk agent or any other specialist
found. A failed classification keeps its existing precedence (`senior_support`).

**Why relying on Risk's judgment was insufficient:** The requirement says
"always". A model's recommendation cannot guarantee that; only code can. (b)
would fix the destination but still let a non-recommending Risk auto-close the
ticket, which is the more serious failure.

**Why the resolution layer:** It is the deterministic layer that already
encodes the "security first" priority and the only place that decides the final
action, so the guarantee holds whichever other agents ran and whatever they
found. It is also where a Risk failure is handled, and that fallback names a
different team.

**Why the policy reference is deterministic:** The project requires
escalations to cite the policy they rely on. The escalation schema has no
policy-reference field, so the citation goes in the existing reason text, from
a constant (`account-security-policy`) and not from any model-generated
citation. When Risk did recommend escalation, its reason is appended after the
fixed citation, within the schema's 400-character limit; the citation is never
the part that is truncated.

**Severity was intentionally not redefined.** No artifact specifies a severity
for these escalations, and inventing one would be a new product-policy
decision. Risk's severity is retained when it supplied one; otherwise the rule
uses `"medium"`, the same default the existing Risk-recommended-escalation rule
already applies when Risk gives none. The confidence is Risk's when Risk
recommended escalation and otherwise the classification's, so the deterministic
outcome does not borrow a "no escalation" confidence.

**Basis and verification:** This change rests on the pre-live specification, not
on improving a live evaluation score. `suspicious-activity` already expects
escalation and its expectation is unchanged; no scenario, expectation, fixture,
scoring, threshold, prompt, routing or seeded data changed, and no live
evaluation was run. A differential comparison of the committed and new
`resolveOutcome()` across 12,000 combinations (10 intents × classification
failed or not × 8 Risk outcomes × 5 Policy × 5 Technical × 3 Billing findings)
showed that only `account_security` results changed (all 600 of its
combinations), none changed for any other intent or under classification
failure, and every new `account_security` result escalates to Trust & Safety
with human review and cites the policy, within the schema limits. In the old
code, 120 of those 600 were not escalated and 405 went to another team.
Resolution and orchestrator tests cover Risk recommending, declining, choosing
another team or none, failing, Technical and Policy findings, the classification
failure precedence, the citation, and the schema limits.

**Remaining limitation:** The trigger is still the classified intent, which is
itself model-derived and sees only the subject and message. A compromise report
labeled with another intent is not covered by this rule; it is still caught
only when Risk is routed by sentiment or domains. The rule makes the outcome
deterministic for the label; it does not improve detection. The classifier is
not told the taxonomy, and the seeded background template for this intent
("Enabling SSO for our team") is a benign setup question that does not fit the
definition, so a ticket like it labeled `account_security` would now be
escalated (the safe direction, at some cost to operator workload). That
inconsistency is recorded, not fixed, here. The policy's clause about not
disclosing account details until identity is reverified is a separate
requirement that nothing in the Response layer enforces, and is not addressed.

**When we'd reconsider:** If the intent label proves an unreliable trigger, or
the classifier is given the formal taxonomy, revisit what should trigger the
invariant (and whether severity should be specified) as a separate decision.

---

## 2026-09-19 — Redesign `prohibited-refund` around Refund Policy condition 3 (API overage), removing a policy-compliant ambiguity (specification/data only)

**Context:** `prohibited-refund` expected `deny_request` with no escalation for
an annual-plan refund requested 210 days after the charge. The seeded Refund
Policy does not require that outcome. It lists four conditions, then says that
requests outside them "require Billing Ops approval and should be marked
`requires_review` rather than auto-denied, unless the request is clearly outside
condition 1 by more than 90 days, in which case it **may** be denied directly".
At 210 days both outcomes are policy-compliant: `requires_review` is the stated
default and direct denial is a permitted exception. The Escalation Policy also
sends "refund requests outside the standard Refund Policy conditions" to Billing
Ops with no exception clause. The scenario notes cited only condition 1 and
never the 90-day exception, the pre-live evaluation table summarized the case as
"denies a refund outside policy conditions", and a seeded background template
("we're switching tools") is answered with a processed refund. The scorer grades
a single `expectedAction`, so a policy-compliant `requires_review` would be
scored as a failure.

**What the read-only audit found:** (1) the seeded policy is the specification,
and it permits both outcomes, so `deny_request` was one compliant outcome, not a
requirement; (2) there is no implementation defect: the Policy agent receives
the full policy text and the pre-computed days since the charge, its contract
allows `approve`, `deny` and `requires_review`, `resolveOutcome()` maps
`requires_review` to `escalate` (`billing_ops`, low), the Escalation Policy's own
route, and `deny` to `deny_request`, and Policy is forced for `refund_request` by
routing; (3) the single-outcome scoring cannot represent an alternative
compliant outcome. The historical live result for the old scenario was noted as
context only and was not treated as specification evidence.

**Options considered:** (a) flip the expectation to `requires_review`, which only
moves the ambiguity, since a compliant `deny` remains permitted at 210 days;
(b) accept either outcome, which needs a scoring/schema change; (c) tighten the
Refund Policy wording, a product-policy change; (d) redesign the scenario so
exactly one outcome is compliant.

**Decision made:** (d), using **condition 3**: "Usage-based charges (API overages,
storage overages) are non-refundable once the usage has occurred, because the
underlying resource was consumed." The scenario key and the expected outcome are
unchanged: `refund_request`; agents billing + policy + response; policy
`refund-policy`; no escalation; `deny_request`. Only the situation changed: a
customer asks for a refund of metered API overage charges and acknowledges the
usage was real (a batch job of their own). Facts: one paid invoice of $2,450.00
and one succeeded charge for the same amount, both 21 days old, with the
customer, account and subscription identity unchanged; ticket subject "Refund
request for API overage charges", email, medium priority. The message contains no
claim of a metering error, duplicate billing, unauthorized activity or other
dispute.

**Why condition 3 (and not condition 4, the mid-cycle downgrade):** Condition 3
is flat and unconditional. The charge age is chosen so nothing competes: 21 days
is past the 14-day condition (which covers subscription charges), and far under
90 days, so the ambiguous catch-all exception does not decide the case. The
request falls squarely under condition 3, so it is not merely "outside these
conditions" and the `requires_review` default does not apply. Condition 4 could
not be grounded in the data the agents see (no plan history, and the Policy agent
is never shown subscription or plan data), so the deciding fact would rest on an
unverifiable statement. It would also sit next to `legitimate-refund`, whose
ticket already asks to drop back to Starter, and could be cross-read with
condition 1. The seeded world supports usage charges: the `API-USAGE` product,
the API-limits doc, two billing-question templates, and the policy's own wording.

**Structured grounding:** The charge carries `reason: "api_overage"`. That field
is already exposed to the Billing and Policy agents (transactions are printed with
their reason), so the deciding fact is in structured data and not only in the
customer's message. The schema comment says the field is "populated for
refunds/failures", so using it to label a charge's kind extends that convention
slightly; it is an existing optional fixture and database field, with no schema
change.

**Why specification/data only, and why this is not an implementation defect:**
The old outcome was not produced by a defect. The pipeline handled both
policy-compliant outcomes correctly, and the ambiguity lived in the scenario's
expectation. So no production logic, `resolveOutcome()`, agent prompt, scorer,
threshold, routing, or Refund Policy wording was changed. Only the scenario
data, its notes, the deterministic dry-run fixture for this scenario, and one
`EVALUATION.md` table row changed. Under the new scenario a `requires_review`
would be a misapplication of condition 3 (model variance), not a compliant
alternative; even so, a single such result would not by itself indicate a defect.

**Not done / limits:** No live evaluation was run, and the databases were not
reseeded. Earlier live results for this scenario used the old data and are not
comparable to a run on the new one. The `requires_review` path (a request between
14 and 90 days after the charge, outside every condition) still has no scenario;
that is a separate follow-up. The classifier could still label the ticket
`billing_question` instead of `refund_request`, though the request for a refund is
explicit. The Policy agent computes days since the charge from the wall clock, so
the printed value depends on the day of a run, but it stays well past 14 and
under 90.

**When we'd reconsider:** If live runs show the model systematically choosing
`requires_review` for an acknowledged usage-based charge, investigate the Policy
agent's handling of condition 3 as a separate finding.

---

## 2026-09-19 — Reference time: business-derived time facts come from persisted event data, not the wall clock

**Context:** The seeded world is deterministic (every curated ticket, invoice
and charge is anchored to `2026-09-18T12:00:00.000Z`), but the Policy agent
computed "days since the most recent successful charge" with `new Date()`. The
printed value therefore drifted with the day of a run: it equalled the fixture's
own offset only on the anchor date. `legitimate-refund` (charge 5 days before the
request) would have printed more than 14 from about 2026-09-28 and fallen outside
Refund Policy condition 1 although none of its seeded facts had changed. A
read-only audit confirmed this was the only business-derived fact in `src/` that
read the clock (the other clock reads are latency timing and run bookkeeping in
`modelClient.ts` and `persist.ts`), and that the data already held the right
time: `Ticket.createdAt` is seeded at the anchor for every curated ticket, but
`loadTicketContext` discarded it. The same audit found that a ticket can be
(re-)analyzed any time after it was created ("Run AI analysis again"), so the
moment of analysis and the moment of the request are already different in normal
use.

**Three kinds of time, kept distinct:**

- **Event time** is when something happened, and is stored: `Ticket.createdAt`,
  `Message.sentAt`, `Transaction.occurredAt`, `Invoice.issuedAt`. It is the only
  kind that any business fact in this codebase depends on.
- **Evaluation reference time** is the instant a case is judged as of. For refund
  timing it is not a separate input: it collapses into the request's event time.
  There is no consumer today that needs it to differ.
- **Wall-clock time** is the actual current time. It is used only at the
  persistence edge, to record when a run happened (`persist.ts`), and for latency
  measurement. Agents never read it.

**Options considered:** (a) derive the reference time from persisted event data
(the ticket's own timestamp); (b) pass an explicit injected `now` through the
context; (c) freeze the clock in the evaluation runner only; (d) change the
scenario's dates; (e) re-anchor and reseed the database before every evaluation.

**Decision made:** (a). `TicketDataContext` gains `requestedAt: Date`, populated
by `loadTicketContext` from the ticket's persisted `createdAt`. The Policy agent
prints the number of days from the most recent successful charge **at or before**
`requestedAt` to `requestedAt`, and the prompt now says so explicitly and names
the request time. `mostRecentSucceededCharge(transactions, asOf?)` takes an
optional bound and behaves exactly as before without it. A charge made after the
request cannot be the charge the request is about, so with no earlier charge the
prompt prints the existing "n/a" form. Nothing else in the Policy agent changed.

**Why refund timing is measured to the request, not to the current time:** (1) A
customer should not lose eligibility to support latency. The seeded Support SLA
Policy allows a first response of up to 24 business hours on the Starter plan, so
a request made on day 13 and handled on day 15 is routine, and measuring to
"now" would penalize it. (2) Re-running an analysis must not change the answer;
measured to "now", clicking "Run AI analysis again" tomorrow could flip a
decision the customer was already owed. (3) The customer's own framing is the
request time ("upgraded 5 days ago"). **This is an interpretation.** The Refund
Policy says "within 14 days of a charge" and the "more than 90 days" exception
without naming the second endpoint, so the wording is silent. The policy text was
not modified; clarifying it is a separate decision.

**Why `Ticket.createdAt` is the anchor:** It is the one authoritative timestamp
on the ticket entity, it already exists and is persisted, and production
ingestion sets it, so production and evaluation read the same field and need no
separate wiring. `Message.sentAt` of the latest customer message is worse: a
customer who asks on day 13 and chases on day 20 would be judged at day 20.

**Why a universal injected `now` was not introduced:** Nothing in the repository
needs "how long has this been open". The Support SLA Policy is text only and no
code computes against it. Every fact that depends on time is a function of event
data, so an injected clock would have no consumer and would only add a parameter
to `analyzeTicket`, `runEvaluationSuite`, both runners and the UI action. This
project's rule is not to add abstractions for requirements that do not exist. If
an age-based feature is built later (SLA breach, time waiting), an explicit
`asOf` should be added then, defaulting to the wall clock in production and
pinned in evaluation.

**Why the alternatives were rejected:** (c) Freezing the clock in the runner
would pin evaluations but leave the UI and the seeded demo drifting, and the
evaluation would no longer exercise the path production runs. (d) Editing the
scenario's dates only postpones the failure (any offset eventually crosses the
boundary as the wall clock advances) and leaves the defect in place for every
other time-dependent scenario.
(e) Re-anchoring and reseeding per run breaks the byte-reproducible seed this
project requires, and re-seeding `eval.db` wipes its recorded runs.

**What was and was not changed:** Changed: `context.ts`, `policyAgent.ts`
(prompt wording and the one date computation), `evidence.ts` (optional bound),
and the test fixture default. Not changed: scenario data (`legitimate-refund` and
`prohibited-refund` included), expectations, the scorer, thresholds, the Refund
Policy text, the seed, the schema (no migration), routing, resolution, and the
billing, risk and technical agents. `scripts/evaluationDryRunFixtures.ts` needed
no change; its stated day counts ("5", "21") are now what the real path prints on
any date, and a test asserts it.

**Regression coverage:** the real Policy prompt path for a request years in the
past (5 days, and the 14/15-day boundary), a later charge excluded, the "n/a"
cases, `loadTicketContext` returning `requestedAt` equal to `Ticket.createdAt`
(including after later messages and edits), and a scenario-level check that each
refund scenario's stated day count equals the derived one. The guard against
reintroducing a clock is behavioral, not a source scan: every registered agent is
run on one context under two very different system clocks, and its prompts must
be identical.

**Known limitations:** (1) A refund requested late in a thread is anchored to
first contact, not to the message that asked for it. This favors the customer
slightly and is left to human review; anchoring to the actual request message
would need the model to identify it. (2) The background seed is not temporally
coherent: tickets are created 0-180 days before the anchor while each account's
invoices and charges are laid out at 30-day multiples independently, so some
seeded charges post-date their own ticket (measured on a scratch seed: 23 of
79 background tickets have no charge at or before them). Under this decision
those tickets print "n/a" rather than a negative or drifting count. That is an honest reading
of the data, but it is unrepresentative demo data, and it does not touch any of
the 10 curated scenarios. It is tracked in TODO.md as a separate P2, and the seed
was deliberately not changed to hide it. (3) `daysSince` rounds to whole days, so
a gap of 14.4 days prints 14. Every curated scenario uses whole-day offsets, so
this does not affect them, but the rounding rule is unchanged and unexamined.

**Supersedes:** the closing sentence of the prohibited-refund entry above ("The
Policy agent computes days since the charge from the wall clock, so the printed
value depends on the day of a run") is no longer true. The printed value is now
21 on every date.

**Not done / limits:** No live evaluation was run, the databases were not
reseeded, and no network call was made. Integration tests and a seed check ran
only against scratch copies. Both `dev.db` and `eval.db` still hold the earlier
`prohibited-refund` data and must be reseeded before a live run.

**When we'd reconsider:** When a feature needs the current time rather than the
request time (SLA age, follow-up staleness), or if a policy is clarified to
count from a different endpoint.

---

## 2026-09-20 — `failed_payment` is Billing-owned at resolution (resolution precedence only)

**Context:** The full live evaluation scored `failed-payment` 0.57 (fail), the
scenario's first live failure. The first full baseline had scored it 1.00 with
classifier domains `["billing"]`, only Billing and Response running, and
`reply_and_monitor`. On the later run the classifier returned
`["billing","technical"]`, so `selectAgents()` (which starts from the classifier's
domains) also ran Technical. Technical retrieved the Invoices & Billing FAQ ("a
failed charge is retried on days 1, 3, and 7 ... before the subscription is
marked past due") and flagged `auto_resolvable`. Billing correctly flagged
`payment_failed_awaiting_customer_action`. `resolveOutcome()` checks Technical's
`auto_resolvable` (rule 7) before Billing's flag (rule 9), so the outcome was
`auto_resolve`, telling the customer no further action was needed while the
invoice was unpaid and the account past due. A read-only audit established that
the code did what its docstring and tests said, and that the repository never
decided the case: `EVALUATION.md` and an earlier entry here record the placement of
`failed_payment` below technical as "limited, single-source evidence" (only the
rule order supports it), say the scoring notes and product spec "do not establish
any Billing-versus-Technical precedence", that no scenario exercises it, and that
it "could be revisited". No test ran `resolveOutcome()` with a Technical and a
Billing finding together.

**Options considered:** (1) make Billing own the resolution for a single-issue
`failed_payment`; (2) give Technical an explicit abstention path; (3) keep the
current ordering and document it. A fourth idea, removing Technical from routing
for this intent, was set aside: it contradicts "domains = implicated specialists"
and nothing documents the orchestrator dropping classifier domains.

**Decision made:** (1), by an intent-conditioned rule 6b in `resolveOutcome()`
(named like the existing 1b). When `classification.intent === "failed_payment"`
and the Billing finding carries `payment_failed_awaiting_customer_action`,
resolution is `reply_and_monitor` using Billing's summary and confidence, with no
human review and no escalation, exactly the outcome rule 9 already produces. It
sits after rule 6, so Technical `requires_escalation` still escalates to
Engineering, and above rules 7 and 8, so neither Technical `auto_resolvable` nor a
Technical known-issue workaround overrides Billing under this intent. Everything
above rule 6 (a failed classification, account security, Risk, every Policy
outcome) keeps its precedence. Every other intent keeps rules 7-9 as they were.

**Why Billing owns this outcome:**
- `failed_payment` is defined in `EVALUATION.md` as a charge that failed or was
  declined "and its retry or payment method", and the product spec lists failed
  payments under the Billing Agent's role.
- Billing's flag explicitly covers automatic retry: "a payment recently failed and
  the customer needs to act (update payment method) or the system will auto-retry".
  The scenario's situation, a customer who already updated the card while a retry
  is pending, is what that flag describes.
- Technical lacks the account and invoice state. It is given only the ticket and
  product documentation, never invoices, transactions or subscription status, so it
  could not see that the account was already past due. Billing sees that state but
  is never shown the documentation, so neither agent held both facts.
- Technical's `auto_resolvable` result is documentation-only. Its prompt defines the
  flag as a standard self-service flow "with no account-specific issue", and tells it
  to "say the standard flow applies" when nothing matches, so on a ticket outside its
  scope that output is what the prompt prescribes. It cannot establish that a payment
  problem is resolved.
- An intent-conditioned resolution rule has precedent (rule 1b), so this follows an
  existing pattern and adds no abstraction.

**What this does not do (scope):** It changes resolution precedence only. The
classifier, `selectAgents()`, both agents' prompts, the flag vocabulary and the
scorer are unchanged, and Technical still runs when the classifier asks for it (a
test asserts this). No Technical abstention path was added. The seeded scenario,
its expectation and every policy are untouched. Tier 4 remains as documented for
every other intent and for genuinely mixed tickets, where the intent is not
`failed_payment`. The `EVALUATION.md` sentence saying only the rule order places
Billing after Technical is therefore still true for those cases and was not edited.

**Behavior before and after (this change only):**

| Intent | Findings | Before | After |
|---|---|---|---|
| failed_payment | Billing payment-failed + Technical `auto_resolvable` | `auto_resolve` | `reply_and_monitor` |
| failed_payment | Billing payment-failed + Technical known-issue workaround | `reply_and_close` | `reply_and_monitor` |
| failed_payment | Billing payment-failed + Technical `requires_escalation` | `escalate` (Engineering) | unchanged |
| failed_payment | Billing payment-failed alone | `reply_and_monitor` | unchanged |
| failed_payment | Technical `auto_resolvable`, no Billing flag | `auto_resolve` | unchanged |
| any other intent | Billing payment-failed + Technical non-escalating flag | Technical decides | unchanged |

**Interpretation to note:** the decision states Billing owns the outcome without
qualification, and its explicit example was `auto_resolvable`. Rule 6b also outranks
Technical's non-escalating known-issue flag (rule 8), because leaving rule 8 above it
would let a Technical finding still override the owning specialist. This is pinned by
a test. If a documented workaround for a real payment-page problem should instead
reply and close, that is a separate, narrower decision.

**Tests:** New `resolveOutcome` cases exercise a Technical and a Billing finding
together for the first time: Billing wins over `auto_resolvable` and the known-issue
flag in either finding order and equals the Technical-not-run outcome; Technical
`requires_escalation` (alone, paired with already-tried, and alongside
`auto_resolvable`) still escalates to Engineering; classification failure, Risk and
every Policy outcome still take precedence; the rule does not apply without Billing's
flag; and, for every other intent, rules 7-9 behave exactly as before. Three
orchestrator-level cases drive the whole pipeline with a classifier returning
`["billing","technical"]` so both agents genuinely run: the live failure now yields
`reply_and_monitor`, Technical escalation still escalates, and a billing-only
classification gives the same outcome. The ownership cases were confirmed to fail
against the previous `resolve.ts`.

**Not done / limits:** No live evaluation was run and the databases were not
reseeded. This fixes the resolution, not the routing: when the classifier adds
`technical`, the extra agent still runs and the exact-set routing dimension still
scores it as a miss. From the scorer's weights (classification 1, routing 1,
escalation 2, resolution 2, evidence 1, policy not scored here) the scenario would
reach 6/7 = 0.857, still a pass. That figure is arithmetic, not a measurement.
Whether the classifier returns the extra domain again is unchanged and unmeasured.
The customer reply is still drafted from whichever finding governs, so a Technical
misreading of the FAQ no longer reaches the customer for this intent, but the
underlying gap (Technical reading a billing document without account state) is left
as is. The scenario's own premise ("next retry is automatic") and the FAQ ("before the
subscription is marked past due") sit in mild tension, because the seed already marks
this account past due; that is not resolved here.

**When we'd reconsider:** If a documented workaround for a genuine payment-page
defect should govern a `failed_payment` ticket, if a real mixed ticket (a failed
payment plus a separate technical problem) is classified `failed_payment` and its
technical part is dropped, or if Technical is given an abstention path or account
state, which would change why the precedence is needed.

---

## 2026-09-20 — Add `out-of-window-refund`: end-to-end coverage of the Refund Policy's 14-90 day `requires_review` path

**Context:** A read-only coverage audit of the refund scenarios found one meaningful
gap. The Refund Policy says requests outside its explicit conditions "require Billing
Ops approval and should be marked `requires_review` rather than auto-denied", except
where a request is "clearly outside condition 1 by more than 90 days", which "may" be
denied directly. The Escalation Policy independently routes "refund requests outside
the standard Refund Policy conditions" to Billing Ops. After `prohibited-refund` was
redesigned around condition 3 (see the entry above), no scenario reached that catch-all:
the mapping from `requires_review` to an escalation to `billing_ops` was covered only by
unit tests (`resolve.test.ts`), which cannot show whether a model marks such a request
`requires_review` or over-denies or over-approves it. Most real refund requests fall
outside 14 days, so this is the most common shape of refund the suite did not exercise.

**Decision made:** Add exactly one curated scenario, `out-of-window-refund`, appended
last in `prisma/data/scenarios.ts`, and no other. Expected outcome: intent
`refund_request`; agents `billing`, `policy`, `response`; policy `refund-policy`;
Policy decision `requires_review`, which `resolveOutcome()` (rule 3) turns into
action `escalate`, escalation true, target `billing_ops`. No policy text, resolution
rule, scorer, threshold, prompt, routing or classifier change was made.

**The facts, and why they map unambiguously to `requires_review`:** An annual Growth
subscription renewal charge of $3,564.00 (12 x the plan's $297.00 monthly rate), paid
45 days before the request, and a message that says so and asks to "request a refund of
that charge".
- 45 days is outside condition 1's 14 days with a wide margin, so the 14/15-day boundary
  and the whole-day rounding in the day count play no part.
- It is under 90 days on every reading of the exception: 45 days after the charge, and
  31 days beyond the 14-day window, so the direct-denial exception cannot apply.
- It matches no other explicit condition: one charge (no duplicate, condition 2), no
  usage-based `reason` (condition 3), and no downgrade or cancellation wording
  (condition 4). It therefore falls under the catch-all, whose instruction not to
  auto-deny is explicit. The request is 45 days after the charge on the seeded request
  time (`Ticket.createdAt`), so the Policy agent's day count is deterministic.
- The charge is annual on purpose. A monthly plan charged 45 days ago would also have a
  charge inside the window, and the Policy agent measures from the most recent charge.
- The message gives no reason for the refund. That avoids introducing a fact that could
  invoke another condition, and it avoids the "we're switching tools" phrasing: the
  seeded background template for that phrasing answers with a processed refund "per our
  policy", which conflicts with the catch-all, so a scenario built on it would inherit
  the seed world's inconsistency.

**Coverage this preserves and adds:** `legitimate-refund` (condition 1 approval),
`prohibited-refund` (condition 3 denial, the only scenario expecting `deny_request`) and
the duplicate-charge scenarios are unchanged. The new scenario is not a second
`deny_request` and not a second approval. It is the only scenario whose Policy outcome
is `requires_review`, and the only one that escalates to Billing Ops.

**Deliberately still not covered:**
- **Condition 4 (mid-cycle downgrade).** No agent prompt renders subscription, plan or
  renewal data, so "mid-cycle" and "current billing period" would rest only on the
  customer's words. `legitimate-refund` already contains "drop back to Starter", which
  invites cross-reading with condition 1. A clean scenario would have to sit past 14 days
  where the catch-all also plausibly applies. It would also only add another
  `deny_request`. It becomes worthwhile only if agents are given subscription state.
- **Requests more than 90 days past condition 1.** The policy says "may", so both
  `requires_review` and a direct denial comply. A single-action scorer cannot represent
  that, and the scorer was not changed to accept alternatives.
- **The "fewer than 5 login sessions" criterion.** No login data exists anywhere in the
  schema or seed, so it cannot be tested against data.

**Repository consistency:** The count moves from 10 to 11 only where a line specifically
described the curated scenarios (README, CLAUDE.md, PRODUCT_SPEC, ARCHITECTURE, the
`EVALUATION.md` current-status text and tables, the runbook, the dry-run and fixture
headers, one comment each in `scenarios.ts`, `ticketTemplates.ts` and the integration
test, and the e2e count assertion). The dry-run fixture set gained an entry that answers
the new scenario correctly (10 of 11 are correct; `known-technical-issue` remains the
deliberately wrong one). Historical records were annotated and not rewritten: the dry-run
results table (recorded on 10 scenarios), the pre-flight call-count estimate (computed for
10; the new scenario adds 4 nominal calls, for 39), and the earlier entries of this log.
Tests added or updated: a new `outOfWindowRefundScenario` suite (registration and order,
the fact constraints, request-time determinism including a fake future clock, and the
scenario's own fixture through the real orchestrator and scorer, expecting 1.00), a
`selectAgents` routing case, and the refund list and day counts in `scenarioRequestTime`.
The new tests were confirmed to fail when the charge age or the wording is broken.

**Seed side effects, measured on a scratch database only:** `seed.ts` draws one random
value per curated scenario before generating any background customer, so any added
scenario shifts the random stream for the background data. Appending last keeps the 10
existing scenarios' seeded data identical, which was verified field by field (10 of 10
identical), with invoice numbers excluded: they come from the last characters of a random
`cuid()` account id and already differ between any two seeds of the same code. The
background dataset does change, deterministically: 101 customers, 92 tickets (81 of them
background) and 435 invoices, against 100, 89 (79) and 432 before. Nothing in the tests or
docs pinned the old totals apart from the seed summary quoted in `ARCHITECTURE.md`, which
was updated.

**Not done / limits:** No live evaluation was run, and no project database was reseeded.
`dev.db` and `eval.db` still hold the 10-scenario seed. Reseeding `eval.db` (the
documented `npm run db:eval:setup`) erases its 10 recorded live results, so those should
be kept first. `npm run test:e2e` was not run, because it reseeds `dev.db`; its row-count
assertion was updated to 11 and is unexecuted. The scenario's outcome under a live model is
unmeasured: a model could still choose otherwise, and the classifier could still return
domains that add an agent or a different intent, as it has on other refund scenarios.

**When we'd reconsider:** If a live run shows the model systematically denying or
approving this request instead of marking it `requires_review`, investigate the Policy
agent's handling of the catch-all as a separate finding. If agents gain subscription state,
reconsider a condition-4 scenario. If the policy's over-90-day wording is made
unambiguous, reconsider representing it.

---

## 2026-09-20 — Public Demo Mode: a deterministic `DemoProvider` selected by `AI_MODE=demo`

**Context:** The app's only way to answer "Run AI analysis" was the real provider with
one server-side API key. A public deployment would either have no key, so every click
fails, or have one, so any anonymous visitor could spend it (roughly $0.02-0.04 and
10-20 seconds per click), and every click persists rows into one shared SQLite file.
The one no-key path, `e2eMockProvider.ts`, was a test fixture and unfit to promote: it
never looked at the ticket, so it answered EVERY ticket with the duplicate-billing
analysis (including a reply addressed to that ticket's customer); it had no Technical or
Risk responses and threw for them; and it was reachable in any deployment by setting
`USE_MOCK_MODEL_PROVIDER=true`, which replaced the whole production "anthropic" slot.
A read-only design audit also found two provenance defects that Demo Mode would have
turned into metric contamination: `persist.ts` treated only the key `"mock"` as
simulated ("anything else counts as real") while the ticket page treated anything but
`"anthropic"` as simulated, so a provider named `demo` would have been persisted as
real; and `persistFailedRun` always wrote `isSimulated = false`, so a demo-mode failure
would have counted as a real failure in AI Operations.

**Decision made:** Public Demo Mode is a new, production-safe `DemoProvider`
(`src/lib/ai/providers/demoProvider.ts`, key exactly `demo`), selected by the
server-only `AI_MODE=demo`. It implements the unchanged `ModelProvider` interface and
replays scripted responses from `src/lib/demo/recordings.ts`, so the real orchestrator,
routing, agents, resolution rules, response guard and persistence run unchanged and only
the model call is replaced.
- **`AI_MODE` (`src/lib/ai/mode.ts`):** `demo` selects Demo Mode; `live` or unset means
  live; any other value is an error, so a typo such as `AI_MODE=Demo` fails loudly and
  can never quietly reach a paid provider. Read on the server per call, never exposed as
  `NEXT_PUBLIC_*`.
- **Registry:** in demo mode the "anthropic" slot resolves to `DemoProvider` (the existing
  slot-override pattern; `modelRouting.ts` is untouched) and `AnthropicProvider` is never
  constructed, even if an API key is present. A previously cached real instance is not
  handed out either. The `USE_MOCK_MODEL_PROVIDER` branch and `e2eMockProvider.ts` are
  removed.
- **Provenance (`src/lib/ai/providers/provenance.ts`):** one shared rule, an allowlist of
  REAL providers (`anthropic`), so it fails closed: `demo`, `mock` and any provider not
  yet listed are simulated. `persist.ts` and the ticket page both use it, and
  `persistFailedRun` now derives its flag from the provider that would have served the run
  (treating an undeterminable one as simulated).
- **Persistence:** demo runs are persisted as ordinary runs with `isSimulated = true` and
  provider `demo` on every invocation. No schema change.
- **Entry point (`src/lib/orchestrator/requestAnalysis.ts`, called by the Server Action):**
  the ticket id is validated as a bounded string; in demo mode the ticket must exist and
  be one of the curated scenarios with a recording, and anything else is rejected before
  anything is persisted; a ticket gets at most one persisted demo run, whether it completed
  or failed (a completed run is returned as a replay, a failed run as its stored error, and
  a failed demo run is not retried); concurrent requests for a ticket share one in-flight
  run; an unexpected database error is returned as a failure, never as a success or a
  thrown error. Live behavior is `analyzeTicket()` exactly as before.
- **Evaluation:** `scripts/runEvaluation.ts` refuses to run under `AI_MODE=demo` (or an
  invalid value) as its first check.
- **UI (minimal):** a site-wide "Demo Mode" banner; the button reads "Run demo analysis"
  and is disabled with an explanation on uncurated tickets; a demo run is labeled a
  simulated demo replay; the Evaluations copy distinguishes Demo Mode from historical live
  results. No redesign.

**Why the test-only fixture was not promoted, and why `DemoProvider` is separate:** the
fixture's defects above are structural (one ticket's answer for all tickets, an env switch
that swaps the production slot, test-only assumptions), and a production path should not
inherit a test's reachability. An earlier decision (the dry-run harness entry) had already
rejected extending it, for the same reason of keeping its purpose single. Retiring it also
removes the only test-only provider from the production bundle, and the e2e suite now runs
the same Demo Mode a public deployment runs, so it tests what ships.

**Why the recordings are shared with the dry-run harness:** the harness already held
correct, deterministic responses for all 11 scenarios. Keeping a second copy for Demo Mode
would let the two drift, so the correct responses moved to `src/lib/demo/recordings.ts` and
`scripts/evaluationDryRunFixtures.ts` derives from them, adding back only its one deliberate
mutation (a wrong `known-technical-issue` answer that proves the scorer detects failures).
That wrong answer is never in the production recordings; the recordings carry a correct one
authored for this change. The move was checked to be lossless: all 11 harness fixtures were
byte-identical before and after. A test scores every recording through the real orchestrator
and scorer (using the provider `AI_MODE=demo` selects), which fails loudly if routing or a
scenario drifts.

**Why demo runs are persisted as simulated, and why replay is idempotent:** every page reads
persisted runs, and persistence is the product's stated principle ("nothing renders that
wasn't persisted"). Not persisting would need a separate client-side rendering path and lose
that fidelity; persisting unmarked would contaminate AI Operations. Persisting with
`isSimulated` uses what the schema and the Operations and Evaluations pages already do (they
exclude and disclose simulated runs, and demo creates no evaluation results). Because a demo
run is deterministic, a second one adds nothing, so a ticket gets at most one persisted
demo run. A failed demo run counts too and is deliberately not retried: an earlier version
looked only for a completed run, and a broken recording then added a failed row on every
click (reproduced: four clicks, four rows). This keeps the number of demo runs at or below
the number of curated tickets for a single server process, however often anonymous visitors
click, which is also why no rate limiter is needed (no paid call exists to protect). The
price is that a failed demo run stays failed until the database is reseeded. The guarantee
is enforced by a database lookup plus a process-local in-flight map, with no database
constraint, so it is a single-instance guarantee (see below); it is not multi-instance-safe.

**Demo Mode performs no external actions:** the scripted responses say things like "Refund
processed", and the resolution card shows `refund_customer`, but no refund, email, payment,
account change or any other external action is executed in any mode. The product only
proposes. The ticket page therefore says so beside the proposed response of every simulated
run ("Scripted draft only — no refund, email, payment, account change, or other external
action was actually executed"); the recordings themselves are unchanged. The Operations note
about excluded runs now describes them as Demo Mode scripted replays or fixture runs.

**Why `AI_MODE` defaults to live:** every documented local and evaluation workflow
(`npm run eval`, integration tests, private use with a key) keeps working unchanged, and a
public deployment opts in explicitly. The alternative, defaulting to demo, would make a
forgotten variable silently turn a live evaluation into scripted output. The cost of this
choice is that a public deployment that forgets `AI_MODE=demo` behaves as live; it is
mitigated by the deployment recipe (set `AI_MODE=demo`, never set `ANTHROPIC_API_KEY` on the
public host) and by the visible banner, and a live host without a key cannot spend anything.

**Why evaluation refuses Demo Mode:** the recordings are scripted and correct by
construction. An evaluation under demo mode would produce results that look like a
measurement and are not. Refusing is safer than tagging, because a run that is never
recorded cannot be mistaken for evidence.

**Honest framing:** Demo Mode shows the pipeline's structure and its deterministic logic with
scripted model responses, so it will always look correct. It is not evidence of model
performance; live evaluation results, failures included, are.

**Not done / limits:** No BYOK, authentication, rate limiter, Postgres, schema migration or
UI redesign. BYOK would need a per-request provider, which the process-wide registry does
not support, and is not blocked by this. No live evaluation was run and `eval.db` was not
touched. Historical live results are not shipped with the demo deployment yet (a separate
step), so the Evaluations page says none are included. The idempotency lookup and the
in-flight guard are per process and there is no database constraint, so a multi-instance
deployment could create more than one demo run per ticket (the check-then-insert can race
across processes); the public demo is explicitly single-instance. The Settings page still lists the live model
routing, which Demo Mode does not use, and the demo recordings' stated latency and cost are
zero because no model is called. The root layout reads `AI_MODE` when it renders, so the
static not-found page reflects the mode at build time.

**When we'd reconsider:** if BYOK or a live path is exposed to the public, add a rate limit
and revisit the provider registry for per-request providers; if demo replays should reflect
real model output, replace the scripted recordings with captured live outputs (data only,
labeled "recorded"); if a second real provider is added, list it in `REAL_PROVIDER_KEYS`.

## 2026-09-20 — Public deployment: explicit Demo Mode and a guarded initialization

**Context:** A read-only deployment audit of the Demo Mode commit found the app safe but not
deployable. A clean clone could not build: the Prisma client (`src/generated/prisma`) is
gitignored and nothing generated it. Nothing created a database either: `dev.db` and
`eval.db` are gitignored, `db:migrate` is `prisma migrate dev` (interactive, development
only) and `db:eval:setup` is hardcoded to `eval.db`. And an unset `AI_MODE` means live, so
a public host that forgot the variable would answer live (with a key configured, every
anonymous click would spend it, roughly $0.02-0.04 each; without one, one failed run row
per click).

**Decision made:** Change the deployment path only; no application behavior.
- **Prisma client:** `"postinstall": "prisma generate"`. It runs after every `npm install`
  and `npm ci`, so typecheck, tests, seed and build all find the client, and it needs no
  database URL. It needs devDependencies (`prisma`, `dotenv`), so the Replit build uses
  `npm ci --include=dev`. Verified in a scratch copy of the working tree holding only
  non-ignored files (the tracked files plus the new untracked ones; no `node_modules`,
  generated client, `.env` or database): `npm ci --include=dev` generated the client
  and `next build` passed with no database present.
- **Initialization:** `npm run db:init:demo` (`scripts/initDemoDatabase.ts`) runs the
  committed migrations with `prisma migrate deploy` (three migrations and a lock file
  already existed, so no migration system was invented) and then the existing seed
  (`prisma/seed.ts`), which is deterministic and rebuilds the 11 curated tickets,
  policies, fixtures and evaluation cases. It is non-interactive and idempotent. It is a
  new command; `db:seed`, `db:migrate` and the evaluation workflow are unchanged.
- **Guards, because the seed deletes its target:** `DATABASE_URL` must be set explicitly
  (no default, so it cannot fall back to `dev.db`) and be a SQLite file; a file whose name
  starts with `eval` (the repository's `eval.db` and `eval-<run>.db` files) or that
  `EVAL_DATABASE_URL` names is refused; and ANY existing database that already holds a real
  (non-simulated) run or evaluation result is refused, whatever its name, before migrating
  or seeding. The rules are pure functions in `src/lib/deploy/demoDeployment.ts`.
- **Explicit Demo Mode:** `npm run start:demo` (`scripts/startDemo.ts`) is the public entry
  point. It applies the same guards, forces `AI_MODE=demo`, blanks `ANTHROPIC_API_KEY` in
  the server's environment, initializes the database, then runs `next start` (which honors
  `PORT` and binds `0.0.0.0`). The key is blanked, not deleted, because `next start` loads
  `.env` and fills in any variable that is undefined (checked by calling the `@next/env`
  loader directly against a temporary `.env` holding a fake value: a deleted key was
  re-read from it, an empty one was not; a full `next start` against a `.env` file was
  not run). The application default is unchanged (unset still
  means live) and Demo Mode is not hardcoded into the app; only the public start command
  states it.
- **Initialize on every start:** the deployment filesystem may not persist between restarts,
  so each start begins from the same deterministic dataset; demo runs reset on restart.
  The demo database is `demo.db` (gitignored).
- **`.replit`:** build `npm ci --include=dev && AI_MODE=demo npm run build`; run
  `DATABASE_URL=file:./demo.db npm run start:demo`; Reserved VM (`gce`, one instance);
  port 3000 to 80. The build also sets `AI_MODE=demo` because the root layout reads the
  mode at render time, so the statically prerendered pages (the 404 page) carry the Demo
  Mode banner only if the mode is set at build time. No `replit.nix`: nothing needs it
  unless `better-sqlite3` lacks a prebuilt binary for the platform (unverified).
- **Node:** `engines` is `^20.19.0 || ^22.12.0 || >=24.0.0`, Prisma 7's own range
  (`better-sqlite3` supports 20 to 26, Next.js 16 needs 20.9 or later).

**Why not the alternatives:** *A `prebuild` hook in addition to `postinstall`* adds nothing
once install always generates. *Seeding at build time* depends on the build's filesystem
reaching the runtime container, which cannot be verified here. *A bare `AI_MODE=demo` in
the Replit environment* is exactly the forgettable configuration the audit flagged.
*Reusing `db:seed` directly* would run against whatever `DATABASE_URL` (or the `dev.db`
default) names, with no evidence check.

**Not verified / limits:** `.replit` was written without access to Replit and has not run
there (the module name, the `gce` target and the port keys follow Replit's documented
format from general knowledge). The single-instance guarantee for one demo run per ticket
still rests on the process-local guard (see the Public Demo Mode entry); the Reserved VM
target is what makes it hold. The guard against real evidence is a check-then-act, not a
lock: it protects against mistakes, not concurrent writers.

**When we'd reconsider:** if the demo needs more than one instance, add a database
constraint for one demo run per ticket; if the deployment filesystem persists, initialize
at build instead of every start; if live evaluation results are shipped with the demo,
they need their own import step (the seed clears results, and this guard would refuse a
database that contains them).

## 2026-09-23 — Design foundation: semantic tokens, presentation labels, and a decision-first ticket page

**Context:** Two Design Lead audits (AUDIT.md, Audits #6 and #7) found the app functionally
sound but visually a generic scaffold. Measured defects: muted text was a fixed `zinc-500`
in both color schemes (3.7-4.1:1 in dark mode, below WCAG AA) and some secondary text was
`zinc-400` on white (2.56:1); `<body>`'s color classes in `layout.tsx` were dead, overridden
by `globals.css`; the nav was the same color as the page in dark mode; and unused `--radius-*`
tokens in `:root` were silently overriding Tailwind's `rounded-md`/`rounded-lg` scale. The
ticket page, the product's centerpiece, showed the agent trace first and the decision last,
rendered canonical values raw (`refund_customer`, `trust_and_safety`), and often printed the
same sentence twice (resolution summary and escalation reason share one value on several
`resolve.ts` paths).

**Decision made:** A presentation-only pass. No orchestration, routing, resolution,
evaluation, policy, provider, Demo Mode or data change.
- **Primitives, not a library:** `src/components/ui/` (`Card`, `Badge`, `SectionHeading`/
  `Eyebrow`, `Stat`) over one semantic tone map (`tone.ts`: neutral, info = blue,
  success, warning, danger; no purple or indigo). This answers "Deferring a UI component
  library" for now: the app needs consistent panels and badges, not interactive widgets, so a
  small in-house layer is enough.
- **Neutral tokens, one source:** `globals.css` defines `background`, `foreground`, `surface`,
  `border`, `muted-foreground` and elevation for both schemes and wires them into Tailwind via
  `@theme inline` (`bg-surface`, `border-border`, `text-muted-foreground`, and a dark-aware
  `shadow-sm`). Status colors stay in `tone.ts` only; the duplicate CSS variables and the
  colliding radius tokens were removed. `surface` is reserved for context and decision panels
  (sidebar, the ticket's customer/account aside, the recommendation), not every card.
- **Elevation is reserved:** exactly one surface uses `shadow-sm`, the ticket's
  recommendation panel. Ordinary cards separate by border. A global shadow would make a stack
  of agent cards noisy, and shadows barely register in dark mode, where `surface` carries the
  lift.
- **Presentation labels are separate from canonical values:** `src/lib/labels.ts` maps every
  canonical value an operator sees (status, priority, channel, action, team, intent, severity,
  sentiment, policy decision, agent names, account/invoice fields, agent flags) to a label.
  The canonical values stay the contract for the database, orchestrator, resolution rules and
  evaluation scorer; nothing compares against a label, so a wording change can never change
  behavior or a score. Maps over schema enums are typed `Record<Enum, string>`, so a new
  taxonomy value without a label fails the typecheck; open vocabularies fall back to a
  humanizer. Canonical values stay visible where comparing them is the point (the Evaluations
  table's expected/actual columns, eval scenario keys).
- **Decision-first ticket page:** the AI section reads recommendation (action, team,
  severity, human review, confidence, one reason) → draft reply (marked "Not sent", scripted
  disclaimer unchanged) → "How this was decided": a Classified → Routed → Resolved → Drafted
  pipeline strip built only from persisted run data, with the full per-step agent trace in a
  native `<details>`, closed by default. The escalation reason is shown only when it differs
  from the resolution summary. A simulated step's machine detail says "not called" instead of
  its recorded `0ms`/`$0`.
- **Policy citations link to Knowledge:** `/knowledge#policy-<slug>`, using the existing unique
  `Policy.slug`, and only when that policy exists; no new route.
- **Provenance is not reduced:** the run-level SIMULATED notice, per-step "simulated
  (provider)" badges, the site banner and the exclusion of simulated runs from Operations
  metrics are unchanged, even where visually repetitive, because a run may mix providers.

**Verification:** contrast measured in the browser (every visible text element, real
foreground against its resolved background, WCAG AA thresholds) on the ticket page, Inbox and
Operations in both schemes: 0 failures; the check itself flags a control sample at 2.56:1.
Typecheck, lint, 417 unit tests, the `AI_MODE=demo` build and 14 E2E tests pass. E2E asserts
the new contract: decision above the trace, labels (and no taxonomy identifier) on the page,
the draft marked not sent, the trace collapsed by default, and a working policy link.

**Why not the alternatives:** *Adopt shadcn/ui now* adds a dependency and a theme system for
components the app does not have. *Label with ad hoc string replacement per page* would drift
and could not be checked for completeness. *Rename canonical values to read well* would touch
the schema, prompts, recorded demo responses and evaluation expectations for a wording
change. *Shadows on every card* would make the decision panel stop standing out.

**Not done / limits:** a Knowledge "arrival" highlight was built and removed: Next's
client-side navigation uses `pushState`, which does not update `:target`, so it only showed on
a full page load (it needs a small client-side hash listener). Some recorded agent evidence
quotes billing reason codes verbatim (`api_overage`, `insufficient_funds`); that is recorded
text, left as-is. Navigation, the Operations Demo Mode empty state, `not-found`/`error` pages,
loading states and motion are separate passes (TODO.md).

**When we'd reconsider:** if interactive components are needed (menus, dialogs, comboboxes),
revisit a component library; if a canonical value's wording must change for product reasons,
change it deliberately across schema, prompts, recordings and evaluation, never via a label.

## 2026-09-23 — Application navigation: grouped destinations, route-aware active state, no icons

**Context:** The sidebar was a flat list of five text links with no active state, no product
identity ("AI Support Ops Copilot"; Halcyon appeared nowhere) and no grouping (AUDIT.md,
DES-10). Two facts from the repository shaped the change: ticket detail lives at
`/tickets/[id]`, a sibling of `/inbox` rather than a child, and the project has no icon library
(direct or transitive) and no inline SVG.

**Decision made:** A shell-only change; no route, data or behavior change.
- **Grouped by the operator's work:** Operations (Inbox), AI Operations (Operations,
  Evaluations), Knowledge (Knowledge), Administration (Settings). The model lives in
  `src/lib/navigation.ts` as pure data plus `navItemState()`; a unit test checks that every
  destination is an existing `src/app` route.
- **Tickets belong to the Inbox area without moving the route:** `/tickets/*` is declared as
  part of Inbox's section (`sectionPrefixes`). Moving ticket pages under `/inbox/[id]` would
  change every ticket URL, link and test for a navigation concern. Prefixes match whole path
  segments only.
- **Active state:** `aria-current="page"` on the destination itself, `aria-current="true"` on
  Inbox while a ticket is open (the ticket is inside the Inbox area, not the Inbox page).
  Visually a fill, a heavier weight and a leading bar, so it never depends on color alone.
- **Minimal client boundary:** only `NavLink` is a client component, reading Next's
  `usePathname()`; no state or effects. The shell stays a server component.
- **Semantics:** the sidebar is a `div`, not `<aside>`, because the ticket page's context panel
  is already the page's complementary landmark. Group labels are not headings (they would
  enter every page's heading outline and collide with page titles such as "AI Operations");
  each list takes its accessible name from its visible label via `aria-labelledby`. The
  Halcyon identity sits outside `<nav>`, because it is not navigation.
- **Identity:** "Halcyon" with "Support Ops Copilot" beneath it, as text. No logo, tagline or
  claims.
- **No icons:** with five labelled destinations in named groups, icons add little scanning
  value, and the only way to get them is a new dependency or hand-drawn SVGs. Labels carry the
  meaning alone.
- **Surfaces:** the existing `surface` and `border` tokens (see "Design foundation"); the
  active and hover fills are nav-local zinc steps above `surface`. No new tokens, no shadow.
  Links gained a visible `focus-visible` ring in the foreground color. Sidebar width (`w-56`)
  and link padding are unchanged, so page content starts at the same position on every route.

**Verification:** typecheck, lint, 424 unit tests (7 new, navigation model), the
`AI_MODE=demo` build and 15 E2E tests (1 new: every destination marks exactly one current link,
and a ticket marks Inbox as its section). In the browser, both schemes: correct active state on
all six page types, nav text at least 4.63:1 (light) and 6.91:1 (dark), focus ring visible
under keyboard Tab, main content left edge constant at 224px.

**When we'd reconsider:** add icons if the navigation grows to where scanning labels becomes
slow, choosing one library with one stroke weight; move tickets under `/inbox` only if the
Inbox gains its own nested views (filters, queues) that tickets should inherit.

## 2026-09-23 — AI Operations in Demo Mode: explain the exclusion, never fill the gap

**Context:** AI Operations' run metrics count real-model runs only: the page filters out
`isSimulated` runs before computing runs, failures, escalation and containment rates,
invocations, invocation failure rate, estimated cost and usage by pipeline step (ticket volume
reads the `Ticket` table and is unaffected). In the public Demo Mode deployment every run is
simulated, so a visitor saw zeros, dashes and `$0.0000` with the instruction "run AI analysis on
a ticket", which in Demo Mode can never fill the page (AUDIT.md, DES-23). Two lines had also
become inaccurate: the subtitle called the data "live/demo activity" (wording from "Why
live/demo metrics are separated from evaluation metrics", written before Demo Mode existed,
where "demo" meant in-app traffic), and the simulated-run note pointed to the Evaluations page,
where Demo Mode replays never appear.

**Decision made:** Demo Mode explains why simulated activity is excluded from operational
metrics; it never presents simulated activity as operational activity and never fills the page
with invented numbers. No query, filter, metric or data change.
- **Three states** (`src/lib/operationsState.ts`, unit-tested): Demo Mode with no real-model
  runs shows one explanation; real-model runs in either mode show the normal dashboard; live
  mode with nothing run yet shows no Demo Mode explanation, because Demo Mode is not the reason.
- **One explanation, in the existing vocabulary** ("Demo Mode", "scripted replays", "simulated
  runs", "real model"): why the run metrics are empty, how many simulated runs were excluded,
  and a link to the Inbox, the existing place where a demo analysis can be run. The site banner
  and per-run provenance are unchanged; no badge is repeated.
- **Zero versus unavailable, unchanged:** counts stay `0` (zero qualifying runs is a true count),
  rates stay `—` (undefined with nothing to divide by) and cost stays `$0.0000` (no real model
  spend). These were already truthful, so the explanation contextualizes them instead of
  replacing them.
- **Copy corrected:** the subtitle now says the run metrics count real-model runs only, and the
  simulated-run note no longer points to Evaluations.

**Why not the alternatives:** *Count simulated runs in Demo Mode* makes scripted replays look
like operational activity and breaks the provenance rule. *Hide the metrics in Demo Mode* hides
a true fact (nothing real has run) and makes the page stop reading as an operations dashboard.
*Show `—` for every zero* would claim counts are unknown when they are known to be zero.

**Verification:** 428 unit tests (4 new, all three states) and 15 E2E tests: the demo run is
excluded (the run metric reads a literal `0`), the explanation names Demo Mode, the excluded
count stays exact across idempotent replays, and the link opens the Inbox. The E2E suite runs in
Demo Mode only, so the live-mode states were checked in the browser without creating data:
live mode against the seeded database (no explanation, since Demo Mode is not the reason) and a
scratch copy of the evaluation database, which holds real-model runs (normal dashboard in both
modes). The original evaluation databases were checksummed before and after and are unchanged.

## 2026-09-23 — Application not-found and error states

**Context:** A missing page, an unknown ticket id and a failed render all showed Next.js's
built-in pages, which look like a different product and say nothing useful to an operator
(AUDIT.md, DES-24). The architecture decides where each state can live: one root layout, no route
groups, no dynamic top-level segment; the ticket page already calls `notFound()` for an unknown
id; and the root layout itself can throw, because its Demo Mode banner reads `AI_MODE` and an
invalid value (for example `AI_MODE=Demo`) throws by design (`src/lib/ai/mode.ts`).

**Decision made:** Three files at the root of `src/app`, sharing one layout component
(`src/components/app-state.tsx`) that uses the same header rhythm as every page. No new
dependency, icon, illustration or color.
- **`not-found.tsx`** handles every unmatched URL and every `notFound()` call, including the
  ticket page's, so there is one not-found meaning. It renders inside the root layout, so
  navigation stays. It is not framed as a failure: no "error" wording and no retry, just a link
  to the Inbox. The copy says a link "may be mistyped or out of date", which is also the real
  cause of a stale ticket link here: the demo database is rebuilt with new ids on each restart.
- **`error.tsx`** is the root segment's error boundary. It wraps every page but not the root
  layout, so a failed page (for example a database read) keeps the navigation and the Demo Mode
  banner. It never catches `notFound()`: Next re-throws router signals past error boundaries.
- **`global-error.tsx`** covers the one thing `error.tsx` cannot: a failure in the root layout.
  It replaces the layout, so it renders its own document, styles and fonts (the fonts now live in
  `src/app/fonts.ts`, shared with the layout) and has no navigation to keep, since the layout
  that renders it is what failed. For the same reason it offers only "Try again".
- **Recovery is `retry()`**, Next 16's boundary callback that refreshes the route's server data
  (`router.refresh()`) and then re-renders the segment. `reset()` would only re-render, which
  repeats a failed server render. The boundary also clears on navigation, so the nav and the
  "Go to the Inbox" link recover too; that link is omitted when the failing page is the Inbox.
- **No internal details:** the error's message is never rendered (it can contain paths,
  queries or configuration, and the UI cannot know the cause). The copy is only "Something went
  wrong". The one detail shown is Next's `digest`, an opaque id that matches the server log
  entry, as an error reference. Focus moves to the state's heading when it appears.

**Why not the alternatives:** *Per-route `error.tsx` files* would duplicate one behavior five
times. *`global-not-found.js`* (experimental) exists for apps whose layouts cannot compose a 404,
which is not this app, and it would drop the navigation. *Showing the error message* would help
debugging and leak internals. *Relying on `error.tsx` alone* would leave root-layout failures on
the framework page.

**Verification:** 5 unit tests render the boundary contract in node (heading, recovery
controls, the Inbox link omitted on the Inbox, digest only when present, and a message containing
a Prisma error, a file path and a key-shaped string never reaching the markup); 2 E2E tests (an
unknown URL and an unknown ticket id both return 404 and render the state inside the shell).
Browser, on production builds, with real failures and no code changes: a server pointed at an
empty scratch database showed the error state inside the shell with focus on its heading; after
the database was initialized underneath the running server, "Try again" (by keyboard) rendered the
real Inbox, proving `retry()` re-fetches; navigating from a failed page cleared the boundary; the
displayed error reference matched the server log. A server with `AI_MODE=Demo` showed the
global error state with its own title and fonts, without mentioning `AI_MODE`. Contrast measured in
both schemes for all three states: 0 WCAG AA failures.

**Not done / limits:** `global-error.tsx` only appears in production builds (development shows
Next's error overlay). For `notFound()` thrown by the dynamic ticket page, Next returns the 404
with the state in the page payload rather than the initial HTML, so it needs JavaScript to
display, and the document title settles on the layout's default rather than "Page not found"
(TODO.md).
