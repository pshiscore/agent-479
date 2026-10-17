import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inCoverageArea } from "@/config/coverage";
import { UNPERMITTED_DOMAINS } from "@/lib/http/fetch";
import { organizerRow } from "./seed";
import { ORGANIZER_SEEDS } from "./seed-data";

// Sites that refused us or wait on the owner's browser check (docs/sources-terms.md): never in a seed's urls.
const DO_NOT_FETCH = [
  ...UNPERMITTED_DOMAINS,
  "springdalear.gov",
  "bentonvillelibrary.org",
  "destinationrogers.com",
  "visitrogersarkansas.com",
  "fayettevilleflyer.com",
  "lowellarkansas.gov",
  "lincolnarkansas.com",
  "tontitown.com",
  "washingtoncountyar.gov",
  "milb.com",
  "eventbrite.com",
  "facebook.com",
  "instagram.com",
  "bellavistaar.gov",
  "gentryar.gov",
  "gentryarkansas.us",
  "gravettear.com",
  "gravettear.gov",
  "winslowarkansas.com",
  "bikerackbrewing.com",
  "bvpl.org",
];

const venueSlugs = new Set((JSON.parse(readFileSync("data/venues.seed.json", "utf8")) as { venues: { slug: string }[] }).venues.map((v) => v.slug));

describe("organizer seeds", () => {
  it("have unique slugs, in-area cities, and venue links that exist", () => {
    expect(new Set(ORGANIZER_SEEDS.map((o) => o.slug)).size).toBe(ORGANIZER_SEEDS.length);
    for (const o of ORGANIZER_SEEDS) {
      expect(inCoverageArea(o.city), o.slug).toBe(true);
      if (o.venueSlug) expect(venueSlugs.has(o.venueSlug), o.slug).toBe(true);
    }
  });

  it("never list a blocked, unpermitted, or social-media site; no-fetch entries have no addresses", () => {
    for (const o of ORGANIZER_SEEDS) {
      for (const u of o.urls) {
        const host = new URL(u).hostname.replace(/^www\./, "");
        expect(u.startsWith("https://"), u).toBe(true);
        expect(DO_NOT_FETCH.some((d) => host === d || host.endsWith(`.${d}`)), `${o.slug}: ${u}`).toBe(false);
      }
      if (o.noFetch) expect(o.urls, o.slug).toEqual([]);
    }
  });
});

describe("organizerRow", () => {
  const seed = ORGANIZER_SEEDS.find((o) => o.slug === "georges-majestic-lounge")!;
  const venue = { id: "00000000-0000-0000-0000-000000000001", website: "https://www.georgesmajesticlounge.com/" };

  it("verifies only what the page confirmed, with provenance and the events page", () => {
    const row = organizerRow(seed, { outcome: "confirmed", website: "https://www.georgesmajesticlounge.com/", eventsPage: "https://www.georgesmajesticlounge.com/calendar", tried: [{ url: seed.urls[0], result: "confirmed" }] }, "2026-10-17", venue);
    expect(row).toMatchObject({ status: "verified", website: "https://www.georgesmajesticlounge.com/", homeCounty: "Washington", homeState: "AR", holdsEventsInArea: "yes", venueId: venue.id, channel: "unknown" });
    expect(row.verification).toMatchObject({ name: { checkedAt: "2026-10-17" }, notes: [{ url: "https://www.georgesmajesticlounge.com/calendar" }] });
  });

  it("keeps an unconfirmed organizer a candidate with no website, saying why", () => {
    const row = organizerRow(seed, { outcome: "not_confirmed", website: null, eventsPage: null, tried: [{ url: seed.urls[0], result: "name_not_found" }] }, "2026-10-17", venue);
    expect(row).toMatchObject({ status: "candidate", website: null });
    expect(row.notes).toMatch(/doesn't name the organizer/);
  });

  it("a never-fetched venue organizer keeps our venue record's website, unverified", () => {
    const wac = ORGANIZER_SEEDS.find((o) => o.slug === "walton-arts-center")!;
    const row = organizerRow(wac, { outcome: "not_fetched", website: null, eventsPage: null, tried: [], note: wac.noFetch }, "2026-10-17", { id: venue.id, website: "https://www.waltonartscenter.org/" });
    expect(row).toMatchObject({ status: "candidate", website: "https://www.waltonartscenter.org/", lastCheckedAt: null });
    expect(row.notes).toMatch(/Unpermitted source/);
  });
});
