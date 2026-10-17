import type { ORGANIZER_TYPES } from "@/lib/db/schema";

/**
 * Tier 2 of the organizer registry (docs/product/organizers.md; owner,
 * 2026-10-16): organizers with websites. Each entry is checked against its
 * own site by `npm run organizers:check` (robots.txt first, then the home
 * page, which must name the organizer); the result is written to
 * data/organizers.check.json and applied by the seed, logged. No owner
 * sign-off: entries are internal pointers, not published facts.
 *
 * `urls` are tried in order. `urlFrom` says where each address came from:
 * our own records, a search result (cited), or a likely address, which counts
 * only when the page itself names the organizer. `noFetch` entries are never
 * requested (unpermitted, blocked, or waiting on the owner's browser check).
 */

export interface OrganizerSeed {
  slug: string;
  name: string;
  aliases?: string[];
  type: (typeof ORGANIZER_TYPES)[number];
  city: string;
  urls: string[];
  urlFrom: string;
  // Words the home page must contain to confirm it's this organizer's site (default: the name's main words).
  nameWords?: string[];
  venueSlug?: string;
  // Why we never request this site.
  noFetch?: string;
  // Set when we already read its feed as a source; otherwise discovery (step 6) decides.
  channel?: "feed";
  notes?: string;
}

const SEARCH = (url: string) => `search result: ${url}`;
const LIKELY = "likely address (confirmed only if the page names the organizer)";
const VENUE = "our venue record";
const SOURCE = "our source record";
const UNPERMITTED = "Unpermitted source: never fetched until written permission (AGENTS.md, Fetching).";

export const ORGANIZER_SEEDS: OrganizerSeed[] = [
  // ---- City governments that are already sources (their feeds are the organizer's own) ----
  { slug: "city-of-bentonville", channel: "feed", name: "City of Bentonville", type: "government", city: "Bentonville", urls: ["https://www.bentonville.ar.gov/"], urlFrom: SOURCE, nameWords: ["bentonville"], notes: "Source city-bentonville (live)." },
  { slug: "city-of-fayetteville", channel: "feed", name: "City of Fayetteville", type: "government", city: "Fayetteville", urls: ["https://www.fayetteville-ar.gov/"], urlFrom: SOURCE, nameWords: ["fayetteville"], notes: "Sources city-fayetteville (live) and city-fayetteville-volunteer (untested)." },
  { slug: "city-of-rogers", channel: "feed", name: "City of Rogers", type: "government", city: "Rogers", urls: ["https://www.rogersar.gov/"], urlFrom: SOURCE, nameWords: ["rogers"], notes: "Source city-rogers (live)." },
  { slug: "city-of-siloam-springs", channel: "feed", name: "City of Siloam Springs", type: "government", city: "Siloam Springs", urls: ["https://www.siloamsprings.gov/"], urlFrom: SOURCE, nameWords: ["siloam"], notes: "Source city-siloam-springs (shadow); its library calendar is part of the same feed." },
  { slug: "city-of-pea-ridge", channel: "feed", name: "City of Pea Ridge", type: "government", city: "Pea Ridge", urls: ["https://cityofpearidgear.gov/"], urlFrom: SOURCE, nameWords: ["pea ridge"], notes: "Source city-pea-ridge (shadow)." },

  // ---- Downtown organizations ----
  { slug: "downtown-bentonville-inc", name: "Downtown Bentonville Inc.", aliases: ["DBI"], type: "downtown_organization", city: "Bentonville", urls: ["https://downtownbentonville.org/"], urlFrom: SEARCH("https://downtownbentonville.org/about"), nameWords: ["downtown", "bentonville"], notes: "Runs the Bentonville Farmers Market and First Friday (its own site, per search)." },
  { slug: "downtown-rogers-inc", name: "Downtown Rogers Inc.", type: "downtown_organization", city: "Rogers", urls: ["https://www.downtownrogersinc.org/", "https://downtownrogersinc.org/"], urlFrom: SEARCH("https://www.guidestar.org/Profile/71-0635127"), nameWords: ["downtown", "rogers"] },
  { slug: "go-downtown-rogers", name: "Go Downtown Rogers", type: "downtown_organization", city: "Rogers", urls: ["https://www.godowntownrogers.com/"], urlFrom: SEARCH("https://www.godowntownrogers.com/?p=321"), nameWords: ["downtown", "rogers"], notes: "Described in search results as part of the Rogers-Lowell Area Chamber." },
  { slug: "downtown-springdale-alliance", name: "Downtown Springdale Alliance", type: "downtown_organization", city: "Springdale", urls: ["https://www.downtownspringdale.org/"], urlFrom: "docs/sources-terms.md (Skipped sources)", nameWords: ["downtown", "springdale"], notes: "robots.txt disallows its calendar feeds (?format=ical, ?format=json); a feed request is in docs/outreach." },
  { slug: "main-street-siloam-springs", name: "Main Street Siloam Springs", type: "downtown_organization", city: "Siloam Springs", urls: ["https://www.mainstreetsiloam.com/", "https://mainstreetsiloam.org/"], urlFrom: SEARCH("https://www.arkansasonline.com/news/2020/feb/19/main-street-siloam-springs-arkansas-awa-1/"), nameWords: ["main street", "siloam"], notes: "Homegrown Festival and Fourth Friday (per search)." },

  // ---- Chambers of commerce ----
  { slug: "greater-bentonville-area-chamber", name: "Greater Bentonville Area Chamber of Commerce", type: "chamber", city: "Bentonville", urls: ["https://www.greaterbentonville.com/", "https://www.bentonvillearea.com/"], urlFrom: `${SEARCH("https://cityofpearidgear.gov/links-of-interest/")}; ${SEARCH("https://uschamber.com/co/chambers/arkansas")}`, nameWords: ["bentonville", "chamber"], notes: "Also covers Pea Ridge and Bella Vista (per search)." },
  { slug: "rogers-lowell-area-chamber", name: "Rogers-Lowell Area Chamber of Commerce", type: "chamber", city: "Rogers", urls: ["https://www.rogerslowell.com/"], urlFrom: "search result: chamber event listing naming rogerslowell.com", nameWords: ["rogers", "chamber"] },
  { slug: "springdale-chamber", name: "Springdale Chamber of Commerce", type: "chamber", city: "Springdale", urls: ["https://springdale.com/"], urlFrom: "docs/sources-terms.md (Skipped sources)", nameWords: ["springdale", "chamber"], notes: "The Events Calendar plugin; its feeds returned 0 events when checked 2026-10-03." },
  { slug: "fayetteville-chamber", name: "Fayetteville Chamber of Commerce", type: "chamber", city: "Fayetteville", urls: ["https://www.fayettevillear.com/"], urlFrom: SEARCH("https://uschamber.com/co/chambers/arkansas"), nameWords: ["fayetteville", "chamber"] },
  { slug: "siloam-springs-chamber", name: "Siloam Springs Chamber of Commerce", type: "chamber", city: "Siloam Springs", urls: ["https://www.siloamchamber.com/"], urlFrom: SEARCH("https://uschamber.com/co/chambers/arkansas/siloam-springs"), nameWords: ["siloam", "chamber"] },
  { slug: "gentry-chamber", name: "Gentry Chamber of Commerce", type: "chamber", city: "Gentry", urls: ["https://www.gentrychamber.com/"], urlFrom: SEARCH("https://www.uschamber.com/co/chambers/arkansas/gentry"), nameWords: ["gentry", "chamber"] },
  { slug: "prairie-grove-chamber", name: "Prairie Grove Chamber of Commerce", type: "chamber", city: "Prairie Grove", urls: ["https://www.pgchamber.org/"], urlFrom: SEARCH("https://www.prairiegrovearkansas.org/community"), nameWords: ["prairie grove", "chamber"] },

  // ---- Libraries ----
  { slug: "fayetteville-public-library", channel: "feed", name: "Fayetteville Public Library", type: "library", city: "Fayetteville", urls: ["https://www.faylib.org/"], urlFrom: VENUE, venueSlug: "fayetteville-public-library", nameWords: ["fayetteville", "library"], notes: "Source library-fayetteville (live)." },
  { slug: "rogers-public-library", name: "Rogers Public Library", type: "library", city: "Rogers", urls: ["https://www.rogerspubliclibrary.org/"], urlFrom: VENUE, venueSlug: "rogers-public-library", nameWords: ["rogers", "library"], notes: "Source library-rogers (untested; waiting on its LibCal feed URL)." },
  { slug: "bentonville-public-library", name: "Bentonville Public Library", type: "library", city: "Bentonville", urls: [], urlFrom: VENUE, venueSlug: "bentonville-public-library", noFetch: "Returned 403 to our requests (2026-10-02): a block means stop. Feed request in docs/outreach." },
  { slug: "springdale-public-library", name: "Springdale Public Library", type: "library", city: "Springdale", urls: ["https://www.springdalelibrary.org/"], urlFrom: VENUE, venueSlug: "springdale-public-library", nameWords: ["springdale", "library"] },
  { slug: "bella-vista-public-library", name: "Bella Vista Public Library", type: "library", city: "Bella Vista", urls: [], urlFrom: VENUE, venueSlug: "bella-vista-public-library", noFetch: "robots.txt disallows our bot (checked 2026-10-17): a block means stop." },
  { slug: "pea-ridge-community-library", name: "Pea Ridge Community Library", type: "library", city: "Pea Ridge", urls: ["https://www.pearidgecommunitylibrary.org/"], urlFrom: `${LIKELY}; newspaper columns give it as "pearigecommunitylibrary.org", likely a typo`, nameWords: ["pea ridge", "library"] },
  { slug: "gravette-public-library", name: "Gravette Public Library", type: "library", city: "Gravette", urls: ["https://www.gravettelibrary.org/"], urlFrom: SEARCH("https://www.gravettear.com/library"), nameWords: ["gravette", "library"] },
  { slug: "gentry-public-library", name: "Gentry Public Library", type: "library", city: "Gentry", urls: [], urlFrom: SEARCH("https://www.gentryar.gov/library"), noFetch: "Its pages are on the Gentry city site, which may show a bot challenge; waiting on the owner's browser check." },
  { slug: "iva-jane-peek-public-library", name: "Iva Jane Peek Public Library", type: "library", city: "Decatur", urls: ["https://decaturarkansas.com/iva-jane-peek-public-library"], urlFrom: SEARCH("https://library.arkansas.gov/facilities/iva-jane-peek-public-library-hq/"), nameWords: ["peek", "library"] },
  { slug: "prairie-grove-public-library", name: "Prairie Grove Public Library", type: "library", city: "Prairie Grove", urls: ["https://www.prairiegrovearkansas.org/library"], urlFrom: SEARCH("https://www.prairiegrovearkansas.org/library"), nameWords: ["prairie grove", "library"] },
  { slug: "farmington-public-library", name: "Farmington Public Library", type: "library", city: "Farmington", urls: ["https://www.cityoffarmington-ar.gov/library"], urlFrom: SEARCH("https://www.cityoffarmington-ar.gov/library"), nameWords: ["farmington", "library"] },

  // ---- Our venues that run their own calendars ----
  { slug: "georges-majestic-lounge", name: "George's Majestic Lounge", type: "venue", city: "Fayetteville", urls: ["https://www.georgesmajesticlounge.com/"], urlFrom: VENUE, venueSlug: "georges-majestic-lounge", nameWords: ["george"] },
  { slug: "ozark-music-hall", name: "Ozark Music Hall", type: "venue", city: "Fayetteville", urls: ["https://ozarkmusichall.com/"], urlFrom: VENUE, venueSlug: "ozark-music-hall", nameWords: ["ozark", "music hall"] },
  { slug: "theatresquared", name: "TheatreSquared", type: "venue", city: "Fayetteville", urls: ["https://theatre2.org/"], urlFrom: VENUE, venueSlug: "theatresquared", nameWords: ["theatresquared"] },
  { slug: "faulkner-performing-arts-center", name: "Faulkner Performing Arts Center", type: "venue", city: "Fayetteville", urls: ["https://faulkner.uark.edu/"], urlFrom: VENUE, venueSlug: "faulkner-performing-arts-center", nameWords: ["faulkner"] },
  { slug: "botanical-garden-of-the-ozarks", name: "Botanical Garden of the Ozarks", type: "nonprofit", city: "Fayetteville", urls: ["https://www.bgozarks.org/"], urlFrom: VENUE, venueSlug: "botanical-garden-of-the-ozarks", nameWords: ["botanical garden"] },
  { slug: "clinton-house-museum", name: "Clinton House Museum", type: "museum", city: "Fayetteville", urls: ["https://www.clintonhousemuseum.org/"], urlFrom: VENUE, venueSlug: "clinton-house-museum", nameWords: ["clinton house"] },
  { slug: "fayetteville-town-center", name: "Fayetteville Town Center", type: "venue", city: "Fayetteville", urls: ["https://twncenter.com/"], urlFrom: VENUE, venueSlug: "fayetteville-town-center", nameWords: ["town center"] },
  { slug: "arkansas-public-theatre", name: "Arkansas Public Theatre", type: "nonprofit", city: "Rogers", urls: ["https://www.arkansaspublictheatre.org/"], urlFrom: VENUE, venueSlug: "victory-theater", nameWords: ["arkansas public theatre"], notes: "Performs at the Victory Theater." },
  { slug: "rogers-historical-museum", name: "Rogers Historical Museum", type: "museum", city: "Rogers", urls: ["https://www.rogershistoricalmuseum.org/"], urlFrom: VENUE, venueSlug: "rogers-historical-museum", nameWords: ["rogers", "museum"] },
  { slug: "railyard-live", name: "Railyard Live", type: "venue", city: "Rogers", urls: ["https://railyardlive.com/"], urlFrom: VENUE, venueSlug: "butterfield-stage", nameWords: ["railyard"], notes: "Concert series at the Butterfield Stage." },
  { slug: "pinnacle-hills-promenade", name: "Pinnacle Hills Promenade", type: "business", city: "Rogers", urls: ["https://www.pinnaclehillspromenade.com/"], urlFrom: VENUE, venueSlug: "pinnacle-hills-promenade", nameWords: ["pinnacle hills"] },
  { slug: "ozark-beer-company", name: "Ozark Beer Company", type: "business", city: "Rogers", urls: ["https://www.ozarkbeercompany.com/"], urlFrom: VENUE, venueSlug: "ozark-beer-company", nameWords: ["ozark beer"] },
  { slug: "scott-family-amazeum", name: "Scott Family Amazeum", type: "museum", city: "Bentonville", urls: ["https://www.amazeum.org/"], urlFrom: VENUE, venueSlug: "scott-family-amazeum", nameWords: ["amazeum"] },
  { slug: "museum-of-native-american-history", name: "Museum of Native American History", type: "museum", city: "Bentonville", urls: ["https://monah.org/"], urlFrom: VENUE, venueSlug: "museum-of-native-american-history", nameWords: ["native american"] },
  { slug: "walmart-museum", name: "Walmart Museum", type: "museum", city: "Bentonville", urls: ["https://corporate.walmart.com/about/walmart-museum/"], urlFrom: VENUE, venueSlug: "walmart-museum", nameWords: ["walmart museum"] },
  { slug: "peel-compton-foundation", name: "Peel Compton Foundation", type: "nonprofit", city: "Bentonville", urls: ["https://www.peelcompton.org/"], urlFrom: VENUE, venueSlug: "compton-gardens", nameWords: ["compton"], notes: "Runs Compton Gardens." },
  { slug: "record", name: "RECORD", type: "venue", city: "Bentonville", urls: ["https://www.recorddowntown.com/"], urlFrom: VENUE, venueSlug: "record", nameWords: ["record"] },
  { slug: "jones-center", name: "The Jones Center", type: "nonprofit", city: "Springdale", urls: ["https://thejonescenter.org/"], urlFrom: VENUE, venueSlug: "jones-center", nameWords: ["jones center"] },
  { slug: "shiloh-museum", name: "Shiloh Museum of Ozark History", type: "museum", city: "Springdale", urls: ["https://shilohmuseum.org/"], urlFrom: VENUE, venueSlug: "shiloh-museum", nameWords: ["shiloh"] },
  { slug: "pea-ridge-national-military-park", name: "Pea Ridge National Military Park", type: "government", city: "Garfield", urls: ["https://www.nps.gov/peri/"], urlFrom: VENUE, venueSlug: "pea-ridge-national-military-park", nameWords: ["pea ridge"], notes: "National Park Service." },
  { slug: "prairie-grove-battlefield-state-park", name: "Prairie Grove Battlefield State Park", type: "government", city: "Prairie Grove", urls: ["https://www.arkansas.com/state-parks/parks/prairie-grove-battlefield-state-park"], urlFrom: VENUE, venueSlug: "prairie-grove-battlefield-state-park", nameWords: ["prairie grove"], notes: "Arkansas State Parks." },
  { slug: "walton-arts-center", name: "Walton Arts Center", type: "venue", city: "Fayetteville", urls: [], urlFrom: VENUE, venueSlug: "walton-arts-center", noFetch: UNPERMITTED, notes: "Also runs the Walmart AMP. Permission requested (docs/outreach)." },
  { slug: "walmart-amp", name: "Walmart AMP", type: "venue", city: "Rogers", urls: [], urlFrom: VENUE, venueSlug: "walmart-amp", noFetch: UNPERMITTED, notes: "Run by Walton Arts Center." },
  { slug: "crystal-bridges", name: "Crystal Bridges Museum of American Art", type: "museum", city: "Bentonville", urls: [], urlFrom: VENUE, venueSlug: "crystal-bridges", noFetch: UNPERMITTED, notes: "Permission requested together with the Momentary (docs/outreach)." },
  { slug: "the-momentary", name: "The Momentary", type: "museum", city: "Bentonville", urls: [], urlFrom: VENUE, venueSlug: "the-momentary", noFetch: UNPERMITTED },
  { slug: "northwest-arkansas-naturals", name: "Northwest Arkansas Naturals", type: "business", city: "Springdale", urls: [], urlFrom: VENUE, venueSlug: "arvest-ballpark", noFetch: "milb.com refused our request with 406 (a block means stop). Games come through Ticketmaster." },

  // ---- Wineries, breweries, cideries, and farms with public events ----
  { slug: "bike-rack-brewing", name: "Bike Rack Brewing Co.", type: "business", city: "Bentonville", urls: [], urlFrom: SEARCH("https://www.brewbound.com/breweries/bike-rack-brewing-co"), noFetch: "Its robots.txt returned 403 to our request (2026-10-17): a block means stop.", notes: "Live music on weekends, per search." },
  { slug: "bentonville-brewing", name: "Bentonville Brewing Company", type: "business", city: "Bentonville", urls: ["https://www.bentonvillebrewing.com/"], urlFrom: LIKELY, nameWords: ["bentonville brewing"] },
  { slug: "new-province-brewing", name: "New Province Brewing Co.", type: "business", city: "Rogers", urls: ["https://www.newprovincebrewing.com/"], urlFrom: LIKELY, nameWords: ["new province"] },
  { slug: "saddlebock-brewery", name: "Saddlebock Brewery", type: "business", city: "Springdale", urls: ["https://www.saddlebockbrewery.com/"], urlFrom: LIKELY, nameWords: ["saddlebock"], notes: "Local musicians, per search." },
  { slug: "fossil-cove-brewing", name: "Fossil Cove Brewing Co.", type: "business", city: "Fayetteville", urls: ["https://www.fossilcovebrewing.com/"], urlFrom: LIKELY, nameWords: ["fossil cove"] },
  { slug: "columbus-house-brewery", name: "Columbus House Brewery", type: "business", city: "Fayetteville", urls: ["https://www.columbushousebrewery.com/"], urlFrom: LIKELY, nameWords: ["columbus house"] },
  { slug: "black-apple-crossing", name: "Black Apple Crossing", aliases: ["Black Apple Hard Cider"], type: "business", city: "Springdale", urls: ["https://www.blackapplecrossing.com/"], urlFrom: LIKELY, nameWords: ["black apple"], notes: "Cidery; live music and comedy, per search." },
  { slug: "tontitown-winery", name: "Tontitown Winery", type: "business", city: "Tontitown", urls: ["https://www.tontitownwinery.com/"], urlFrom: LIKELY, nameWords: ["tontitown winery"], notes: "Separate from the Tontitown city site, which refused us (406)." },
  { slug: "sassafras-springs-vineyard", name: "Sassafras Springs Vineyard", type: "business", city: "Springdale", urls: ["https://www.sassafrasspringsvineyard.com/"], urlFrom: `${LIKELY}; ${SEARCH("https://www.arkansas.com/springdale/landmarks/sassafras-springs-vineyard-winery-events-center")}`, nameWords: ["sassafras"] },
  { slug: "farmland-adventures", name: "Farmland Adventures", type: "business", city: "Springdale", urls: ["https://www.farmlandadventures.com/"], urlFrom: LIKELY, nameWords: ["farmland adventures"], notes: "Fall corn maze and pumpkin patch, per search." },
  { slug: "rivercrest-orchard", name: "Rivercrest Orchard", type: "business", city: "Fayetteville", urls: ["https://www.rivercrestorchard.com/"], urlFrom: LIKELY, nameWords: ["rivercrest"] },
  { slug: "mcgarrah-farms", name: "McGarrah Farms", type: "business", city: "Pea Ridge", urls: ["https://www.mcgarrahfarms.com/"], urlFrom: LIKELY, nameWords: ["mcgarrah"] },
  { slug: "vanzant-fruit-farm", name: "Vanzant Fruit Farm", type: "business", city: "Lowell", urls: ["https://www.vanzantfruitfarm.com/"], urlFrom: LIKELY, nameWords: ["vanzant"] },
];
