# 479 Guide: front page and event experience

A design reference for the homepage (build step 18) and the steps after it.
Nothing here is built yet (2026-10-04). The content rules in section E are
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

## B. Front page sections, top to bottom

1. **Feature:** the single most noteworthy upcoming event or story. What
   counts as noteworthy is set by rules (section E).
2. **This weekend:** a scannable Friday-to-Sunday list, with variety rules:
   at most 2 per venue, spread across cities and categories.
3. **Just announced:** generated stories about newly announced events.
4. **Lists:** rule-based collections such as "Free this weekend",
   "Family-friendly this week", and "New venues". No taste-based rankings.
5. **At the library this week:** a collapsed shelf, so library programs don't
   crowd out everything else.
6. **Upcoming:** all events by day, filterable by city, category, and tag.

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

- **Every event has its own URL** (`/events/<slug>`).
  - From a list, it opens as an overlay (a full-screen sheet on mobile) and
    updates the URL.
  - Visiting the URL directly shows the full page.
- **Contents:**
  - one summary in our own words, written from the event's facts;
  - date, time, and venue, with a map;
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
  listings.
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
  `/bentonville?tags=free,family-friendly`).
- **Each view can later become** a follow (an email or Slack alert when new
  matching events appear), an ICS calendar feed, and a JSON feed for AI
  assistants. Design URLs and filters with this in mind now.
- **Search** covers events, venues, and stories, with tag and entity filters.

## G. Open questions for later

- Do interested counts and follows need accounts, or can they start
  anonymous?
- Which sources permit image display, and what is the fallback design without
  images?
