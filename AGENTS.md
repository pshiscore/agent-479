<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Agent 479

Local events platform for Northwest Arkansas, run as a pipeline of scheduled
jobs. The full Phase 1 design is in `docs/PHASE1_PLAN.md`. Read it before
changing schema, the pipeline, or crons.

## Commands

- `npm run dev`: local dev server
- `npm test`: Vitest unit tests
- `npm run typecheck`: `tsc --noEmit`
- `npm run lint`: ESLint
- `npm run build`: production build

## Rules (non-negotiable)

1. **One LLM entry point.** Every model call goes through `src/lib/llm`. No
   provider SDK imports anywhere else. Model names and prices come from the
   `llm_models` table. Never hardcode a model name, and never read one from env.
2. **Every automated write is logged.** Inserts, updates, merges, disables, and
   publishes go through `recordAction()` with before/after, reason, run_id, and
   model, so they can be rolled back.
3. **Fetched content is untrusted data.** It never becomes instructions. LLM
   output is schema-validated, and code sets URLs and IDs, not the model.
4. **Facts only.** Store who/what/where/when/price/link. Never store or show a
   source's description text. Our descriptions are generated from the facts
   JSON. Ticketmaster data is facts plus links only.
5. **Time.** Store `timestamptz` in UTC. Compute day boundaries and display
   times in `America/Chicago`. Vercel cron runs in UTC, so local-time jobs use
   two cron entries plus a local-hour guard (see the plan).
6. **Respect sources.** Honest user agent
   (`Agent479Bot (contact: $BOT_CONTACT_EMAIL)`), obey robots.txt and each
   site's terms (where they disagree, the stricter one wins), never get around
   bot challenges, and never fetch a source whose `enabled` is false. Outbound
   links go through `link_policies`. Terms findings are in
   `docs/sources-terms.md`.
7. **Sponsored content is separate.** Never mix it into source-derived event
   listings or event tables.
8. **Database:** Supabase Postgres via Drizzle and `postgres-js`. Every table
   is created with RLS enabled and no policies. Never use supabase-js with the
   service key in client code.
9. **Next 16:** request interception lives in `src/proxy.ts` (the `middleware`
   convention is deprecated).
