# AI Support Operations Copilot

An AI-powered support operations copilot for **Halcyon**, a fictional B2B
SaaS company — built to demonstrate product thinking, AI systems design,
customer-operations judgment, and an evaluation-first approach to building
AI features, not just a multi-agent demo.

Start here:

- [PRODUCT_SPEC.md](PRODUCT_SPEC.md) — what this is and who it's for
- [ARCHITECTURE.md](ARCHITECTURE.md) — how it's built
- [DECISIONS.md](DECISIONS.md) — why it's built this way
- [EVALUATION.md](EVALUATION.md) — how the AI is measured, not just demonstrated
- [TODO.md](TODO.md) / [AUDIT.md](AUDIT.md) — current status and backlog
- [CLAUDE.md](CLAUDE.md) — the operating manual for working in this repo

## Getting started

```bash
npm install
npm run db:migrate   # create the local SQLite database
npm run db:seed      # deterministic synthetic data — see ARCHITECTURE.md
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Unit tests (Vitest) — no database, no network |
| `npm run test:integration` | Integration tests against the real local database |
| `npm run test:e2e` | Regression tests against a production build (Playwright) |
| `npm run eval` | Run the 10 curated scenarios against the real orchestrator and score them — requires `ANTHROPIC_API_KEY` |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Regenerate the deterministic synthetic dataset |
| `npm run db:studio` | Browse the local database |

Copy `.env.example` to `.env` before running anything that touches the
database. `ANTHROPIC_API_KEY` is only required for live "Run AI analysis"
in the app and for `npm run eval` — everything else (including all
automated tests) runs without one.
