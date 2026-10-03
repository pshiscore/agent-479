# Agent 479: Phase 1 Plan (v2.1)

v2 incorporates the owner's decisions of 2026-10-02 on the 11 open questions.
v2.1 (2026-10-03) adds the terms review results (step 0) and switches the
database to Supabase Postgres.
Source findings came from live checks on 2026-10-02.

## Changes from v1

| # | Area | Change |
|---|---|---|
| 1 | Cron | Unchanged: Vercel Pro, 15-minute jobs. |
| 2 | LLM | OpenAI direct SDK behind a provider-adapter interface. Default model **`gpt-6-luna`** for every task. `llm_models` gains `params` (e.g. reasoning effort) and full price columns. Env-var model fallbacks removed: the table is the only source. |
| 3 | WAC | Seeded with `enabled=false` and terms_notes "awaiting permission". Permission email drafted at `docs/outreach/wac-permission-email.md` (step 0). |
| 4 | Monetization | `sources.commercial_use_ok` (yes/no/unknown) and `terms_notes`. The Ticketmaster mapper keeps a whitelist of facts and links only. Sponsored content gets a future separate table and is never mixed into listings. |
| 5 | Admin auth | Basic Auth in **`src/proxy.ts`** (Next 16 renamed `middleware` to `proxy`). Move to Auth.js when the review queue is built. |
| 6 | Venues | `venue_type='area'` with a center lat/lng. Route events use their start location. A location that is unmatched in 2 or more events becomes a pending **`propose_venue`** action in `agent_actions`, which you approve or reject. |
| 7 | Series | New `event_series` table. Recurring programs show as one row with the next date and are hidden from the default homepage. |
| 8 | Taxonomy | `categories` and `tags` tables. Exactly one category per event, plus tags. "Community" share is tracked and needs a "missing category" hint. City meetings are skipped. |
| 9 | Identity | `SITE_URL` and `BOT_CONTACT_EMAIL` env vars. The user agent is `Agent479Bot (contact: …)`. Pre-deploy checklist added. |
| 10 | Digest | Draft built Thursday 6:00pm and re-checked Friday 6:00am. Variety rules added. **Fails closed** into a `held` status. |
| 11 | Dedup review | About 30 pairs nearest the thresholds, labels kept as a permanent regression set, roughly 10 more per new source, and a new `/admin/dedup-review` page. |
| 12 | Database (v2.1) | **Supabase Postgres** instead of Neon. Drizzle with `postgres-js`. RLS is enabled on every table to lock out Supabase's public Data API. |
| 13 | Sources (v2.1) | The terms review found that **Crystal Bridges and the Momentary forbid robots and deep links** without written consent. Both are disabled awaiting permission, like WAC. 6 sources are enabled at launch. A per-domain link policy is added. |

---

## 1. Key technical decisions

| Decision | Choice |
|---|---|
| Database | **Supabase Postgres.** The app connects through the Supavisor transaction pooler (port 6543) with `postgres-js` and `prepare: false`. Migrations use the direct or session connection (port 5432). |
| Migrations | Drizzle ORM + drizzle-kit. Generated SQL migrations are committed. Never run `push` against production. |
| Postgres extensions | `pg_trgm`, `unaccent`, created `with schema extensions` (the Supabase convention). `gen_random_uuid()` is built in, so `pgcrypto` isn't needed. |
| Supabase Data API | We don't use supabase-js. Every table is created with **RLS enabled and no policies**, so the public anon key can't read or write anything. Our server connection owns the tables and isn't affected. Turning off Data API exposure of `public` is on the pre-deploy checklist. |
| Time | `timestamptz`, DB session set to UTC. Parse with an explicit zone and display in `America/Chicago`. Local-time cron jobs get two UTC entries plus a local-hour guard. |
| Extraction | Deterministic mappers first (ICS, Ticketmaster, JSON-LD). The LLM is used for HTML pages, classification, and our own descriptions. |
| Concurrency | One Postgres advisory lock per job. |
| Fetch identity | `Agent479Bot (contact: <BOT_CONTACT_EMAIL>)`. The fetch layer throws if the address is unset. No browser spoofing, no getting around bot challenges. |
| LLM | `src/lib/llm` is the only entry point. Each task looks up its active `llm_models` row and dispatches to the adapter named in `provider`. Switching between providers that have adapters is a row change. A never-used provider needs one adapter file. |

### LLM model choice: `gpt-6-luna`

Checked against OpenAI's pricing and model pages on 2026-10-02.

| Model | Input / cached / output per 1M tokens | Structured outputs | Status |
|---|---|---|---|
| **gpt-6-luna** | $0.10 / $0.01 / $0.50 (cache writes $0.125) | Yes | Current generation; "our most efficient model for focused, high-volume tasks" |
| gpt-5-nano | $0.05 / $0.005 / $0.40 | Yes | Previous generation (2025-08 snapshot). Its own page steers new cost-sensitive work to newer models. |
| gpt-5.6-luna | $0.20 / $0.02 / $1.20 | n/a | Older and pricier than gpt-6-luna |
| gpt-4.1-nano / gpt-4o-mini | $0.10 / $0.40 and $0.15 / $0.60 | n/a | Legacy |

gpt-6-luna is the cheapest model in the current generation. It supports
JSON-schema structured outputs on both the Responses and Chat Completions
APIs, and its reasoning effort can be set as low as `none`, which keeps
output-token cost down on simple extraction.

Estimated cost per call is about 3k input and 400 output tokens, roughly
$0.0005. At about 300 calls a day that's roughly $0.15 a day, far below the
$5 cap.

gpt-5-nano is cheaper per token but is the previous generation. It goes in as
an inactive row so we can A/B it with the eval script if cost ever matters.

Seed rows:

| Task | Model | Params |
|---|---|---|
| extract, classify, dedup_tiebreak, venue_pick | gpt-6-luna | `reasoning_effort: "low"` |
| describe, digest | gpt-6-luna | `reasoning_effort: "medium"` |

Every row records `pricing_source_url` and `pricing_checked_at`.

---

## 2. Folder structure

```
agent-479/
├─ src/
│  ├─ proxy.ts                         # Basic Auth for /admin/*
│  ├─ app/
│  │  ├─ page.tsx                      # upcoming events, filters, series rows
│  │  ├─ events/[slug]/page.tsx        # detail + JSON-LD; merged → 301 survivor
│  │  ├─ admin/
│  │  │  ├─ agent-log/page.tsx         # actions, diffs, rollback, venue proposals
│  │  │  ├─ dedup-review/page.tsx      # label near-threshold pairs
│  │  │  └─ digest-preview/page.tsx    # draft, held flag, veto, regenerate
│  │  └─ api/cron/{fetch,process,maintenance,digest-draft,digest-recheck}/route.ts
│  └─ lib/
│     ├─ db/        client.ts, schema/*.ts
│     ├─ llm/       index.ts, config.ts, cost.ts, budget.ts,
│     │             providers/{types,openai}.ts, prompts/*.ts
│     ├─ sources/   registry.ts, http.ts, fetchers/*.ts
│     ├─ pipeline/  fetch.ts, map/*.ts, extract.ts, venue-resolve.ts,
│     │             venue-proposals.ts, series.ts, dedup/{score,decide,merge}.ts,
│     │             digest/{select,generate,validate,recheck}.ts
│     ├─ actions/   record.ts, rollback.ts
│     ├─ time.ts, cron-guard.ts, categories.ts, slug.ts, auth.ts
├─ drizzle/                            # SQL migrations (committed)
├─ data/venues.seed.json               # verified venues + provenance
├─ docs/  PHASE1_PLAN.md, PREDEPLOY_CHECKLIST.md, sources-terms.md, outreach/
├─ scripts/ verify-venues.ts, seed-*.ts, eval-extract.ts, dedup-export-labels.ts
└─ tests/  fixtures/{raw,injection,dedup}/, *.test.ts
```

---

## 3. Database schema

**Conventions:** `uuid` primary keys, `created_at` and `updated_at` as
`timestamptz`, CHECK constraints instead of Postgres enums.

### Venues and sources

**`venues`**
- id, slug (unique), name, aliases `text[]`, address, city, state,
  postal_code, lat, lng `numeric(9,6)`, website
- venue_type: `arena | theater | museum | music_venue | bar | park | library | plaza | campus | area | other`
- parent_venue_id, active
- verification `jsonb`: provenance per field
- For `area` venues (Downtown Bentonville Square, Dickson Street): lat/lng is
  the center point and the address is optional.
- Indexes: GIN on aliases, GIN trigram on name

**`venue_external_ids`**
- venue_id, source_id, external_id
- Unique on (source_id, external_id)

**`sources`**
- id, slug, name
- kind: `api | ics | rss | jsonld_sitemap | html`
- fetcher, base_url, config `jsonb`, default_venue_id
- trust_level 1–5, enabled, fetch_interval_minutes
- **commercial_use_ok**: `yes | no | unknown`
- **terms_notes**
- **dedup_mode**: `shadow | live`, default `shadow`
- last_fetched_at, last_success_at, consecutive_failures, last_error,
  robots_checked_at

**`link_policies`**
- id, domain (unique)
- mode: `deep | homepage_only`
- homepage_url, reason, updated_at
- Applied when links are rendered, never stored into events, so changing a
  policy takes effect without touching event data.

### Pipeline

**`runs`**
- id, job, source_id, started_at, finished_at, status, stats `jsonb`, error

**`raw_records`**
- id, source_id, run_id, external_id, source_url, content_hash, payload,
  fetched_at
- status: `pending | mapped | extracted | needs_venue | skipped | failed`
- skip_reason (for example `government_meeting`)
- **location_key**: normalized location text, used to group unmatched venues
- attempts, last_error, event_id
- Unique on (source_id, external_id)
- Indexes: (status, fetched_at), (location_key) where status='needs_venue'
- Payload is purged after 30 days.

### Events and taxonomy

**`categories`**
- id, slug, name, sort, active
- Seeded with: Music, Arts & Theater, Comedy, Film, Family & Kids,
  Food & Drink, Outdoors & Fitness, Sports, Festivals & Markets,
  Talks & Learning, Community, Nightlife

**`tags`**
- id, slug, name, active
- Seeded with: Free, Outdoor, Family-friendly, 21+, Dog-friendly, Biking
- Rows can be added without a deploy, because the classifier builds its
  allowed-tag enum from this table at run time.

**`event_series`**
- id, slug, title, venue_id, category_id
- kind: `recurring | run` ("run" means consecutive performances, such as a
  touring show)
- recurrence_label (for example "Tuesdays" or "Oct 6–11"), rrule, detected_by

**`events`**
- id, slug, title, short_description
- start_at, end_at, all_day
- venue_id **NOT NULL**
- **category_id NOT NULL**
- **series_id**
- is_free, price_min, price_max, price_text
- primary_source_url, ticket_url
- status: `scheduled | cancelled | postponed | merged | hidden`
- canonical_event_id, quality_score, first_seen_at, last_seen_at
- Indexes:
  - (start_at) where scheduled
  - (venue_id, start_at)
  - (category_id, start_at)
  - (series_id, start_at)
  - GIN trigram on normalized_title

**`event_tags`**
- event_id, tag_id
- Primary key on (event_id, tag_id)

**`event_sources`**
- event_id, source_id, raw_record_id, external_id, source_url, ticket_url,
  first_seen_at, last_seen_at, is_primary
- Unique on (source_id, external_id)

### Dedup

**`dedup_candidates`**
- event_a_id, event_b_id, scores `jsonb`, decision, llm_call_id,
  resolved_at, resolved_by
- Unique on the unordered pair

**`dedup_labels`**
- id, candidate_id
- facts_a `jsonb`, facts_b `jsonb`: frozen snapshots, so the regression set
  survives later data changes
- label: `same | different`
- source_ids, labeled_by, labeled_at, note

### Agents and LLM

**`agent_actions`**
- id, run_id, actor, job
- action: `insert | update | merge | unmerge | disable | enable | propose_venue | publish | hold | veto | recheck_drop | recheck_correct | rollback`
- entity_type, entity_id, before `jsonb`, after `jsonb`, reason, model,
  llm_call_id, confidence
- **approval_status**: `pending | approved | rejected`, null when the action
  needs no approval
- **dedupe_key**, reviewed_by, reviewed_at
- reverts_action_id, reverted_by_action_id
- Indexes:
  - (entity_type, entity_id, created_at)
  - (run_id)
  - (created_at desc)
  - partial unique on (action, dedupe_key) where approval_status='pending'

**`llm_models`**
- id, task, provider, model, params `jsonb`, max_output_tokens
- input_cost_per_mtok, cached_input_cost_per_mtok, cache_write_cost_per_mtok,
  output_cost_per_mtok
- pricing_source_url, pricing_checked_at, active
- Partial unique on (task) where active

**`llm_calls`**
- id, run_id, task, provider, model, prompt_version
- input_tokens, cached_tokens, output_tokens, reasoning_tokens, cost_usd
- latency_ms, status, error

### Digest

**`digests`**
- id, kind, period_start, period_end
- status: `draft | held | approved | vetoed | published | failed`
- content_md, auto_publish_at (Friday 07:00 Chicago)
- **rechecked_at**, **recheck_status** (`ok | failed`), **hold_reason**
- vetoed_at, approved_at, published_at, publish_targets, version, run_id

**`digest_items`**
- digest_id, event_id, position, emoji, pun_title, sentence, dropped_reason

**Future publish job:** it publishes a digest only when all of these hold:

- status is `draft` or `approved`
- `recheck_status = 'ok'`
- `auto_publish_at <= now()`
- the digest has not been vetoed

Anything else stays unpublished, which is the fail-closed behavior.

### Designed for, not built

- `sponsored_placements`: a separate content type with its own table,
  sponsor, flight dates, and a "Sponsored" label. It never touches `events`,
  `event_sources`, or digest event lines, and pipeline jobs never write it.
- submissions, review_queue, votes, issue_reports: these will reference
  `events.id` and `agent_actions`.

---

## 4. Sources

| Source | Access method | Trust | Interval | Enabled at launch | Notes |
|---|---|---|---|---|---|
| Ticketmaster Discovery API | JSON API with a key | 4 | 6h | yes | Facts and links only. Terms: storage only for "reasonable periods", no replicating Ticketmaster, no API-derived revenue. **commercial_use_ok = no.** |
| City of Bentonville | CivicPlus ICS, catID 32 | 4 | 24h | yes | |
| City of Rogers | CivicPlus ICS, catID 28 | 4 | 24h | yes | |
| City of Fayetteville | CivicPlus ICS, catIDs 30, 33 | 4 | 24h | yes | |
| Rogers Public Library | LibCal ICS | 4 | 12h | yes | High volume; feeds the series logic |
| Fayetteville Public Library | Communico feed | 4 | 12h | yes | Exact URL taken from their Subscribe UI |
| Walton Arts Center | to be decided after permission | 5 | 24h | **no** | terms_notes: "awaiting permission" |
| Crystal Bridges | sitemap + HTML, if permitted | 5 | 24h | **no** | Terms ban robots and deep links without consent. Awaiting permission. |
| The Momentary | JSON-LD + sitemap, if permitted | 5 | 24h | **no** | Same terms as Crystal Bridges. Awaiting permission. |

**Deferred:** Visit Bentonville (aggregator, Phase 1b).

**Skipped:**
- Springdale (city): bot challenge
- Downtown Springdale: robots.txt disallows its feed formats
- Bentonville Public Library: returns 403
- Experience Fayetteville: Vibemap embed

Feed requests are drafted in `docs/outreach/`. Each source's
`commercial_use_ok` and `terms_notes` values are in `docs/sources-terms.md`.

**Link policy:** `link_policies(domain, mode)`, where mode is `deep` or
`homepage_only`. `crystalbridges.org` and `themomentary.org` start as
`homepage_only`, because their terms forbid deep links without consent. The
renderer rewrites any `source_url` or `ticket_url` on those domains to the
domain's homepage. This applies even when another source supplied the event.

---

## 5. Pipeline rules

1. **Fetch:** write `raw_records` only. A source with `enabled=false` is never
   fetched, and that's enforced inside the fetch layer, not just the dispatcher.
2. **Map or extract** into the facts schema. The Ticketmaster mapper
   whitelists: name, dates, status, Ticketmaster venue ID, price ranges, the
   event URL, and classification (used only as a hint). It drops images, the
   info and pleaseNote text, and promoter text.
3. **Exclude** government and city meetings. They get status `skipped` with
   skip_reason `government_meeting`.
4. **Resolve the venue.** In order: external ID, the source's default venue,
   alias, trigram match in the same city, then an LLM pick among the top 5
   candidates or "none".
   - Route-based events (races, rides) use their start location.
   - If no venue matches, the record gets `needs_venue` and a `location_key`.
     No event is created, so it never reaches public pages.
5. **Propose venues.** When one `location_key` appears on 2 or more distinct
   unmatched records and has no pending or rejected proposal, insert
   `agent_actions(action='propose_venue', approval_status='pending')`.
   - **On approve:** you confirm the verified fields, the venue is inserted
     (actor `human:admin`), and those records are re-queued.
   - **On reject:** the records stay hidden.
6. **Classify:** exactly one category from the active `categories` rows, plus
   tags from the active `tags` rows. Both enums are built into the JSON schema
   at run time.
   - When the model picks Community, it must also fill
     `closest_missing_category`, which is stored on the action.
   - `/admin/agent-log` shows Community's 7-day share and the top hints, and
     warns above 15%.
7. **Describe:** from the facts JSON only. Rejected if it shares any 8-word
   run with the source text.
8. **Series:** an ICS RRULE or recurrence ID creates a series directly.
   Otherwise:
   - same source, venue, and normalized title, with 3 or more occurrences in
     60 days on a matching weekday and time → `recurring`
   - occurrences on consecutive days → `run`

   Labels are computed in code ("Tuesdays", "Tue & Thu", "Oct 6–11").
9. **Dedup** (section 6), then write. Every write goes through `recordAction()`.

**Injection controls:**
- Untrusted content goes in a delimited block, and the model is told to ignore
  any instructions inside it.
- Structured output is validated with zod. The model has no tools.
- Code sets `source_url`.
- `ticket_url` must appear verbatim in the raw content and be on an
  allow-listed domain.
- Dates must fall within -1 day to +18 months.
- `venue_id` must be one of the candidates we supplied.
- Fixture pages with planted instructions are part of the tests.

**Budget:** the wrapper refuses calls past `LLM_DAILY_BUDGET_USD`.

---

## 6. Dedup

1. Same (source_id, external_id): this is an update.
2. **Blocking:** same venue or a shared parent venue; start within ±3h, or
   overlapping dates for all-day events; scheduled events only.
3. **Score:** normalize titles, then take the larger of pg_trgm similarity and
   a token-set ratio. Add the start-time difference. A matching Ticketmaster
   event ID counts as certain.
4. **Decide.** The starting thresholds are placeholders until review:
   - score ≥ T_merge (start 0.85) and start difference ≤ 30 min: auto-merge
   - between T_llm (start 0.50) and T_merge: LLM tiebreak on facts only. It
     merges if `same` with confidence ≥ 0.8; otherwise the pair is `uncertain`.
   - below T_llm: distinct
5. **Uncertain pairs** are logged and both events stay live. The digest never
   picks both events from an uncertain pair.
6. **Merging** never deletes anything:
   - The losing event gets `status=merged` and `canonical_event_id` set to the
     survivor.
   - Its source rows move to the survivor.
   - Empty fields are filled by trust precedence.
   - One `agent_actions` row holds the full before-state, so the merge can be
     undone.
7. **Shadow mode and review:**
   - Every source starts with `dedup_mode='shadow'`: decisions are logged and
     nothing merges.
   - **Initial review:** pick about 30 pairs with the smallest
     `min(|score − T_merge|, |score − T_llm|)`, spread across sources, and
     label them in `/admin/dedup-review`.
   - **Thresholds:** T_merge becomes the lowest score at which no labeled
     "different" pair would auto-merge, plus a 0.03 margin. T_llm is set so no
     labeled "same" pair falls below it.
   - **Regression set:** labels are exported with frozen facts to
     `tests/fixtures/dedup/labels.json` (committed).
     `tests/dedup-regression.test.ts` runs the pure score-and-decide code on
     every test run and fails if a "different" pair auto-merges, or if a
     "same" pair scores below T_llm.
   - **LLM-band pairs** are covered by `npm run eval:dedup`, which makes real
     calls and costs pennies. Run it when prompts or models change.
   - **New source:** it stays in `shadow` until you label about 10 nearest
     pairs that involve it. Then it moves to `live`.

---

## 7. Cron schedule (vercel.json, UTC)

| Path | Cron | Chicago time | Job |
|---|---|---|---|
| `/api/cron/fetch` | `*/15 * * * *` | every 15 min | Fetch due, enabled sources |
| `/api/cron/process` | `5,20,35,50 * * * *` | every 15 min | Map, extract, venue, series, dedup (batches of 50 or fewer) |
| `/api/cron/maintenance` | `0 9 * * *` | 3–4am | Dedup sweep, payload purge, past events, venue proposals, source health, cost totals |
| `/api/cron/digest-draft` | `0 23 * * 4` and `0 0 * * 5` | **Thu 6:00pm** | The guard runs only when local time is Thu 18:xx. Idempotent. |
| `/api/cron/digest-recheck` | `0 11 * * 5` and `0 12 * * 5` | **Fri 6:00am** | The guard runs only when local time is Fri 06:xx. |
| *(later)* `/api/cron/publish` | `0 * * * *` | hourly | Fail-closed publish rule (section 3) |

Each local-time job has two UTC entries because Vercel cron runs in UTC and
Chicago changes offset for DST. The guard in `cron-guard.ts` makes exactly
one of the pair do the work. All routes require
`Authorization: Bearer $CRON_SECRET`.

### Digest

**Selection:** 8 to 12 events, Friday through Sunday in Chicago time, scored
by trust, quality, and ticket or price info. Rules:

- At most 2 events per venue.
- Spread across cities and categories, with a diminishing score per repeat.
- At least 1 event tagged Free and 1 tagged Family-friendly, when the window
  has them.
- At most 2 events from recurring series.
- No two events from the same uncertain dedup pair.
- No events from `needs_venue` records.

**Generation:** the LLM writes each emoji, pun title, and sentence from facts.
The validator checks that each line has the correct venue, weekday, and time.
A failing line is regenerated once, then falls back to a template. The header
and footer are fixed strings.

**Friday 6:00am re-check:**
1. Re-fetch each selected event from its sources: the Ticketmaster event by
   ID, the ICS feed, or the detail page.
2. If an event was cancelled, removed, or moved outside the window, drop it
   (`recheck_drop`).
3. If its time or venue changed, correct the event and regenerate that line
   (`recheck_correct`).
4. Log everything in `agent_actions`.

**Fail closed:** if fewer than 5 events pass, or the job throws, set the
digest to `held` with a `hold_reason`, set `recheck_status='failed'`, and show
a red banner on `/admin/digest-preview`. A draft whose re-check never ran
can't publish either, because publishing requires `recheck_status='ok'`.

---

## 8. Environment

See `.env.example`. Model names are deliberately not env vars.

---

## 9. Build order (approve one step at a time)

0. **Terms pass and outreach** ✅: `docs/sources-terms.md`, the WAC and
   Crystal Bridges/Momentary permission emails, and feed-request notes in
   `docs/outreach/`.
1. **Scaffold** ✅: Next 16, TypeScript, Tailwind, ESLint, Vitest, `.env.example`
   plus a test that checks it, empty crons, README, AGENTS.md, this plan, and
   the pre-deploy checklist.
2. **DB foundation** ✅: Supabase project `agent-479` (us-east-2, Postgres 17)
   and Drizzle. Migrations `0000_extensions` and `0001_core_audit_llm` create
   `runs`, `agent_actions`, `llm_models`, `llm_calls` with RLS on.
   `npm run db:verify` checks the live database.
3. **`time.ts`, `cron-guard.ts`, `recordAction()`** ✅, plus `runs.ts`
   (`withRun`). Offline unit tests cover DST and the weekend window. DB tests
   (`npm run test:db`) run in transactions that are always rolled back.
4. **LLM wrapper** ✅: `generateStructured()` in `src/lib/llm`, the OpenAI
   adapter (Responses API, strict JSON schema, `store: false`), cost and the
   Chicago-day budget, `wrapUntrusted()`, and `llm_models` seeded (6 active
   gpt-6-luna rows plus inactive gpt-5-nano). Migration 0002 adds
   `llm_calls.cache_write_tokens`. ESLint blocks provider SDK imports outside
   `src/lib/llm/providers`.
5. **Venue tables and verification tooling** ✅: migration 0003 creates
   `venues` (area venues need only a center point) and `venue_external_ids`
   (its FK to `sources` lands in step 7). `npm run venues:verify` checks
   `data/venues.seed.json` offline (NWA bounds, provenance per field, name and
   alias collisions per city, near-duplicates, parent chains) and optionally
   cross-checks addresses with the US Census geocoder; it never fetches venue
   sites. It writes `data/venues.report.md` with the contents' sha256.
   `npm run venues:seed` refuses unless `reviewed.sha256` matches.
6. **About 50 venues** ✅: 51 venues in `data/venues.seed.json`, signed off
   by the owner on 2026-10-03 (sha256 `9ad869cd…d963`) after three review
   rounds, and seeded with each insert logged. Report:
   `data/venues.report.md`. Standing data and fetching rules from the review
   are in `CLAUDE.md`.
7. **`sources` and `link_policies` tables and seed** ✅: migrations 0004–0005,
   `npm run db:seed:sources`. 9 sources, **all seeded disabled**: the 6 launch
   sources are marked `launch` in `src/lib/sources/seed-data.ts`, and step 9
   enables each with a logged `enable` action once its fetcher exists and its
   feed URL is confirmed. Re-seeding never changes `enabled`. WAC, Crystal
   Bridges, and the Momentary have no fetcher and are "awaiting permission".
   `runs.source_id` and `venue_external_ids.source_id` now reference
   `sources`. `link_policies` has a uuid key (with `domain` unique) so its
   changes can be logged; `applyLinkPolicy()` in `src/lib/links.ts` rewrites
   links when they're displayed. Terms come from `docs/sources-terms.md`.
8. **`categories` and `tags` tables and seed.**
9. **Fetch framework and ICS fetcher:** user agent, robots, rate limits, the
   enabled-flag guard. Enable the cities and libraries.
10. **Ticketmaster fetcher** with the facts-only whitelist and a venue
    coverage report.
11. **Momentary and Crystal Bridges fetchers:** gated on written permission.
    Skipped until it arrives, and not built speculatively.
12. **Events tables:** `events`, `event_sources`, `event_tags`. Mappers and
    the venue resolver, `needs_venue`, and venue proposals.
13. **LLM extract, classify, and describe,** including the Community hint,
    injection fixtures, and the eval script.
14. **Series detection and labels.**
15. **Dedup engine in shadow mode,** with `dedup_candidates` and `dedup_labels`.
16. **Admin:** Basic Auth in `src/proxy.ts`, then `/admin/agent-log` with
    diffs, rollback, venue proposal approve and reject, and Community stats.
17. **`/admin/dedup-review`:** you label about 30 pairs. Export the regression
    fixtures and test, set thresholds, go `live`.
18. **Homepage:** filters, series rows, recurring hidden by default.
19. **Event detail page and JSON-LD.**
20. **Digest draft:** selection rules, generation, validator, the Thursday
    cron, and `/admin/digest-preview`.
21. **Friday re-check:** drop or correct, the fail-closed hold, and the admin
    banner.
22. **Maintenance cron:** source health and cost totals.
23. **Pre-deploy checklist, production deploy, crons on, one-week burn-in.**
