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
- **Coverage area:** organizers outside Benton and Washington counties aren't
  added (`organizers.county`).
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
- `missed`: the owner picks a reason. "No source" opens a registry task.

The weekly report shows live coverage and potential coverage (live plus
shadow), so a source's value shows before it's promoted.

## Schema (migration 0029)

- `organizers`: name, type, website, city, county, channel (feed /
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
3. Migration 0029. Done.
4. `/admin/benchmark`.
5. Tier 2 registry seeding (agent-verified, logged).
6. The discovery agent, producing proposals.
7. The structured-data fetcher (event data from pages, no AI).
8. Monthly re-discovery in the maintenance job (first-of-month guard; each
   change logged).
9. Terms review of specialist platforms: RunSignup's API, MarketSpread and
   similar; Macaroni KID and TV station listings as leads only.
10. The submission form and invite email template.
