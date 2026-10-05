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
   Approved events come from the never-fetched `owner` source.
2. **Multi-day events:** parent and child events, per-day hours, range
   labels ("Oct 15–18", "Through Jan 1"), and weekend lists showing a
   festival once with "Day 2 of 4".
3. **Annual events registry** with a verification report for sign-off,
   including the season rule and the War Eagle pair test.
4. **Publish gate**, organizers, and the "outside coverage area" flag.
5. **Registry checker:** weekly official-page checks from 120 days before,
   "expected, not found yet" at 30 days, re-checks 7 days and 1 day before.
6. **Daily summary email** (Cloudflare Email Worker, to the owner's verified
   address; free).
7. **Coverage report** from `tests/fixtures/festivals-2026-q4.json` (the
   owner verifies it before it counts).
8. **Leads inbox** (leads@479.guide through a Cloudflare Email Worker).
9. **New discovery sources**, after permissions.
