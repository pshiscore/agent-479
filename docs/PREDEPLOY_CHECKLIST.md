# Pre-deploy checklist

Complete every item before the **first production deploy**. Re-check the items
marked (every deploy) each time.

## Identity

- [x] A real domain is registered: **479.guide** (site name "479 Guide";
      "Agent 479" stays the agent's and bot's name). Owner, 2026-10-04.
- [ ] 479.guide is attached to the Vercel project (Cloudflare DNS).
- [ ] `SITE_URL=https://479.guide` in Vercel Production env and `.env.local`.
- [x] Contact address: **bot@479.guide**, forwarding to the owner's inbox.
      Owner, 2026-10-04.
- [ ] `BOT_CONTACT_EMAIL=bot@479.guide` in Vercel Production env and
      `.env.local`; a test email to it arrives.
- [x] `/bot` explains what Agent479Bot fetches, how often, and how to opt
      out; it's public even while the site is locked. The fetch user agent is
      `Agent479Bot/1.0 (+https://479.guide/bot; bot@479.guide)`.
- [ ] Opt-out requests are handled with `npm run sources -- opt-out <slug>
      --reason "..."` (a logged disable; re-enabling needs a reason starting
      "Permission").

## Site lock (until launch)

- [ ] `SITE_LOCKED=true` in Production. (Production is locked unless it's
      exactly `false`, so a missing value stays locked.)
- [ ] `SITE_PREVIEW_USER` and `SITE_PREVIEW_PASSWORD` set in Production,
      different from the admin credentials. Without them the locked site
      returns 503 for everyone, never opens.
- [ ] Checked by hand on https://479.guide: `/` asks for the preview password;
      `/admin` asks for the admin password and refuses the preview one;
      `/bot` and `/robots.txt` load without a password; every response has
      `X-Robots-Tag: noindex`; `/robots.txt` is `Disallow: /`.
- [ ] At launch: set `SITE_LOCKED=false`, redeploy, and re-check that
      `/robots.txt` allows the site and `X-Robots-Tag` is gone.

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

- [x] **Separate production database** (owner, 2026-10-04): the Supabase
      project `sjpzfskwhkvcqqhbxrbd` is production only. Development runs on
      Postgres 17 on the laptop (`postgresql://localhost:5432/agent479_dev`,
      Homebrew), seeded with a copy of production taken 2026-10-04. Enforced
      in code (`src/lib/db/target.ts`): production may use only that project;
      local code, scripts, tests, and previews only a local database.
- [ ] `.env.local` points at the local database; the Supabase connection
      strings live only in `.env.production.local` (gitignored) and Vercel.
- [ ] Production is migrated deliberately:
      `MIGRATE_PRODUCTION=yes npm run db:migrate` (reads
      `.env.production.local`). Migrations 0014 and 0015 (step 13 follow-ups
      and step 14) are already applied to it.
- [ ] Vercel Production `DATABASE_URL` is the Supabase transaction pooler.
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

- [ ] `CRON_ENABLED=false` in Production until launch. Every cron route
      answers "disabled" and runs nothing unless it's exactly `true`.
- [ ] `vercel.json` crons match plan section 7 (today: none defined).
- [ ] `/api/cron/maintenance` is scheduled daily. It is the only thing that
      purges stored source descriptions (AGENTS.md rule 4).
- [ ] Each cron route rejects requests without the bearer secret (checked
      manually).
- [ ] `/admin/*` returns 401 without credentials (checked manually).
