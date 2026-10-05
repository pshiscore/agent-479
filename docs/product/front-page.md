# 479 Guide: front page and event experience

A design reference for the homepage (build step 18) and the steps after it.
Owner decisions of 2026-10-04 are included. Nothing here is built yet except
the content checks in section E. The content rules in section E are
also standing rules in `AGENTS.md`, because they govern all generated text.

## A. Design direction

- **Inspired by The Verge's design principles, not its layout or branding:**
  strong typography hierarchy, a confident grid, bold section headers, one
  accent color, and big features next to a fast-scanning list.
- **Simpler than The Verge:** few sections, plenty of space, nothing that
  needs explaining.
- **Mobile first.** Most visitors will be on phones, so every component must
  work at phone width first.
- **Light and dark themes,** accessible contrast, and keyboard navigation.
- **Type carries the design.** Bold type must work on its own, because many
  events will have no usable image.

## A2. Chosen layout (owner, 2026-10-04: option 2 of the mockups)

- **Header:** the 479 Guide wordmark; This weekend, Upcoming, Venues, Lists;
  a search box. (No digest sign-up button: email delivery is for later.)
- **Friday digest hero banner** (owner, 2026-10-04): the digest is posted
  every Friday morning and shown as a hero banner at the top of the front
  page, with a short summary of the weekend (for example how many events, a
  few highlights by rule) and a link to the full digest. Email sign-up and
  delivery come later.
- **Filter bar** under the header: City, Category, Free, Family-friendly,
  21+, En español, and "Show recurring".
- **Main column:** "This weekend" as a day-by-day timeline (a dot and line
  per day; time, title, venue and city links, category and up to 3 tags,
  "More info", and an interested star).
- **Right column:** the Feature card (date, title, venue and city, tags,
  "More info", "Get tickets"); Lists (name and count); What's new (at most 5
  items and a "See all new places" link to /new). Without a right column,
  What's new goes directly after "This weekend"; on phones it follows the
  weekend list.
- **Full width below:** "At the library this week",
  "Further out" (date, title, time, venue, and a "See all upcoming" link to
  the full Upcoming view), then the footer ("479 Guide lists events from
  public sources across Northwest Arkansas. Summaries are generated from
  those listings and link to the original." with About Agent 479, Report an
  issue, and For site owners).
- Warm brown and green palette with bold sans headings; light and dark
  themes still required (section A).

## B. Front page sections, top to bottom

1. **Feature:** the single most noteworthy upcoming event. What counts as
   noteworthy is set by rules (section E).
   - Built in step 18. It selects one event by config rules, starting with:
     newly announced in the last 7 days, then the large-venue tier.
   - It shows event facts only, with no generated story text.
   - Each choice is logged with the rule that selected it.
2. **This weekend / This week** (owner, 2026-10-04: both): a switch at the
   top of the section. "This weekend" is Friday to Sunday (the coming one
   once the current one is over); "This week" is today and the next 6 days.
   Variety rules: at most 2 per venue on the weekend (3 for the week),
   spread across cities and categories.
3. **Just announced:** generated stories about newly announced events.
   *Moved to Phase 1b (owner, 2026-10-04); not part of step 18.*
4. **Lists:** rule-based collections such as "Free this weekend",
   "Family-friendly this week", and "New venues". No taste-based rankings.
5. **At the library this week:** a collapsed shelf, so library programs don't
   crowd out everything else.
6. **What's new:** factual cards for places that just opened or are about
   to (section H), in the right column under Lists, with a link to /new.
7. **Upcoming:** all events by day, filterable by city, category, tag, and
   venue type.
   - Recurring events are hidden by default and shown as series rows
     ("Storytime, Tuesdays, next: Oct 6"), with a "Show recurring" toggle.
   - The venue-type filter ("At the library", "At a park") works here, in
     search, and on city pages. The library shelf (5) is homepage-only.

## C. Event card

- **Compact:** title, date and time, venue, city, category, and up to 3 tags.
- **Entities:** venue, city, and category each link to their own page listing
  upcoming events for that venue, city, or category.
- **Tags describe the event:** Free, Ticketed, Family-friendly, 21+,
  Registration required, En español, Volunteer, Outdoor, Dog-friendly,
  Biking.
  - Tags come only from the controlled tags table.
  - The model may propose new tags, but never create them.
- **Community signal:** our own users' signals only (interested count, thumbs
  up/down), never third-party reviews. Counts are hidden below a threshold,
  starting at 5.
- **"More info"** opens the expanded card.

## D. Expanded card (event page)

- **Every event has its own URL** (`/events/<slug>`; see section F for all
  URL namespaces).
  - From a list, it opens as an overlay (a full-screen sheet on mobile) and
    updates the URL.
  - Visiting the URL directly shows the full page.
- **Contents:**
  - one summary in our own words, written from the event's facts;
  - date, time, and venue, with a "Directions" link: it opens the device's
    map app (Apple Maps on iOS, Google Maps elsewhere) at our venue's
    coordinates. No map provider and no map API calls for now;
  - price and ticket link, when stated;
  - age range and registration, when stated;
  - tags;
  - a link to the official listing;
  - a "Last checked" time;
  - add to calendar (ICS), share, and report an issue.
- **Sources:** never copy descriptions from official sites, and never fetch
  from sources awaiting permission. The official site appears only as a link.
- **Structured data:** schema.org Event JSON-LD on every event page.

## E. Content rules (no editorial)

These rules are also standing rules in `AGENTS.md`.

- **We report what is out there.** No opinions, reviews, taste-based
  recommendations, or rankings ("best", "must-see", "don't miss").
- **Voice is allowed; evaluative claims are not.** The friendly digest
  format, emoji, and puns are fine.
- **Facts only from our records or a cited, permitted source.** Generated
  text may state nothing else: no background facts from the model's own
  knowledge (artist bios, awards, chart history, "Grammy-winning").
- **Generated text is labeled.** Every generated story and summary shows its
  sources and when it was generated, and is labeled as generated from public
  listings. The event page shows "Summary generated <date> from public
  listings" (`events.description_generated_at`).
- **Generated text is checked in code** before it's saved:
  - **Evaluative words:** text with words like "best", "must-see", "don't
    miss", "amazing", "incredible", "legendary", "iconic", "world-class", or
    "unforgettable" is flagged. The list lives in config. Only our generated
    text is checked, never the event's own title, so an event named "Best of
    Broadway" passes.
  - **Grounding:** every proper name and every number in a generated
    description must appear in that event's stored facts (title, venue,
    city, performers, dates, prices, ages, and the activity phrase taken from
    the source's own listing). Anything else is flagged. This catches
    background the model adds from its own knowledge.
  - **Glossary:** acronym expansions that count as facts (ESL, GED), only
    for events whose facts contain the acronym. Only the owner adds entries;
    an unknown expansion is logged as a proposal.
  - Flagged text is regenerated once; if it fails again, it's held for
    review and the event shows no summary.
- **"Noteworthy" is decided by rules, never judgment.**
  - Starting rules: newly announced in the last 7 days; the first appearance
    of a performer or event in our data; a returning annual event; a
    large-venue show (by venue capacity tier); a high interest count.
  - Rules and weights live in config.
  - Each feature choice is logged with the rule that selected it.
- **Stories about real people stick to event facts:** who is performing,
  where, when, and tickets.
- **Images:** only from sources whose terms permit display, with the
  permission recorded per source. Never take images from venue or artist
  websites without permission.

## F. Tags, search, and follows

- **Every filtered view is a URL** (for example,
  `/city/bentonville?tags=free,family-friendly&venue_type=library`).
- **URL namespaces:** entity pages live under `/city/<slug>`,
  `/venue/<slug>`, `/category/<slug>`, and `/events/<slug>`. Nothing user- or
  data-named ever sits at the root. System paths (`/admin`, `/bot`,
  `/robots.txt`, `/api`, and the others) are reserved, and a test checks that
  no seeded slug can collide with one.
- **Filters:** city, category, tag, and venue type, in every view that lists
  events.
- **Each view can later become** a follow (an email or Slack alert when new
  matching events appear), an ICS calendar feed, and a JSON feed for AI
  assistants. Design URLs and filters with this in mind now.
- **Search** covers events, venues, and stories, with tag and entity filters.

## H. What's new (openings)

Owner, 2026-10-04: whenever something new opens, such as a restaurant or an
attraction, it gets a factual card, and a longer "What's new" view lists
openings over a longer period.

- **Openings are places, not events.** They need their own records: name,
  kind (restaurant, bar or brewery, attraction, shop, park, venue), address
  and city, the date it opened, and the link to the source that says so.
- **Facts only** (section E): "Opened October 2" is a fact; "a must-try new
  spot" is not. No descriptions copied from the business, no reviews, no
  ratings, and images only under the image rule.
- **Every opening needs the owner's approval** before it appears: the agent
  finds a candidate in a permitted source and logs a proposal; the owner
  approves or rejects it in /admin/proposals.
- **Sources need a terms review first,** like any source. Candidates:
  chamber of commerce ribbon-cutting calendars, city and downtown
  association announcements, and tourism sites' "new" listings. News sites
  are out unless their terms allow it.
- **Windows (owner, 2026-10-04):** 30 days on the homepage, 90 days on
  `/new`, both counted from the opening date, not the date we found it.
  The homepage shows at most 5 items; `/new` filters by city and kind. The
  section hides when there's nothing new.
- **"Opening soon" and "Now open" are kept separate:**
  - "Opening soon" only when a source states a target date or month, shown
    as the source states it ("Opening in November").
  - An item moves to "Now open" only when a source confirms the opening; the
    change is logged with its source.
  - If a stated opening date passes by 30 days with no confirmation, the item
    is hidden and flagged for a re-check. Stale "opening soon" items never
    stay up.
- **A new venue that hosts events** also appears in the "New venues" list
  (section B4) once it's in our venues.

## G. Open questions for later

- **Digest by email** (later): which email provider, and where subscriber
  addresses are stored. Nothing collects emails yet.
- **Embedded map** on the event page: which provider, and is it worth the
  cost and the third-party requests? For now the page has a "Directions" link
  only.
- Do interested counts and follows need accounts, or can they start
  anonymous?
- Which sources permit image display, and what is the fallback design without
  images?
