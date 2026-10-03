@AGENTS.md

# Standing rules from the owner

These add to AGENTS.md. They apply to research and one-off scripts as well as
to the app and pipeline.

## Fetching

- **No fetches of any kind from unpermitted sources.** That means Walton Arts
  Center (waltonartscenter.org), the Walmart AMP (walmartamp.com,
  amptickets.com; WAC runs it), Crystal Bridges (crystalbridges.org), and the
  Momentary (themomentary.org). It includes research, WebFetch, curl, robots.txt
  and terms checks. Cite a city page, a tourism listing, or Wikipedia instead.
  Status of each source: `docs/sources-terms.md`.
- **A block means stop.** If a site blocks or refuses a fetch (401, 403, 406,
  429, 451, a bot challenge, a robots disallow, terms that bar automated access,
  or a tool refusing), stop. Don't retry with a different tool, user agent, or
  route. Record it and ask the owner. In code, `botFetch`
  (`src/lib/http/fetch.ts`) throws `FetchBlockedError`, and ESLint forbids
  calling `fetch` anywhere else.
- **Displayed links are not fetches.** Showing a URL as a link (a venue's
  website, an event's ticket link) doesn't fetch it, so it's allowed for any
  site, subject to `link_policies`.
- **Owner-verified sources.** When a tool can't read a site (client-side
  rendering, or it refused us), the owner checks it in their own browser. Record
  it as `verifiedBy: "owner"` with what they confirmed, the URL, and the date.

## Data

- **Facts only; never copy source descriptions.** Store who, what, where, when,
  price, and link. Our own descriptions are generated from the facts.
- **Physical address over mailing address** when a venue lists both.
- **ZIP codes:** fill a missing ZIP from the Census geocoder's match and cite it.
  Leave it empty only when the geocoder has no match. Don't overwrite a sourced
  ZIP; a disagreement is flagged as a warning in the report.

## Venue verification

- **A geocoder mismatch over 1 km is an error** that blocks sign-off, except for
  parks (trails are typed as parks) and campuses. Never add logic that
  downgrades it. Enforced in `src/lib/venues/verify.ts`.
- **Hand checks are recorded and never clear errors.** When a hand check
  accepts a warning, add it to the venue's `handChecks` (what was checked, the
  source, the date). It prints next to the warning in the report. State only
  what was actually checked.
- **Sign-off is the owner's.** Never set `reviewed` in `data/venues.seed.json`
  yourself.
