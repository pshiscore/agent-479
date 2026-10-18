# Venues page

Owner decisions, 2026-10-17 (design spec reviewed by the owner).

## Rules

- **Public pages show only active venues in the coverage area**
  (`publicVenue` in `src/lib/site/queries.ts`; a DB test covers every public
  query).
- **Type groups, not a second category system** (`src/config/venue-groups.ts`):
  Parks & Trails, Music & Bars, Museums & Arts, Arenas & Theaters, Libraries
  & Civic, Event Spaces, Districts & Markets, and Other for venues still
  waiting for a type. A test fails if any type or active venue maps to no
  group or more than one. New types go through the venue report and the
  owner's sign-off.
- **Counts:** events in the next 30 days through the Upcoming page's own
  `listEvents` and `foldRecurring` (a recurring series once; hidden events,
  shadow items, and out-of-area venues never count; Ticketmaster exactly when
  Upcoming shows it).

## Phase A: the list (live 2026-10-17)

Single-column cards (name, type badge and city, the count or "View venue";
the exact count in the link's accessible label), the shared filter chips
(City, Venue type, Has upcoming events, Sort), and the URL as the state.
The list is ordered by upcoming events, most first (ties A–Z; owner,
2026-10-17); A–Z is the other sort (`?sort=az`).

## Phase B: the map (built 2026-10-17)

- MapLibre GL with a self-hosted Protomaps extract of our area, fonts, and
  sprites on our public R2 map bucket (terms: `docs/sources-terms.md`, Map
  tiles). No third-party requests; MapLibre's worker is served from our own
  domain (`scripts/copy-maplibre-worker.mjs`).
- Light and dark styles follow the site's theme. The corner credit,
  "Protomaps © OpenStreetMap", is always visible.
- Pins are our signed-off venue coordinates, never re-geocoded and never
  Google's; colored by type group (Okabe-Ito, white outline), clustered.
- Wide screens: the list beside the map. Phones: a List / Map switch; the map
  code and files load only when the map is shown.
- A pin scrolls to its card and highlights it. Each card has a "Show on map"
  button beside it (the card itself links to the venue page).
- Deferred: hover sync and "search as I move the map".
- The map shows only while `NEXT_PUBLIC_MAP_BASE_URL` is set; without it the
  page is the Phase A list, and the privacy page's map sentence is hidden.

**Refreshing the map data** (a few times a year): pick a recent build from
`build-metadata.protomaps.dev/builds.json`, run `npm run map:extract -- --build
YYYYMMDD.pmtiles` (with `MIGRATE_PRODUCTION=yes` for the run record), update
`MAP_FILE` in `src/config/map.ts` and the file name in `map-build/NOTICE.txt`,
`npm run map:upload`, then deploy.
