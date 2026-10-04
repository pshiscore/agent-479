import type { COMMERCIAL_USE, LINK_MODES, SOURCE_KINDS } from "@/lib/db/schema";

/**
 * The 9 Phase 1 sources and the starting link policies. Terms values come from
 * docs/sources-terms.md (reviewed 2026-10-03); re-check there before changing them.
 *
 * Every source is seeded disabled. `launch` marks the 6 that build step 9 turns
 * on, each with a logged `enable` action, once its fetcher exists and its feed
 * URL is confirmed. Re-seeding never changes `enabled`.
 */

export interface SourceSeed {
  slug: string;
  name: string;
  kind: (typeof SOURCE_KINDS)[number] | null;
  fetcher: string | null;
  baseUrl: string;
  config: Record<string, unknown>;
  defaultVenueSlug: string | null;
  trustLevel: number;
  fetchIntervalMinutes: number;
  commercialUseOk: (typeof COMMERCIAL_USE)[number];
  termsNotes: string;
  launch: boolean;
}

const AWAITING = "Awaiting permission.";
const FAYLIB_ICAL_30_DAYS =
  "https://faylib.org/feeds?data=eyJmZWVkVHlwZSI6ImljYWwiLCJmaWx0ZXJzIjp7ImxvY2F0aW9uIjpbImFsbCJdLCJhZ2VzIjpbImFsbCJdLCJ0eXBlcyI6WyJhbGwiXSwidGFncyI6W10sInRlcm0iOiIiLCJkYXlzIjozMH19";
const CIVICPLUS_ICS = "/common/modules/iCalendar/iCalendar.aspx";
// Event page for a numeric UID. Checked 2026-10-04 against one real event on
// each city's site (Bentonville EID 3241, Rogers 4397, Fayetteville 11868).
const CIVICPLUS_EVENT_URL = "Calendar.aspx?EID={uid}";
const CIVICPLUS_TERMS =
  'CivicPlus public ICS. Footer says "All rights reserved", no reuse terms. Facts and links only. ' +
  "robots.txt allows the ICS endpoint. Public-meeting categories are never used.";

export const SOURCE_SEEDS: SourceSeed[] = [
  {
    slug: "ticketmaster",
    name: "Ticketmaster Discovery API",
    kind: "api",
    fetcher: "ticketmaster",
    baseUrl: "https://app.ticketmaster.com/discovery/v2/",
    // Centered between Springdale and Rogers; 40 miles reaches Bella Vista,
    // Siloam Springs, Eureka Springs, and Prairie Grove. Venues outside NWA are
    // dropped later, when no venue matches. 1,000 results max per query.
    config: { center: { lat: 36.25, lng: -94.15 }, radiusMiles: 40, windowDays: 180, pageSize: 200 },
    defaultVenueSlug: null,
    trustLevel: 4,
    fetchIntervalMinutes: 6 * 60,
    commercialUseOk: "no",
    termsNotes:
      'API terms: storage only for "reasonable periods", no replicating Ticketmaster, no API-derived revenue. ' +
      "Facts and links only (whitelisted mapper fields).",
    launch: true,
  },
  {
    slug: "city-bentonville",
    name: "City of Bentonville",
    kind: "ics",
    fetcher: "ics",
    baseUrl: "https://www.bentonville.ar.gov/",
    // 32: Holidays and Community Events.
    config: { icsPath: CIVICPLUS_ICS, catIds: [32], eventUrl: CIVICPLUS_EVENT_URL },
    defaultVenueSlug: null,
    trustLevel: 4,
    fetchIntervalMinutes: 24 * 60,
    commercialUseOk: "unknown",
    termsNotes: CIVICPLUS_TERMS,
    launch: true,
  },
  {
    slug: "city-rogers",
    name: "City of Rogers",
    kind: "ics",
    fetcher: "ics",
    baseUrl: "https://www.rogersar.gov/",
    // 28: City Events.
    config: { icsPath: CIVICPLUS_ICS, catIds: [28], eventUrl: CIVICPLUS_EVENT_URL },
    defaultVenueSlug: null,
    trustLevel: 4,
    fetchIntervalMinutes: 24 * 60,
    commercialUseOk: "unknown",
    termsNotes: CIVICPLUS_TERMS,
    launch: true,
  },
  {
    slug: "city-fayetteville",
    name: "City of Fayetteville",
    kind: "ics",
    fetcher: "ics",
    baseUrl: "https://www.fayetteville-ar.gov/",
    // 30: City-Sponsored Events. 33: Parks and Recreation.
    config: { icsPath: CIVICPLUS_ICS, catIds: [30, 33], eventUrl: CIVICPLUS_EVENT_URL },
    defaultVenueSlug: null,
    trustLevel: 4,
    fetchIntervalMinutes: 24 * 60,
    commercialUseOk: "unknown",
    termsNotes: CIVICPLUS_TERMS,
    launch: true,
  },
  {
    slug: "library-rogers",
    name: "Rogers Public Library",
    kind: "ics",
    fetcher: "ics",
    baseUrl: "https://www.rogerspubliclibrary.org/",
    // The LibCal ical_subscribe.php URL is confirmed in step 9 before enabling.
    config: { feedUrl: null },
    defaultVenueSlug: "rogers-public-library",
    trustLevel: 4,
    fetchIntervalMinutes: 12 * 60,
    commercialUseOk: "unknown",
    termsNotes:
      "Public LibCal subscription feed. No website terms published. LibCal's robots.txt blocks named " +
      "crawlers but not the ical_subscribe.php path for general agents.",
    launch: true,
  },
  {
    slug: "library-fayetteville",
    name: "Fayetteville Public Library",
    kind: "ics",
    fetcher: "ics",
    baseUrl: "https://www.faylib.org/",
    config: {
      // Communico feed: iCal, all locations, ages, and types, 30 days ahead
      // (the data= parameter is base64 JSON with feedType "ical", days 30).
      feedUrl: FAYLIB_ICAL_30_DAYS,
      // Event page for a numeric UID; checked 2026-10-04 against event 17128407.
      eventUrl: "https://faylib.org/event/{uid}",
      feedUrlSource: {
        verifiedBy: "owner",
        checkedAt: "2026-10-03",
        confirmed: "Opening the link in the owner's browser downloads an .ics calendar file",
        note: "Owner found the feed with days=1; days=30 is the same feed with only the window changed. The 30-day range is not yet confirmed: step 9's test fetch checks it before enabling.",
      },
    },
    defaultVenueSlug: "fayetteville-public-library",
    trustLevel: 4,
    fetchIntervalMinutes: 12 * 60,
    commercialUseOk: "unknown",
    termsNotes: "Public Communico subscription feed. Policies page covers building use only.",
    launch: true,
  },
  {
    slug: "walton-arts-center",
    name: "Walton Arts Center",
    // How we'd read it is decided after permission. Never fetch until then (CLAUDE.md).
    kind: null,
    fetcher: null,
    baseUrl: "https://www.waltonartscenter.org/",
    config: {},
    defaultVenueSlug: "walton-arts-center",
    trustLevel: 5,
    fetchIntervalMinutes: 24 * 60,
    commercialUseOk: "unknown",
    termsNotes: `${AWAITING} No terms of use published. Also operates the Walmart AMP. Email: docs/outreach/wac-permission-email.md.`,
    launch: false,
  },
  {
    slug: "crystal-bridges",
    name: "Crystal Bridges Museum of American Art",
    kind: "html",
    fetcher: null,
    baseUrl: "https://crystalbridges.org/",
    config: {},
    defaultVenueSlug: "crystal-bridges",
    trustLevel: 5,
    fetchIntervalMinutes: 24 * 60,
    commercialUseOk: "no",
    termsNotes:
      `${AWAITING} Terms ban all robots and links to pages other than the homepage without consent. ` +
      "Email: docs/outreach/crystal-bridges-momentary-permission-email.md.",
    launch: false,
  },
  {
    slug: "the-momentary",
    name: "The Momentary",
    kind: "jsonld_sitemap",
    fetcher: null,
    baseUrl: "https://themomentary.org/",
    config: {},
    defaultVenueSlug: "the-momentary",
    trustLevel: 5,
    fetchIntervalMinutes: 24 * 60,
    commercialUseOk: "no",
    termsNotes:
      `${AWAITING} Its footer "Terms of Use" link points to the Crystal Bridges terms, which ban robots ` +
      "and deep links without consent. Email: docs/outreach/crystal-bridges-momentary-permission-email.md.",
    launch: false,
  },
];

export interface LinkPolicySeed {
  domain: string;
  mode: (typeof LINK_MODES)[number];
  homepageUrl: string | null;
  reason: string;
}

const CB_TERMS =
  'Crystal Bridges terms (crystalbridges.org/terms-and-conditions-of-use, modified 2026-04-01): "Link to any ' +
  'part of the Website other than the homepage" is prohibited without consent.';

export const LINK_POLICY_SEEDS: LinkPolicySeed[] = [
  {
    domain: "crystalbridges.org",
    mode: "homepage_only",
    homepageUrl: "https://crystalbridges.org/",
    reason: `${CB_TERMS} Lift only with written permission.`,
  },
  {
    domain: "themomentary.org",
    mode: "homepage_only",
    homepageUrl: "https://themomentary.org/",
    reason: `${CB_TERMS} The Momentary's footer links to those same terms. Lift only with written permission.`,
  },
];
