# Pre-deploy checklist

Complete every item before the **first production deploy**. Re-check the items
marked (every deploy) each time.

## Identity

- [ ] A real domain is registered and attached to the Vercel project.
- [ ] `SITE_URL` in Vercel Production env is that domain (not localhost).
- [ ] `BOT_CONTACT_EMAIL` in Vercel Production env is a real, monitored
      address (not a personal address you don't want published in other
      sites' logs).
- [ ] A `/bot` page on the site explains what Agent479Bot fetches and how to
      opt out.

## Secrets (every deploy)

- [ ] All keys from `.env.example` are set in Vercel Production env.
- [ ] `CRON_SECRET` and `ADMIN_PASSWORD` are long random values, different
      from local ones.
- [ ] `LLM_DAILY_BUDGET_USD` is set.

## Sources

- [ ] Every enabled source has `commercial_use_ok` and `terms_notes` filled in.
- [ ] Walton Arts Center, Crystal Bridges, and the Momentary are still
      `enabled = false` unless written permission has been received and
      recorded in `terms_notes`.
- [ ] `crystalbridges.org` and `themomentary.org` are `homepage_only` in
      `link_policies` unless deep-link permission has been received.
- [ ] If the site carries any sponsorship or paid placement: Ticketmaster
      written approval is on file, or Ticketmaster-sourced listings are
      disabled (their API terms forbid API-derived revenue).

## Data

- [ ] Decide whether development keeps sharing the production database
      (Supabase project `agent-479`). If not, set up a dev branch or a
      separate dev project, and point `.env.local` at it.
- [ ] `npm run db:verify` passes against production.
- [ ] All Drizzle migrations are applied to the production Supabase project
      (`drizzle-kit migrate`, never `push`).
- [ ] Supabase: Data API exposure of the `public` schema is turned off (or
      confirmed that every table has RLS enabled with no anon/authenticated
      policies). Checked by querying with the anon key: it must return nothing.
- [ ] Supabase: `DATABASE_URL` uses the transaction pooler (port 6543) and
      `DATABASE_URL_UNPOOLED` uses the direct or session connection.
- [ ] The venue seed has your sign-off.
- [ ] The `llm_models` rows have current pricing, with `pricing_checked_at`
      within 30 days.

## Jobs

- [ ] `vercel.json` crons match plan section 7.
- [ ] `/api/cron/maintenance` is scheduled daily. It is the only thing that
      purges stored source descriptions (AGENTS.md rule 4).
- [ ] Each cron route rejects requests without the bearer secret (checked
      manually).
- [ ] `/admin/*` returns 401 without credentials (checked manually).
