import { describe, expect, it } from "vitest";
import { coverageReport, matchTicketmasterVenue, type OurVenue, type TmVenue } from "./ticketmaster-venues";

const AMP: OurVenue = {
  id: "v-amp",
  slug: "walmart-amp",
  name: "Walmart AMP",
  aliases: ["Walmart Arkansas Music Pavilion", "Arkansas Music Pavilion", "The AMP"],
  city: "Rogers",
  lat: 36.302881,
  lng: -94.183763,
};
const WAC: OurVenue = {
  id: "v-wac",
  slug: "walton-arts-center",
  name: "Walton Arts Center",
  aliases: ["WAC"],
  city: "Fayetteville",
  lat: 36.065862,
  lng: -94.164794,
};
const OURS = [AMP, WAC];
const tm = (over: Partial<TmVenue>): TmVenue => ({
  id: "KovZ1",
  name: "Walmart AMP",
  address: "5079 W Northgate Rd",
  city: "Rogers",
  lat: 36.30288,
  lng: -94.18376,
  events: 12,
  ...over,
});

describe("matchTicketmasterVenue", () => {
  it("uses an existing link first", () => {
    expect(matchTicketmasterVenue(tm({}), OURS, new Map([["KovZ1", AMP]]))).toMatchObject({ kind: "linked", venue: AMP });
  });

  it("proposes a same-city name or alias match", () => {
    expect(matchTicketmasterVenue(tm({ name: "Arkansas Music Pavilion" }), OURS, new Map())).toMatchObject({
      kind: "name",
      venue: AMP,
      distanceM: 0,
    });
  });

  it("flags a name match that is far away instead of proposing it", () => {
    expect(matchTicketmasterVenue(tm({ lat: 36.35, lng: -94.25 }), OURS, new Map())).toMatchObject({ kind: "name_far", venue: AMP });
  });

  it("doesn't match the same name in another city", () => {
    expect(matchTicketmasterVenue(tm({ city: "Springdale", lat: 36.18, lng: -94.13 }), OURS, new Map()).kind).toBe("none");
  });

  it("proposes an unnamed match only within 150 m", () => {
    expect(matchTicketmasterVenue(tm({ name: "AMP Lawn Seats", lat: 36.3035, lng: -94.1835 }), OURS, new Map())).toMatchObject({
      kind: "nearby",
      venue: AMP,
    });
    expect(matchTicketmasterVenue(tm({ name: "Some Bar", lat: 36.31, lng: -94.19 }), OURS, new Map()).kind).toBe("none");
  });

  it("ignores venues outside NWA", () => {
    expect(matchTicketmasterVenue(tm({ name: "BOK Center", city: "Tulsa", lat: 36.1534, lng: -95.9965 }), OURS, new Map()).kind).toBe(
      "outside_nwa",
    );
  });
});

describe("coverageReport", () => {
  it("summarizes events by status and lists every venue", () => {
    const matches = [
      matchTicketmasterVenue(tm({}), OURS, new Map()),
      matchTicketmasterVenue(tm({ id: "K2", name: "Unknown Club", lat: 36.2, lng: -94.1, events: 3 }), OURS, new Map()),
    ];
    const md = coverageReport(matches, new Date("2026-10-03T15:00:00Z"));
    expect(md).toContain("2 Ticketmaster venues, 15 events.");
    expect(md).toContain("- Proposed matches: 12 events");
    expect(md).toContain("- Need a decision: 3 events");
    expect(md).toContain("| KovZ1 | Walmart AMP | Rogers | 12 | **proposed** (same name, same city) | walmart-amp | 0 m |");
  });
});
