# Open items

Questions and decisions waiting on the owner, newest first. Each one says what
it blocks. Remove an item once it's answered, and note where the answer went.

## Waiting on the owner

| # | Item | Raised | Blocks |
|---|---|---|---|
| 24 | **Off-site backups setup** (until then, production migrations refuse): create a private R2 bucket and a bucket-scoped API token; run `npm run backup:keygen` and store the private key in your password manager; put `BACKUP_AGE_RECIPIENT`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` in `.env.production.local`. Then one test backup and a test restore. | 2026-10-06 | Next production migration |
| 22 | **Owner checks:** (a) your Supabase plan and backups: Dashboard → Organization → Billing (plan), and Project → Database → Backups (daily backups are Pro and up; point-in-time recovery is a paid add-on). (b) Venue report (`data/venues.report.md`): since your 2026-10-04 sign-off (0879d721) the file also gained The Ramble and Upper Ramble (the pending Ramble sign-off), so I didn't record a sign-off. Signing now covers both Rambles and The Auditorium set inactive (sha256 4be52c87…). (c) Send the three outreach emails in `docs/outreach/` (Destination Rogers, Fayetteville Flyer, Visit Bentonville). (d) Name the newsletters for the leads inbox. | 2026-10-05 | Venue reseed; festivals steps 8–9 |
| 21 | **Festivals plan:** approved 2026-10-05 (`docs/product/festivals.md`). Before step 8: confirm Google's terms for Alerts. | 2026-10-05 | Festivals step 8 |
| 20 | **Step 18 review:** look at https://479.guide (preview login) on a phone and a computer; tell me what to change. Also confirm the **large-venue list** for the feature rule (`src/config/front-page.ts`: Walmart AMP, Bud Walton Arena, Razorback Stadium, Baum-Walker Stadium, Arvest Ballpark, Barnhill Arena, Walton Arts Center, Ozark Music Hall); it's my proposal, since we have no capacity data. | 2026-10-04 | Step 18 approval |
| 19 | **New in Town (to do):** permission emails to Talk Business & Politics, the Rogers-Lowell, Fayetteville, and Greater Bentonville chambers (ribbon-cutting list or feed), and Arkansas Business; a feed request to Springdale for permits. Then build the lead-and-confirm flow (`docs/sources-terms.md`, openings review). | 2026-10-04 | New in Town content |
| 18 | **Step 17:** approve deploying the dedup review page (branch `step-17-dedup-review`, no migration). Then label the ~30 pairs at https://479.guide/admin/dedup-review. After that I export the labels, run `eval:dedup`, propose thresholds, and you decide which sources go live. | 2026-10-04 | Dedup thresholds; merging in live mode |
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
- The extracted activity phrase counts as a fact for grounding (2026-10-04).
- Front-page decisions and content checks merged; glossary (ESL, GED) approved; migrations 0017–0019 on production; backup before them in `backups/` (2026-10-04).
- Step 16 approved and merged; crons on in production (2026-10-04).
- Step 15 approved and merged; migration 0016 applied to production (2026-10-04).
- Production database: keep the existing Supabase project as production; development on local Postgres (2026-10-04).
