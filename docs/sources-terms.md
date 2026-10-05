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

---

## New in Town (openings): candidate sources (review 2026-10-04)

Research only, nothing built or fetched by the bot. Checked with web search
and by reading robots.txt and terms pages; springdalear.gov (bot challenge)
and bentonvillelibrary.org (403) were not fetched. "Lead" means it can point
us at a likely opening but can't by itself support a card: under the owner's
rule, "Opening soon" needs a source stating a target date or month, and "Now
open" needs a source confirming the opening.

| Source | Offers | Format | robots.txt / terms | Commercial use | Updates | NWA items / month (est.) | Signal |
|---|---|---|---|---|---|---|---|
| Fayetteville permits (`maps.fayetteville-ar.gov` ArcGIS layer "Permit") | Permit no., type, work class (New Construction, Interior Only, Alteration, Shell), address, free-text description (sometimes the business name, e.g. a coffee drive-through or a golf simulator lounge), status, issue and final dates | ArcGIS REST API (JSON) | No robots.txt (404: unrestricted under RFC 9309); no license or use constraints in the layer metadata | Unknown (public record) | Nightly | Dozens of commercial permits; a few restaurant or shop finish-outs | Lead only (construction under way; no opening date, no certificate of occupancy in the layer) |
| Rogers permits (`permitting.rogersar.gov/publicportal`) | Online permit and license portal | Web app (account-based) | Not checked in depth | Unknown | Live | Unknown | Lead at best; the old monthly PDF reports in the city's archive stop around 2014 |
| Bentonville permits (eTrakit; Annual Development Report) | Permit tracking; yearly totals (1,354 permits, 716 certificates of occupancy in 2024) | Web app; annual PDF | Not checked in depth | Unknown | Live; reports yearly | Unknown | Annual report too late; portal a lead at best |
| Springdale permits | n/a | n/a | springdalear.gov shows a bot challenge to automated requests: not fetched (a block means stop) | n/a | n/a | n/a | Ask the city |
| Bella Vista permits | Only permit totals found (via news) | n/a | Not found | n/a | n/a | n/a | None found |
| Arkansas ABC weekly list (`dfa.arkansas.gov/.../YYYYMMDD_ABC_WeeklyReports.pdf`) | Statewide pending alcohol permit applications: business name, address, county, application type (NEW, TOL transfer, REP), permit type. **Also the applicant's personal name: never store it.** | PDF, weekly, predictable URL; archive back to 2017 | robots.txt allows (only two policy PDFs disallowed); no terms on the page | Unknown (public record) | Weekly | ~2-3 NWA applications a week (one sampled week: Mr Wok, Rogers; The Fermentary Public House; Mermaids, Fayetteville, a transfer) | Lead only (no opening date) |
| Arkansas Dept. of Health food inspections (`foodserviceprod.adh.arkansas.gov`) | Inspection reports, typed pre-opening, routine, follow-up, complaint; searchable by name, city, county, ZIP, date range | Web search form (ASP.NET), no API or export found | No robots.txt (unrestricted); no terms of use on the page | Unknown (public record) | As inspections happen | Unknown; a pre-opening inspection precedes every new restaurant permit | Strong lead ("about to open"), not a confirmation |
| Rogers-Lowell Chamber (`rogerslowell.com`) | Ribbon-cutting service; "Upcoming Ribbon Cuttings" posts in chamber news | HTML (Accrisoft) | robots.txt allows, Crawl-delay 5; terms not found | Unknown | Periodic posts | Several a month (an ambassador attended 50+ in a year) | Now open (a ribbon cutting confirms an opening, with a date) |
| Fayetteville Chamber (`fayettevillear.com`) | Member events; ribbon cuttings reported in the press | HTML | robots.txt allows all, with `Content-Signal: search=yes, ai-input=yes, ai-train=yes`; calendar URL not found yet | Unknown | n/a | Unknown | Now open, if a ribbon-cutting list exists |
| Greater Bentonville Area Chamber | Ribbon cuttings for members (weekdays, business hours) | Not found | Not checked | Unknown | n/a | Unknown | Now open, if listed |
| Business and venue announcements (own sites, official social accounts) | The business's own statement of an opening date | Varies | Per site | Per site | Ad hoc | Per business | Both; the best confirmation, but one site at a time |
| Talk Business & Politics (`talkbusiness.net`) | Frequent NWA opening stories with stated dates ("Sweetgreen's Bentonville store will open November 25"; periodic "restaurants, retail stores planned" roundups) | HTML; RSS at `/feed/` | robots.txt disallows AI crawlers by name (GPTBot, ClaudeBot, CCBot, Google-Extended, Applebot-Extended, Bytespider), not other agents; no terms page found; footer "All Rights Reserved" | Unknown; their robots.txt signals they don't want AI use | Daily | Several a month | Both (dates stated), but terms unclear: ask first |
| Arkansas Business "What's New: Business Openings Across Arkansas" | Monthly statewide openings roundup | HTML | Terms: content is "strictly for personal, non-commercial use only" | **No** | Monthly | A few NWA items a month | Both, but not usable without permission |

**Recommendation (2026-10-04):**
- No single permitted source gives enough confirmed openings at launch. The
  public records (ABC list, health department, Fayetteville permits) are
  leads with no opening dates, so on their own they can't put a card up.
- Build New in Town as a lead-and-confirm flow: leads from the ABC weekly
  list (names and addresses only, never applicants' names), the health
  department's pre-opening inspections, and Fayetteville commercial permits
  become owner proposals; a card appears only when a confirming source
  states a date: a chamber ribbon cutting, the business's own site, or an
  owner-verified check.
- Ask permission where the dated facts are: Talk Business & Politics
  (richest dated source), the chambers (a ribbon-cutting list or feed), and
  Arkansas Business. Springdale permits need a request (bot challenge).
- Expect a thin section at launch (a handful of items a month), so keep the
  hide-when-empty rule.
