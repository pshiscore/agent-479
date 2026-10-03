# Source terms review (build step 0)

Reviewed 2026-10-03. This is a practical reading of each source's published
terms and robots.txt, not legal advice. Re-check a source's terms before
changing how we use it, and before any monetization.

**Rule:** where a site's terms are stricter than its robots.txt, the terms
win.

## Summary: values for the `sources` seed (build step 7)

| slug | enabled at launch | commercial_use_ok | trust | terms_notes (short) |
|---|---|---|---|---|
| `ticketmaster` | yes | **no** | 4 | API terms: storage only for "reasonable periods", no replicating Ticketmaster, no API-derived revenue. Facts and links only. |
| `city-bentonville` | yes | unknown | 4 | CivicPlus public ICS. Footer says "All rights reserved", no reuse terms. Facts and links only. |
| `city-rogers` | yes | unknown | 4 | Same as Bentonville. |
| `city-fayetteville` | yes | unknown | 4 | Same as Bentonville. |
| `library-rogers` | yes | unknown | 4 | Public LibCal subscription feed. No website terms published. |
| `library-fayetteville` | yes | unknown | 4 | Public Communico subscription feed. Policies page covers building use only. |
| `walton-arts-center` | **no** | unknown | 5 | **Awaiting permission.** No terms of use published. |
| `crystal-bridges` | **no** | **no** | 5 | **Awaiting permission.** Terms ban all robots and links to pages other than the homepage without consent. |
| `the-momentary` | **no** | **no** | 5 | **Awaiting permission.** Its footer "Terms of Use" link points to the Crystal Bridges terms. |

**Change from plan v2:** Crystal Bridges and the Momentary move from
"enabled at launch" to **awaiting permission**. That leaves **6 sources
enabled at launch**: Ticketmaster, the three cities, and the two libraries.
Build step 11 (the museum fetchers) waits until permission is granted.

---

## Details

### Ticketmaster Discovery API
- **Terms:** <https://developer.ticketmaster.com/support/terms-of-use/>
  (last updated June 27, 2023)
- **Clauses that matter**, quoted:
  - "Cache or store any Event Content other than for reasonable periods in
    order to provide the service you are providing."
  - "Sell, lease, or sublicense the Ticketmaster API … or derive revenues from
    the use or provision of the Ticketmaster API, whether for direct
    commercial or monetary gain or otherwise."
  - "[Do not] use the Ticketmaster API for any application that replicates or
    attempts to replace the unique essential user experience of
    Ticketmaster.com."
  - "We reserve the right to rate limit or block applications that make a
    large number of calls to the API that are not primarily in response to
    direct user actions."
  - "Attempt to cloak or conceal your … application's identity" is prohibited.
- **How we comply:**
  - We keep only facts and links (whitelisted mapper fields) and purge raw
    payloads after 30 days.
  - We link to Ticketmaster for purchase, with no checkout of our own.
  - Fetches run every 6h with a small page count.
  - The API key is registered under the project's real name.
- **Monetization:** `commercial_use_ok = no`. Before adding sponsorships, get
  written approval from Ticketmaster (they have a partner program) or stop
  showing Ticketmaster-sourced listings on monetized pages. Added to the
  pre-deploy checklist.

### City of Bentonville, Rogers, and Fayetteville (CivicPlus)
- **Terms:** none beyond a footer copyright notice ("All content © … All
  rights reserved"). The `/site/copyright` pages contain only that notice.
  Privacy pages: <https://www.bentonville.ar.gov/privacy>,
  <https://www.fayetteville-ar.gov/site/privacy>.
- **robots.txt:** disallows `/RSS.aspx` and search and calendar view pages.
  The ICS endpoint (`/common/modules/iCalendar/iCalendar.aspx`) is allowed.
- **Reading:** the cities publish these ICS feeds for public subscription. We
  store facts (not copyrightable expression), write our own descriptions, and
  link back. Low risk, but there's no explicit grant, so the value is
  `unknown`.
- **Category IDs:** Bentonville 32 (Holidays and Community Events). Rogers 28
  (City Events). Fayetteville 30 (City-Sponsored Events) and 33 (Parks and
  Recreation). We never use public-meeting categories.

### Rogers Public Library (LibCal) and Fayetteville Public Library (Communico)
- **Terms:** neither library publishes website terms. Fayetteville's
  `/policies` page covers only physical library use. We couldn't find the
  vendor terms pages (Springshare, Communico) at their usual URLs. In any
  case, the libraries own the content and offer the feeds for subscription.
- **robots.txt:** LibCal blocks a list of named crawlers but not the
  `ical_subscribe.php` feed path for general agents. Fayetteville's robots
  disallows nothing relevant.
- **Value:** `unknown`. Courtesy option: a one-line heads-up email to each
  library once the site is live.

### Walton Arts Center
- **Terms:** none published. The site has only a privacy policy
  (`/privacy-policy-page/`) and ticketing policies. There's no robots.txt
  (that URL returns an HTML page).
- **Calendar:** a JavaScript app calling an undocumented `/api/Calendar/…`.
- WAC also operates the Walmart AMP, whose shows reach us through Ticketmaster.
- **Status:** per your decision, disabled until we have written permission.
  The email is in `outreach/wac-permission-email.md`.

### Crystal Bridges and the Momentary
- **Terms:** <https://crystalbridges.org/terms-and-conditions-of-use> (last
  modified April 1, 2026), between the user and "Crystal Bridges Museum of
  American Art, LLC". The Momentary's footer "Terms of Use" link points to the
  same document, and it lists "the Momentary" among its marks.
- **Clauses that matter**, quoted:
  - "[You agree not to] Use any robot, spider or other automatic device,
    process or means to access the Website for any purpose, including
    monitoring or copying any of the material on the Website."
  - "You must not … Cause the Website or portions of it to be displayed … by,
    for example, framing, deep linking or in-line linking … Link to any part
    of the Website other than the homepage."
  - Reproduction or republishing of material is prohibited except for
    personal, non-commercial use.
- **Conflict:** robots.txt on both sites allows event pages, but the terms
  forbid automated access outright. The terms win.
- **Effect beyond fetching:** without consent we also shouldn't deep-link to
  their event pages. That matters even if an event reaches us from another
  source, such as a city feed. Until permission arrives, any event at these
  venues links to the venue homepage or a ticketing link from another source,
  never to a crystalbridges.org or themomentary.org event page. This is
  enforced in code with a per-domain link policy, defined in step 7.
- **Status:** disabled, awaiting permission. The email is in
  `outreach/crystal-bridges-momentary-permission-email.md`.

---

## Skipped or deferred sources

| Source | Finding (2026-10-02/03) | Path forward |
|---|---|---|
| City of Springdale (`springdalear.gov`) | Non-browser requests get a JavaScript bot challenge. We don't get around these. | Ask for a feed (see `outreach/contact-notes.md`). |
| Downtown Springdale (`downtownspringdale.org`) | Squarespace. robots.txt disallows `?format=ical` and `?format=json`. | Ask for permission or a feed. |
| Springdale Chamber (`springdale.com`) | The Events Calendar plugin. Its `?ical=1` and REST endpoints currently return 0 events. | Re-check in Phase 1b. |
| Bentonville Public Library | Returns 403 to non-browser requests. | Ask for an ICS link. |
| Visit Bentonville | Simpleview RSS. Only a privacy policy found, no terms. It's an aggregator of other venues' events. | Phase 1b; ask first. |
| Experience Fayetteville | The calendar is a Vibemap embed (third-party aggregator). | Skip. |

**Coverage gap at launch:** Springdale and Bella Vista have almost no
coverage, and museum and arts-center events depend on the three permission
requests.
