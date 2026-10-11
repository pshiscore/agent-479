# Festivals and community events

Approved by the owner 2026-10-05. Terms findings are in
`docs/sources-terms.md` (festivals review); standing rules are in AGENTS.md
("Festivals and the review queue", "Coverage area", rule 11).

## Goal

Reliably capture festivals, fairs, markets, parades, and community
celebrations in Benton and Washington counties. Most publish automatically;
anything uncertain waits in `/admin/review`, unpublished (fail closed).

## Decisions (owner, 2026-10-05)

1. Database stays Supabase (production) and local Postgres (development).
   Back up production before every migration (rule 11, `docs/BACKUPS.md`).
2. Destination Rogers and the Fayetteville Flyer blocked us: permission or
   feed emails drafted in `docs/outreach/`. Rogers is covered by the city
   calendar and registry pages meanwhile.
3. Visit Bentonville: permission email drafted. Aggregator dates alone
   always go to review unless they match an official page.
4. Eventbrite: on hold. No requests.
5. Leads: no search service. Unconfirmed items get a "Search the web" link
   (the owner's browser; nothing fetched); a pasted official URL is recorded
   as owner-verified.
6. The publish gate covers Festivals & Markets, registry matches, and events
   spanning 2+ days; other events keep today's flow.
7. Each registry official domain is a source row, enabled only by a passing
   test fetch.
8. Seasonal events (First Thursday, monthly April to October) use a season
   rule and become a recurring series.
9. The War Eagle Fair and the War Eagle Mill fair are separate registry
   entries; aliases never merge different festivals (with a test).
10. Coverage area: Benton and Washington counties. Hillberry (Eureka
    Springs) is dropped from the checklist; The Auditorium (Eureka Springs)
    is deactivated through the venue process. Events outside the area never
    auto-publish; they go to review flagged "outside coverage area".
11. Q4: step 1 first, so the owner can enter festivals by hand.
12. Newsletters: the owner names them later; Google's terms for Alerts are
    confirmed before the leads inbox is built.
13. Registry additions approved: Frisco Festival, Bella Vista Arts & Crafts
    Festival, Joe Martin Stage Race, Artosphere (cited from city or tourism
    pages only, never fetched from Walton Arts Center).

## Build order (one approval each)

1. **Review page and "Add event" form** (migration 0022, `event_proposals`).
   Built 2026-10-05: `/admin/review` (approve, edit and approve, reject with
   a reason, merge into an existing event, record a checked source, "Search
   the web"), `/admin/review/new` ("Add and publish" or "Save for review").
   Approved events come from the never-fetched `owner` source. The form
   stores the end date and time and, when the page states them, per-day
   hours (migration 0023, `event_days`; "same hours every day" or one line
   per day), so festivals entered now need no re-entry when step 2 shows them.
2. **Multi-day events.**
   - **2a, built 2026-10-06 (no migration):** lists match by overlap, so a
     festival that started earlier still appears; a multi-day event (all
     day, 24+ hours, or stated hours on 2+ days, so a late show isn't) is
     listed once, on its first day in view, with its range ("Oct 15–18"),
     "Day 3 of 4" when the view starts mid-run, and that day's stated
     hours; runs of 8+ days (`ONGOING_MIN_DAYS`) go to an "Ongoing" strip
     ("Through Jan 1") instead of the timeline, and don't hold the homepage
     on a finished weekend. Counts once toward the caps. Code:
     `src/lib/site/multiday.ts`.
   - **2b, live 2026-10-11** (migration 0024, `events.parent_event_id`):
     "Part of" in Add event and Edit and approve; "Festival parts" on
     /admin/review links events already listed (a parade from the city
     calendar) to their festival, logged. A part must start within the
     festival's dates, and parts can't have parts. Lists show "Part of
     Lights of the Ozarks" on a part and "Includes: Light Night (Nov 21),
     Parade (Dec 4)" on the festival; parts from sources that can't be shown
     publicly aren't named.
3. **Annual events registry** with a verification report for sign-off,
   including the season rule and the War Eagle pair test. **County from
   coordinates** (owner, 2026-10-05): each venue's county comes from the
   Census geocoder's geographies lookup on its coordinates and is stored on
   the venue; the town list is only a fallback. Backfill every existing
   venue and report any outside Benton and Washington counties.
4. **Publish gate**, organizers, and the "outside coverage area" flag.
5. **Registry checker:** weekly official-page checks from 120 days before,
   "expected, not found yet" at 30 days, re-checks 7 days and 1 day before.
6. **Daily summary email** (Cloudflare Email Worker, to the owner's verified
   address; free).
7. **Coverage report** from `tests/fixtures/festivals-2026-q4.json` (the
   owner verifies it before it counts).
8. **Leads inbox** (leads@479.guide through a Cloudflare Email Worker).
9. **New discovery sources**, after permissions.
