# Organizer registry, feed discovery, and the benchmark

Owner decisions, 2026-10-16 (the plan approved with changes), plus the
shadow-mode fixes of 2026-10-17. Shadow mode itself is in AGENTS.md
(Sources). This file holds the rest so it isn't only in chat.

## Decisions

- **Everything new starts in shadow.** Nothing from a new source publishes
  until the owner approves it in `/admin/review`, event by event or by
  promoting the source.
- **The registry needs no owner sign-off.** Organizer entries are internal
  pointers, not published facts. The agent verifies each against the
  organizer's own site, records where (`organizers.verification`), and logs
  it. The owner approves feeds (sources) and events.
- **Seeded in tiers.**
  - Tier 1 (done 2026-10-16): Siloam Springs (Main 14, Parks and Recreation
    25, Library 27) and Pea Ridge's iCal feed are in shadow. Fayetteville
    Volunteer Opportunities (36) waits: its feed had no events at the test
    fetch.
  - Tier 2: organizers with websites: downtown organizations, chambers of
    commerce, libraries, our venues that run their own calendars, and
    wineries, breweries, and event farms with public events.
  - Tier 3: social-only organizers (most fire departments, many festivals),
    added only when a benchmark miss points to one. We never fetch social
    media.
- **Coverage area applies to events, not organizers** (owner, 2026-10-17).
  An organizer based elsewhere (Vintage Market Days, statewide media hosts,
  race companies) is added when it holds events here. Its home county and
  state are stored as facts (nullable), with `holds_events_in_area` (yes /
  no / unknown). Out-of-area events are still held in review, as for any
  source.
- **Venues and organizers are separate tables**, linked
  (`organizers.venue_id`) when a venue runs its own calendar.
- **Feed discovery** records the robots.txt result, the terms page link, and
  flagged phrases ("automated", "scrape"); the owner decides. Approving a
  discovery creates a disabled, untested source; the normal test fetch and
  enable steps follow, and the source starts in shadow. A disallowed feed is
  never approved (enforced in the schema). Public .gov calendar feeds
  published for subscribing get one-click approval, with the robots result
  and any flagged phrases shown.
- **AI reading of plain HTML pages** is a last resort: per organizer, with
  the owner's approval, and always in shadow first.
- **Blocked or unclear sites:** the owner checks Bella Vista, Gentry,
  Gravette, and Winslow in the browser. Feed or permission emails go to
  Lowell, Lincoln, and Tontitown. Washington County's site is skipped.
- **Submissions** (built last, closer to launch): always go to review in v1.
  The privacy page is updated first; only the submitter's email is collected,
  deleted 30 days after a decision; invisible anti-spam (a hidden field and
  a timing check), no CAPTCHA.

## The benchmark

The owner types the names and dates of events from a roundup they read
each week. Nothing else from the roundup is stored. Each line is matched by
title similarity within the typed date ±1 day; a multi-day event matches
when the typed date falls inside its range. Each line's result is one of:

- `live`: a published event.
- `review`: waiting in the review queue.
- `shadow`: a shadow source has it ("would have caught").
- `missed`: the owner picks a reason (code suggests one when it saw a
  rejected item or hidden event). "No source" opens a registry task.

Miss reasons: no source, social only, not in the feed, filtered, rejected,
wrong details, outside coverage area, permission pending (Crystal Bridges,
for example), source not enabled (proposed or paused), and other. An event
we hold in review outside the coverage area is recorded as missed, outside
coverage area, by code.

Items missed as outside the coverage area are left out of the total and
shown as a count. The weekly report shows live coverage (live over the
total) and potential coverage (live, review, and shadow together over the
total), with a trend, so a source's value shows before it's promoted. Weeks
can be re-checked as sources keep fetching; a match the owner marked wrong
stays missed.

## Schema (migrations 0029 and 0030)

- `organizers`: name, type, website, home city, county, and state,
  whether it holds events in the coverage area, channel (feed /
  structured page / HTML page / social only / newsletter / unknown), status
  (candidate / verified / retired), last checked, notes, venue link,
  verification.
- `feed_discoveries`: organizer, URL, kind (iCal / events API / RSS / page
  data / HTML), platform, robots result, terms link and flags, up to 5 sample
  events (facts only), suggested filters, status (proposed / approved /
  rejected / gone), first and last seen, the source approval created.
- `events.organizer_id`.
- `benchmark_weeks` (a Monday, Chicago calendar) and `benchmark_items` (name,
  date, result, what it matched, miss reason, registry task).

## Build order (owner approval after each step)

1. Shadow source state and the "By source" review view. Done.
2. Tier 1 into shadow. Done.
3. Migration 0029. Done; fixes in 0030.
4. `/admin/benchmark`. Done.
5. Tier 2 registry seeding (agent-verified, logged). Done 2026-10-17: 67
   organizers, 50 verified against their own home page. The list is in
   `src/lib/organizers/seed-data.ts`; `npm run organizers:check` checks each
   site (robots.txt, then the home page, which must name the organizer)
   into `data/organizers.check.json`; `npm run db:seed:organizers` applies
   both, logged as `agent:registry`. A candidate says why in its notes.
   `/admin/organizers` lists them.
6. The discovery agent, producing proposals. Done 2026-10-17
   (`npm run discover:feeds`, `/admin/discoveries`). Only working feeds with
   events become proposals, one per set of events (every CivicPlus calendar,
   else iCal over page data over RSS); meeting, board, and closure calendars
   and feeds we already read are skipped; a robots-disallowed feed is listed
   in the run summary, not proposed. Approving creates a disabled, untested
   source in `proposed`. Google Calendar feeds are not fetched (owner to
   decide; `docs/OPEN_ITEMS.md`).
7. The structured-data fetcher (event data from pages, no AI). It never
   applies to sources awaiting permission or to blocked domains: reading
   JSON-LD is still automated fetching, under every fetching rule
   (robots.txt, terms, a block means stop). Done 2026-10-17: the `jsonld`
   fetcher (`src/lib/sources/fetchers/jsonld.ts`) reads schema.org events
   from one page (or up to 5, following the page's own same-site "next"
   link), keeps whitelisted facts, stages the description internally, and
   refuses sources awaiting permission or blocked and pages on another site.
   Times are strict: an offset must be Chicago's actual offset on that date,
   or the record fails. Approving a page-data discovery makes a `jsonld`
   source, tested and enabled like any other.
8. Monthly re-discovery in the maintenance job (first-of-month guard; each
   change logged). Done 2026-10-17 (`src/lib/discovery/rediscover.ts`): each
   verified organizer is due once per Chicago month
   (`organizers.discovery_checked_at`); from the 1st, the daily maintenance
   job works through due organizers in its leftover time, stopping cleanly
   (a look cut short marks nothing gone and stays due). New feeds become
   proposals, waiting proposals not found again are marked gone, rejections
   stand. A block sets `organizers.discovery_blocked`, shown on the admin
   overview, and is never retried until the owner clears it.
9. Terms review of specialist platforms: RunSignup's API, MarketSpread and
   similar; Macaroni KID and TV station listings as leads only.
10. The submission form and invite email template.
11. Later: ICS subscription feeds and a JSON feed for each filtered view
    (`docs/product/front-page.md`, section F), after the Ticketmaster display
    terms review. Feeds carry only our own facts plus source links, never
    Google data, and live at their own URLs, not under `/bot`.
