# AI Support Operations Copilot

An AI-powered support operations copilot for **Halcyon**, a fictional B2B
SaaS company — built to demonstrate product thinking, AI systems design,
customer-operations judgment, and an evaluation-first approach to building
AI features, not just a multi-agent demo.

**Live demo:** https://ai-support-operations-copilot-production.up.railway.app

The public deployment runs in deterministic [Demo Mode](#two-modes-demo-and-live):
synthetic data, scripted replays, no API key and no live model calls. The recorded
2026-09-24 live evaluation is on its Evaluations page.

Start here:

- [PRODUCT_SPEC.md](PRODUCT_SPEC.md) — what this is and who it's for
- [ARCHITECTURE.md](ARCHITECTURE.md) — how it's built
- [DECISIONS.md](DECISIONS.md) — why it's built this way
- [EVALUATION.md](EVALUATION.md) — how the AI is measured, not just demonstrated
- [TODO.md](TODO.md) / [AUDIT.md](AUDIT.md) — current status and backlog
- [CLAUDE.md](CLAUDE.md) — the operating manual for working in this repo

## Two modes: Demo and live

| | **Demo Mode** (public demo) | **Live / private mode** (default) |
|---|---|---|
| Selected by | `AI_MODE=demo` | `AI_MODE` unset or `live` |
| "Run AI analysis" | Replays scripted responses, deterministically | Calls the configured model provider (Anthropic) |
| Needs `ANTHROPIC_API_KEY` | **No.** A key in the environment is ignored | **Yes** |
| Which tickets | The 11 curated scenarios only; any other ticket is blocked | Any ticket |
| Stored as | Simulated (`isSimulated`), excluded from real metrics | Real |
| External effects | None | None (a drafted reply is text only) |

**Demo Mode** shows the pipeline's structure and its deterministic logic (classification,
dynamic agent selection, specialist findings, resolution rules, escalation, the drafted
reply) with scripted model responses. It makes no model call, needs no API key, and every
run is labeled and persisted as **simulated**. Nothing is refunded, emailed, charged or
changed: the analysis produces a drafted response and a recommended action, and stops
there. Because the scripted output always looks correct, it is not evidence of model
quality, and it is never written to the evaluation results.

**Live / private mode** uses a real model and needs `ANTHROPIC_API_KEY` in `.env`. It is
for local and private use and is not what the public demo runs. The live evaluation is
separate from Demo Mode: see [Evaluation](#evaluation).

## Security & Demo Mode

This is a **demonstration project** with **synthetic data only**.

- The public demo cannot call a real LLM. It replays scripted responses.
- No visitor input is accepted.
- All customer data is fictional.
- Do not enter real customer data into a local or live-mode deployment.
- Keep `ANTHROPIC_API_KEY` and other secrets in `.env` or another secret manager; never commit them.

**If you fork this for live mode:**

- Treat ticket content as untrusted data and add explicit prompt/data delimiters before sending it to a live model.
- Prompt injection is a known limitation that requires additional safeguards and testing.
- Review authentication, authorization, rate limiting, logging, data retention, and human-approval controls before handling production data.
- The application does not perform refunds, send emails, charge customers, or execute external actions; verify any future integrations independently.

## Local development

```bash
npm install          # also runs `prisma generate` (postinstall) to create the Prisma client
[ -f .env ] || cp .env.example .env  # only if you have no .env yet; an existing one is never overwritten
npm run db:migrate   # create the local SQLite database (dev.db)
npm run db:seed      # deterministic synthetic data, see ARCHITECTURE.md
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Requires Node `^20.19 || ^22.12 || >=24`.

- **Try Demo Mode locally, no key needed:** set `AI_MODE=demo` in `.env` (or run
  `AI_MODE=demo npm run dev`). A banner says "Demo Mode" and the button reads
  "Run demo analysis".
- **Use live mode:** leave `AI_MODE` unset and set `ANTHROPIC_API_KEY` in `.env`.
  Never commit `.env`.
- `npm run db:seed` **deletes and regenerates** the database `DATABASE_URL` points at.
  Do not point it at an evaluation database.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Unit tests (Vitest): no database, no network |
| `npm run test:integration` | Integration tests against the real local database (and scratch databases) |
| `npm run test:e2e` | Regression tests against a production build (Playwright), run in Demo Mode |
| `npm run eval` | Run the 11 curated scenarios against the real orchestrator and score them. Live mode only: requires `ANTHROPIC_API_KEY`, refuses `AI_MODE=demo` |
| `npm run eval:dry-run` | Run the same scenarios through scripted fixtures (no key). Results are marked simulated |
| `npm run db:eval:setup` / `npm run dev:eval` | Create the separate evaluation database (`eval.db`) / browse it in the app |
| `npm run db:migrate` | `prisma migrate dev` (development) |
| `npm run db:seed` | Regenerate the deterministic synthetic dataset in `DATABASE_URL` |
| `npm run db:init:demo` | Deployment initialization: `prisma migrate deploy` + seed on an explicit, guarded `DATABASE_URL` |
| `npm run start:demo` | Public demo entry point: forces Demo Mode, blanks the API key, initializes the database, starts the server |
| `npm run db:studio` | Browse the local database |

## Replit deployment

The [live demo](#ai-support-operations-copilot) runs on Railway: one service, one
replica, `npm run start:demo` with `AI_MODE=demo` and `DATABASE_URL=file:./demo.db`, and
no persistent volume. The same Demo Mode deployment can also run as a single Replit
instance, configured by [`.replit`](.replit):

| Step | Command |
|---|---|
| Build | `npm ci --include=dev && AI_MODE=demo npm run build` |
| Run | `DATABASE_URL=file:./demo.db npm run start:demo` |
| Deployment type | Reserved VM (`gce`): one instance |
| Port | 3000 (Next.js default; `PORT` is honored) mapped to 80 |

**Flow:** `npm ci` installs dependencies and generates the Prisma client (dev dependencies
are needed for `prisma` and `tsx`). The build runs with `AI_MODE=demo`, so the statically
rendered pages carry the Demo Mode banner too. On every start, `start:demo` initializes
`demo.db` (migrations, then the deterministic seed: the 11 curated tickets, policies,
fixtures and evaluation cases) and then serves the app, so Demo Mode is usable immediately.

**Environment variables:**
- Required: none beyond what `.replit` sets. `start:demo` sets `AI_MODE=demo` itself, and
  `DATABASE_URL` is set in the run command.
- **Do not configure `ANTHROPIC_API_KEY`** (as a secret or otherwise). The public demo
  needs no key, and `start:demo` blanks it for the server even if one is present.
- Optional: `PORT`.

**Safety properties:** the initialization refuses to run against an evaluation database
(any `eval*.db`, or the file `EVAL_DATABASE_URL` names) and against any database that
already holds real (non-simulated) results. It never touches `eval.db`.

**Limitations:**
- **Single instance.** The one-demo-run-per-ticket guarantee is enforced per server
  process, so do not use a multi-instance (Autoscale) deployment.
- **SQLite and an ephemeral filesystem.** The database is a local file that is rebuilt
  on every start. Demo runs are lost when the instance restarts, which is fine for a demo:
  they can be re-run.
- `.replit` was written without access to Replit and is untested there. If a deployment
  misbehaves, check its module name, deployment type and port keys first.

The public demo's URL is listed at the top of this README.

## Evaluation

The evaluation suite (`npm run eval`) runs the 11 curated scenarios through the real
orchestrator and a real model, and scores each against hand-authored expected outcomes.
See [EVALUATION.md](EVALUATION.md).

- **Live evaluation evidence and Demo Mode are different things.** Demo Mode replays
  scripted responses that are correct by construction. Its runs are stored as simulated,
  the evaluation script refuses to run under `AI_MODE=demo`, and demo runs are never
  evaluation results.
- The live baseline is produced and kept **separately** from the app's demo database. It
  is written to its own evaluation database (by default `eval.db`, gitignored, or
  `EVAL_DATABASE_URL`), so re-seeding the development or demo database cannot destroy it.
  The public demo's Evaluations page therefore shows the 2026-09-24 live run as a dated,
  fixed record committed with the application (exported read-only from its evaluation
  database; see EVALUATION.md, "Current status"), separately from the deployment's own
  evaluation state, which in Demo Mode is empty.
- `npm run eval` costs real money (a full run is on the order of $0.20) and needs a key,
  so run it deliberately, never in CI or automated tests.

Create `.env` from `.env.example` (only if you do not already have one) before running anything that touches the database.
`ANTHROPIC_API_KEY` is only required for live "Run AI analysis" and `npm run eval`.
Demo Mode, seeded browsing and all automated tests run without one. The integration
tests load `.env`, so if your `.env` contains a key, run them with it blanked:
`ANTHROPIC_API_KEY= npm run test:integration`.
