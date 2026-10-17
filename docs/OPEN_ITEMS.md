# Open items

Questions and decisions waiting on the owner, newest first. Each one says what
it blocks. Remove an item once it's answered, and note where the answer went.

## Waiting on the owner

| # | Item | Raised | Blocks |
|---|---|---|---|
| 32 | **Peel Compton blocked us in production** (2026-10-17): its iCal feed passed the test fetch from your network, but the first scheduled fetch from Vercel got HTTP 403, so the source is disabled as blocked (logged, never retried). If you want Compton Gardens events, ask the Peel Compton Foundation to allow Agent479Bot (details at 479.guide/bot), then re-enable by hand with their permission as the reason. I can draft the email. | 2026-10-17 | Peel Compton events |
| 31 | **RunSignup API access** (step 9, 2026-10-17): RunSignup's API terms require a registered, approved application. Apply at runsignup.com (API keys page) or email api@runsignup.com, saying we'd show each race's name, date, place, and distance with a link to its RunSignup registration page, filtered to Benton and Washington counties, at most 2 calls at a time, daily. I can draft the request. Nothing is built until they approve. | 2026-10-17 | Races from RunSignup |
| 30 | **Rogers "Museum - Test" calendar** (`city-of-rogers-cat31`, approved 2026-10-17): its test fetch passes, but the 4 events are placeholders ("Museum and Me - next", "next2", "next3"). I left it off rather than put test data into shadow. Say "enable it anyway", or reject it (`npm run sources -- disable city-of-rogers-cat31 --reason ...`, or leave it off; it's never fetched while disabled). Peel Compton (iCal) and Sassafras Springs (event data) passed and are in shadow. | 2026-10-17 | Nothing |
| 29 | **Google-hosted calendars** (feed discovery, 2026-10-17): the Pea Ridge Community Library publishes its events on a public Google Calendar embedded in its own site. Does "Google is never a source for our facts" cover an organizer's own calendar that Google hosts? Until you decide, discovery lists these and never fetches them. | 2026-10-17 | Pea Ridge library events (and any other Google-hosted organizer calendars) |
| 28 | **Tier 1 follow-ups** (organizer registry step 2, 2026-10-16): (a) Siloam Springs and Pea Ridge are in shadow, but we have no venues in either town, so most of their events wait in needs_venue (Pea Ridge's feed gives a location on only 3 of 25 events). A venue batch for both towns goes through the usual venue report and your sign-off. (b) `city-fayetteville-volunteer` failed its test fetch: catID 36 has no events right now. It stays `untested`; I'll re-test it when the city posts some. (c) Pea Ridge's feed includes City Council meetings. Reject them in By source, or add a "Meeting" filter rule (its preview shows what it would catch). | 2026-10-16 | Siloam Springs and Pea Ridge events reaching review |
| 27 | **`.env.production.local` had a bare value on its own line** (an API key without a variable name, starting "AIza"). Listing the file's variable names printed it into the session log. If it's the browser Maps key (referrer-restricted, public by design) nothing is needed. Otherwise rotate it, and either name the line or delete it. I also set that file's `SITE_URL` to `https://479.guide` and `BOT_CONTACT_EMAIL` to `bot@479.guide` (they were `localhost` and a non-479.guide address), so production test fetches run. | 2026-10-16 | Nothing |
| 26 | **Google ratings: match and switch on** (built 2026-10-11, deployed switched off). For each New in Town place: /admin/places/<place> → Google match → **Find on Google** → open each candidate in Maps → **This is it**. Then set `GOOGLE_PLACES_WIDGET=true` in Vercel (Production) and redeploy; check one place page and /privacy. Set it back to `false` to turn it off. | 2026-10-11 | Google ratings going live |
| 25 | **Later: event weather** (owner, 2026-10-06): forecasts for outdoor events in the next 7 days from the National Weather Service (api.weather.gov: free, public data, our bot's user agent), not Google's Weather API. Plan it after the Google ratings work; terms check first. | 2026-10-06 | Nothing yet |
| 22 | **Owner checks:** (a) your Supabase plan and backups: Dashboard → Organization → Billing (plan), and Project → Database → Backups (daily backups are Pro and up; point-in-time recovery is a paid add-on). (b) Venue report (`data/venues.report.md`): since your 2026-10-04 sign-off (0879d721) the file also gained The Ramble and Upper Ramble (the pending Ramble sign-off), so I didn't record a sign-off. Signing now covers both Rambles and The Auditorium set inactive (sha256 4be52c87…). (c) Send the three outreach emails in `docs/outreach/` (Destination Rogers, Fayetteville Flyer, Visit Bentonville). (d) Name the newsletters for the leads inbox. | 2026-10-05 | Venue reseed; festivals steps 8–9 |
| 21 | **Festivals plan:** approved 2026-10-05 (`docs/product/festivals.md`). Before step 8: confirm Google's terms for Alerts. | 2026-10-05 | Festivals step 8 |
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

- Off-site backups live (2026-10-11): R2 bucket `agent479-backups`, age key in the owner's Apple Passwords (entry 479.guide / backup-key-age, checked against the key by fingerprint); a restore from R2 tested into a scratch database. Festivals 2b deployed with migration 0024.

- Large-venue list approved plus Butterfield Stage; Sports excluded from the large-venue rule (2026-10-06). Google ratings plan approved with all picks; rules in AGENTS.md (2026-10-06).

- Free default: no source states one; `default_price_note` stays null (2026-10-04).
- The Ramble typed `area` (2026-10-04).
- Step 13 approved and merged (2026-10-04).
- Step 14 approved and merged (2026-10-04).
- The extracted activity phrase counts as a fact for grounding (2026-10-04).
- Front-page decisions and content checks merged; glossary (ESL, GED) approved; migrations 0017–0019 on production; backup before them in `backups/` (2026-10-04).
- Step 16 approved and merged; crons on in production (2026-10-04).
- Step 15 approved and merged; migration 0016 applied to production (2026-10-04).
- Production database: keep the existing Supabase project as production; development on local Postgres (2026-10-04).
