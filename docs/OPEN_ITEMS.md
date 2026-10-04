# Open items

Questions and decisions waiting on the owner, newest first. Each one says what
it blocks. Remove an item once it's answered, and note where the answer went.

## Waiting on the owner

| # | Item | Raised | Blocks |
|---|---|---|---|
| 15 | **Front-page decisions branch** (`front-page-decisions`): approve to merge. Needs migration 0017 on production first (I apply it with `MIGRATE_PRODUCTION=yes`). | 2026-10-04 | Content checks in production |
| 16 | **Grounding and acronyms:** 109 of the 121 flagged descriptions expand "ESL" to "English" or "English as a Second Language". Treat as ungrounded (regenerate or hold), or allow a small glossary of expansions (ESL, GED) as facts? | 2026-10-04 | Re-describing the flagged events |
| 17 | **Ticketmaster display terms** before any public page shows Ticketmaster events (checklist). | 2026-10-04 | Step 18 going public |
| 8 | **`.env.local` (optional):** `.env.production.local` now exists (a copy, made 2026-10-04). Local scripts and tests still refuse the production database by design; point `.env.local` at `postgresql://localhost:5432/agent479_dev` whenever you want to run them yourself. | 2026-10-04 | Running local scripts yourself |
| 9 | **Vercel env vars.** Run `npx vercel login` and `npx vercel link` once, then approve the list in the 479 Guide report. Until `SITE_PREVIEW_USER`/`SITE_PREVIEW_PASSWORD` are set, the locked site returns 503 to everyone. | 2026-10-04 | Previewing the site |
| 10 | **`.env.local`:** set `SITE_URL=https://479.guide` and `BOT_CONTACT_EMAIL=bot@479.guide`. Local fetches refuse to run until then. | 2026-10-04 | Local fetches, test fetches |
| 12 | **Spot check:** "Paper Flower Crafting" got the En español tag; confirm on the library's page whether it's conducted in Spanish. | 2026-10-04 | Nothing |
| 1 | **Lower Ramble map pin.** The decisions message still had the placeholder "[south of the library / next to Walton Arts Center]". Check the city's Lower Ramble facility page in your browser and say where the pin sits. The Census geocoder puts 255 S West Ave at 36.06008, -94.16567, about 160 m south of the library; 255 N West Ave lands next to Upper Ramble. | 2026-10-04 | Adding Lower Ramble; the 3-venue Ramble report and its sign-off; seeding Upper Ramble (3 needs_venue events) |
| 2 | **Sign the Ramble venue report** once item 1 is in. A new report covers The Ramble (area), Upper Ramble, and Lower Ramble. Not b5d30569. | 2026-10-04 | Seeding the Ramble venues |
| 3 | **Blind eval labels.** Fill in `category` and `tags` in `tests/fixtures/eval/blind.csv` (40 events). Then compare owner, Claude, and model labels, and make the owner's labels the answer key in `events.json`. | 2026-10-04 | The eval comparison |
| 4 | **Square to Square venue match** (decide it in `/admin/proposals` once step 16 is live). Pending `propose_venue_match`: the Bentonville detail page names the Fayetteville Square. The event is already past, so approve or reject only for the record. | 2026-10-04 | Nothing (archives anyway) |
| 5 | **Rogers Public Library feed URL** (LibCal ICS from their Subscribe UI). | 2026-10-03 | Enabling `library-rogers` |
| 6 | **Outreach emails** in `docs/outreach/`: WAC, Crystal Bridges/Momentary permission; Springdale, Downtown Springdale, Bentonville Public Library feed requests. | 2026-10-02 | Those sources |
| 7 | **Source priorities for weekend coverage** (item 1 of the 2026-10-04 decisions). See the recommendation in that report. | 2026-10-04 | Choosing the next source to build |

## Answered (kept briefly for context)

- Free default: no source states one; `default_price_note` stays null (2026-10-04).
- The Ramble typed `area` (2026-10-04).
- Step 13 approved and merged (2026-10-04).
- Step 14 approved and merged (2026-10-04).
- Step 16 approved and merged; crons on in production (2026-10-04).
- Step 15 approved and merged; migration 0016 applied to production (2026-10-04).
- Production database: keep the existing Supabase project as production; development on local Postgres (2026-10-04).
