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

- **Header:** the 479 Guide wordmark; Upcoming, New in Town, Venues, Lists
  (owner, 2026-10-06: This weekend and This week are left to the
  homepage's switch);
  a search box. (No digest sign-up button: email delivery is for later.)
- **Friday digest hero banner** (owner, 2026-10-04): the digest is posted
  every Friday morning and shown as a hero banner at the top of the front
  page, with a short summary of the weekend (for example how many events, a
  few highlights by rule) and a link to the full digest. Email sign-up and
  delivery come later.
- **Filter chips** under the header (owner, 2026-10-04; replaces the filter
  bar). The logic and URL parameters are unchanged; only the look and the
  interaction changed.
  - Dropdown chips: City, Category, Venue type. Selected, a chip turns green
    and shows the value with an x to clear it.
  - Toggle chips: Free, Family-friendly, 21+, En español, with a check when
    on.
  - A "Show recurring" switch at the right.
  - "<n> events" on listing pages; "Clear all" only when a filter is on.
  - Every chip is a link to the filtered URL. Chips apply at once with a soft
    navigation that keeps the scroll position, and they work without
    JavaScript. Menus are `<details>` with keyboard support (arrows, Escape
    returns focus).
  - On phones the chips sit behind a sticky "Filters (n)" button that drops
    them down, and menus open as bottom sheets.
  - One component: `FilterChips` (`src/app/(site)/_components/filter-chips.tsx`).
- **Theme switch** in the header: Auto (follows the device), Light, or Dark,
  remembered in the browser.
- **Main column:** "This weekend" as a day-by-day timeline (a dot and line
  per day; time, title, venue and city links, category and up to 3 tags,
  "More info", and an interested star).
- **Right column:** the Feature card (date, title, venue and city, tags,
  "More info", "Get tickets"); Lists (name and count); New in Town (the 5
  most recent openings and a "See all new places" link to /new). Without a
  right column, New in Town goes directly after "This weekend"; on phones it
  follows the weekend list.
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
6. **New in Town:** factual cards for places that just opened or are about
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

## H. New in Town (openings)

Owner, 2026-10-04: "New in Town" replaces the name "What's new" everywhere.
Whenever something new opens, it gets a factual card and its own page.

- **Navigation:** This weekend, This week, Upcoming, **New in Town**, Venues,
  Lists.
- **Pages:**
  - `/new`: the landing page, one block per category. Start with
    **Restaurants** (cafes, bakeries, bars, breweries, and food trucks
    included); later Shops, Venues, Outdoors. A category with no items is
    hidden.
  - `/new/<category>` (e.g. `/new/restaurants`): places that opened in the
    last **6 months**, newest first. The heading is computed, never written:
    "Restaurants opened since <month>" with the count.
  - `/place/<slug>`: each place's own page (entity namespace rule). Full
    pages first; the overlay comes for events and places together in step
    19 (owner, 2026-10-04).
  - **Homepage:** the sidebar module "New in Town" shows the 5 most recent
    openings from the same 6-month window (replacing the earlier 30-day
    homepage and 90-day /new rules).
- **Windows** count from the opening date, never the date we found it.
- **A place appears only with a stated opening date from a source.** No
  date, no listing.
- **Place card and page:**
  - Name, type (Bakery, Brewery, Coffee shop, ...), address, and city (links
    to `/city/<slug>`).
  - The opening date exactly as the source states it: "Opened Aug 10, 2026"
    or "Opened June 2026" (day or month precision), with the source's own
    qualifier in brackets when it has one: "Opened June 2026 (soft
    opening)", "Opened Aug 18, 2026 (grand opening)".
  - **Addresses:** a street address, or an intersection ("W McMillan Dr at W
    Wedington Dr"), flagged internally as "street number unconfirmed" until
    the owner supplies it. Food trucks are listed only when the source
    states a home base, shown as "Based at <location>".
  - A label from the place's `kind`: New, New location (an existing business
    in a new spot), Moved (relocation), Reopened; plus "Just opened" when
    the opening date is within 30 days.
  - An optional short description in our own words, only from facts the
    source states; all section E rules apply (evaluative words, grounding,
    generated-at timestamp). No menu items, ingredients, or features unless
    the source states them. Nothing beyond name and type stated: no
    description.
  - Links: the official website; Directions; "Reviews on Google Maps" (a
    plain link in Google's documented Maps URL format, searching by name and
    address: no API, no key, nothing stored); and the source link with a
    "Last checked" date. For intersection addresses, Directions and Maps
    links search for the business name plus the intersection and city, so
    Maps resolves to the business.
  - **Directions, for places and events alike:** the link's default is a
    Google Maps URL, which works on every device without JavaScript; a small
    client-side enhancement switches it to Apple Maps on Apple devices.
    Never decided by user agent on the server, so pages stay statically
    cacheable.
  - schema.org markup (LocalBusiness and its food types) on place pages,
    with no ratings or reviews.
- **Google ratings and reviews** (owner, 2026-10-06; replaces "no review
  content anywhere"): only inside Google's own Place Details element on the
  place page, loaded when the visitor taps "Show Google ratings and
  reviews"; nothing from Google is stored except the owner-confirmed place
  ID. The "Reviews on Google Maps" link stays visible. Rules in AGENTS.md
  (Content rules). Google is never a source for our facts.
- **"Opening soon" and "Now open" are kept separate:**
  - "Opening soon" only when a source states a target date or month, shown
    as the source states it ("Opening in November").
  - An item moves to "Now open" only when a source confirms the opening; the
    change is logged with its source.
  - If a stated opening date passes by 30 days with no confirmation, the item
    is hidden and flagged for a re-check. Stale "opening soon" items never
    stay up.
- **Facts only** (section E): name, type, address, opening date, source
  link. No descriptions copied from the business, no reviews or ratings in
  our own text (Google's appear only in Google's component), and images only
  under the image rule.
- **Sources:** only those approved in the opening-sources terms review
  (`docs/sources-terms.md`). Places the owner adds or confirms in the
  browser are recorded as owner-verified.
- **Places are separate from venues.** When a place is also one of our
  venues, the two are linked.
- **Every add, edit, publish, and hide is logged** like other agent actions.
- **Admin:** an "Add a place" form (name, type, kind, address, city, opening
  date exact or month, website, source URL, notes, and a required "Open to
  the public" checkbox); owner entries are owner-verified. Places can be
  saved as drafts (not public) and published later. **A place can't be
  published unless it's open to the public** and has a stated date and an
  owner-verified or approved source.
- **Venue matching:** the admin form suggests matching venues by address and
  name; the owner confirms. Never linked automatically.
- **Built (step 2, 2026-10-05):** `/new`, `/new/<category>`,
  `/place/<slug>`, the homepage module, and the menu link
  (`src/lib/places/public.ts`, `src/app/(site)/_components/places.tsx`).
  Details settled in the build:
  - The 6-month window starts on the 1st of the month 6 months back
    (Chicago time), so "opened since April 2026" also holds for
    month-precision dates.
  - "Just opened" needs a stated day; a month-only date never qualifies.
  - "Opening soon" places are listed in their own block on `/new` and on
    each category page, never mixed into the openings.
  - A place page lists only owner-checked sources, each with "Last
    checked".
  - Maps queries are "<name>, <address>, <city>, AR". schema.org markup has
    a street address only when the address is a street address.
- **Built (step 3, 2026-10-05): descriptions** (`src/lib/places/describe.ts`).
  - The facts come from the owner: when recording a source they checked,
    the owner may add "other facts this source states", in their own words
    (stored on that source, so each fact cites it).
  - A fact counts only if it says something the name and type don't. With
    none, there's no model call and no description.
  - The owner asks for it ("Write description" on the admin page). The write
    is a logged agent action with the model and LLM call. The checks are
    evaluative words, grounding (names and numbers must be in the facts),
    and each claimed fact must appear in the text. A failure is regenerated
    once, then held (logged, nothing stored).
  - Changing a source's stated facts removes a description written from the
    old ones, in the same logged update. The owner can also remove one.
  - Shown only on the place page, with "Summary generated <date> from the
    sources below."

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
