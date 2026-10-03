# Agent 479

A local discovery platform for Northwest Arkansas (Bentonville, Rogers,
Springdale, Fayetteville, Bella Vista). It's an events site and a weekly
digest, kept up to date mostly by scheduled agent jobs, with humans reviewing
only the edge cases.

- Design and build order: [docs/PHASE1_PLAN.md](docs/PHASE1_PLAN.md)
- Before the first production deploy: [docs/PREDEPLOY_CHECKLIST.md](docs/PREDEPLOY_CHECKLIST.md)
- Conventions for coding agents: [AGENTS.md](AGENTS.md)

## Stack

Next.js 16 (App Router, TypeScript) on Vercel, Supabase Postgres with Drizzle,
Vercel Cron, OpenAI behind a provider-agnostic wrapper, Vitest.

## Local setup

Requires Node 24+.

```bash
npm install
cp .env.example .env.local   # fill in values (Supabase project: agent-479)
npm run dev                  # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Unit tests (Vitest, offline) |
| `npm run test:db` | DB integration tests against `.env.local` (always rolled back) |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm run db:generate` | Generate a SQL migration from schema changes |
| `npm run db:migrate` | Apply pending migrations (never use `push`) |
| `npm run db:verify` | Check the live DB: UTC, extensions, tables, RLS on every table |
| `npm run db:studio` | Browse the DB with Drizzle Studio |
| `npm run db:seed:llm` | Seed/update `llm_models` (idempotent, logged) |
| `npm run llm:smoke` | One real LLM call to check key, model, and cost logging (needs `OPENAI_API_KEY`) |
| `npm run venues:verify` | Check `data/venues.seed.json` and write `data/venues.report.md`; add `-- --geocode` to cross-check addresses (needs `BOT_CONTACT_EMAIL`) |
| `npm run venues:seed` | Seed venues from the signed-off seed file (idempotent, logged) |

## Cron jobs

`vercel.json` has no crons yet on purpose. They're added in later build
steps. The planned schedule is in the plan, section 7.
