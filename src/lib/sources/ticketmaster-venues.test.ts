import { describe, expect, it } from "vitest";
import {
  coverageReport,
  linkProposalFor,
  matchTicketmasterVenue,
  namesMatchClosely,
  normalizeStreetAddress,
  type OurVenue,
  placeholderPoints,
  subSpaceName,
  type TmVenue,
} from "./ticketmaster-venues";

const AMP: OurVenue = {
  id: "v-amp",
  slug: "walmart-amp",
  name: "Walmart AMP",
  aliases: ["Walmart Arkansas Music Pavilion", "Arkansas Music Pavilion", "The AMP"],
  address: "5079 W Northgate Rd",
  formerAddresses: [],
  city: "Rogers",
  lat: 36.302881,
  lng: -94.183763,
};
const WAC: OurVenue = {
  id: "v-wac",
  slug: "walton-arts-center",
  name: "Walton Arts Center",
  aliases: ["WAC"],
  address: "495 W Dickson St",
  formerAddresses: [],
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
    expect(matchTicketmasterVenue(tm({ address: "900 Other Rd", lat: 36.35, lng: -94.25 }), OURS, new Map())).toMatchObject({ kind: "name_far", venue: AMP });
  });

  it("doesn't match the same name in another city", () => {
    expect(matchTicketmasterVenue(tm({ city: "Springdale", address: "1 Elsewhere St", lat: 36.18, lng: -94.13 }), OURS, new Map()).kind).toBe("none");
  });

  it("proposes an unnamed match only within 150 m", () => {
    expect(matchTicketmasterVenue(tm({ name: "AMP Lawn Seats", address: null, lat: 36.3035, lng: -94.1835 }), OURS, new Map())).toMatchObject({
      kind: "nearby",
      venue: AMP,
    });
    expect(matchTicketmasterVenue(tm({ name: "Some Bar", address: null, lat: 36.31, lng: -94.19 }), OURS, new Map()).kind).toBe("none");
  });

  it("ignores venues outside NWA", () => {
    expect(matchTicketmasterVenue(tm({ name: "BOK Center", city: "Tulsa", lat: 36.1534, lng: -95.9965 }), OURS, new Map()).kind).toBe(
      "outside_nwa",
    );
  });
});

describe("normalizeStreetAddress", () => {
  it("makes common spellings of one address equal", () => {
    expect(normalizeStreetAddress("5079 West Northgate Road,")).toBe("5079 w northgate rd");
    expect(normalizeStreetAddress("5079 W. Northgate Rd")).toBe("5079 w northgate rd");
    expect(normalizeStreetAddress("1255 S Razorback Rd,")).toBe(normalizeStreetAddress("1255 South Razorback Road"));
  });
});

describe("Ticketmaster's unreliable coordinates", () => {
  // Real case: six Fayetteville venues all carried 35.9902, -94.083.
  const PLACEHOLDER = { lat: 35.9902, lng: -94.083 };
  const venues = [
    tm({ id: "A", name: "Walton Arts Center - Baum Walker Hall", address: "495 W Dickson St", city: "Fayetteville", ...PLACEHOLDER }),
    tm({ id: "B", name: "Barnhill Arena", address: "285 N. Stadium Drive", city: "Fayetteville", ...PLACEHOLDER }),
    tm({ id: "C", name: "Razorback Field", address: "449 Stadium Dr,", city: "Fayetteville", ...PLACEHOLDER }),
    tm({}),
  ];
  const placeholders = placeholderPoints(venues);

  it("treats a point shared by 2+ venues as a placeholder", () => {
    expect([...placeholders]).toEqual(["35.9902,-94.083"]);
  });

  it("matches on street address when the name differs, ignoring the fake distance", () => {
    expect(matchTicketmasterVenue(venues[0], OURS, new Map(), placeholders)).toMatchObject({
      kind: "address",
      venue: WAC,
      distanceM: null,
      coordsUnreliable: true,
    });
  });

  it("doesn't call a placeholder-located name match far away", () => {
    const wacByName = tm({ id: "D", name: "Walton Arts Center", address: "1 Wrong St", city: "Fayetteville", ...PLACEHOLDER });
    expect(matchTicketmasterVenue(wacByName, OURS, new Map(), placeholders)).toMatchObject({ kind: "name", venue: WAC, distanceM: null });
  });

  it("leaves real unknowns as no match", () => {
    expect(matchTicketmasterVenue(venues[1], OURS, new Map(), placeholders).kind).toBe("none");
  });
});

describe("coverageReport", () => {
  it("summarizes events by status and lists every venue", () => {
    const matches = [
      matchTicketmasterVenue(tm({}), OURS, new Map()),
      matchTicketmasterVenue(tm({ id: "K2", name: "Unknown Club", address: "1 Club St", lat: 36.2, lng: -94.1, events: 3 }), OURS, new Map()),
    ];
    const md = coverageReport(matches, new Date("2026-10-03T15:00:00Z"));
    expect(md).toContain("2 Ticketmaster venues, 15 events.");
    expect(md).toContain("- Proposed matches: 12 events");
    expect(md).toContain("- Need a decision: 3 events");
    expect(md).toContain(
      "| KovZ1 | Walmart AMP | 5079 W Northgate Rd | Rogers | 12 | **proposed** (same name, same city) | walmart-amp | 5079 W Northgate Rd | 0 m |",
    );
  });
});

describe("namesMatchClosely", () => {
  const momentary = { name: "The Momentary", aliases: [] };
  const bud = { name: "Bud Walton Arena", aliases: ["Bud Walton"] };
  it("accepts equal names, whole-word containment, and aliases", () => {
    expect(namesMatchClosely("The Momentary - AR", momentary)).toBe(true);
    expect(namesMatchClosely("BUD WALTON ARENA", bud)).toBe(true);
    expect(namesMatchClosely("Bud Walton", bud)).toBe(true);
    expect(namesMatchClosely("Arkansas Music Pavilion", AMP)).toBe(true);
  });

  it("rejects different buildings that share a word", () => {
    expect(namesMatchClosely("Barnhill Arena", bud)).toBe(false);
    // A one-word alias doesn't swallow a longer name: the bookmobile isn't the library.
    expect(namesMatchClosely("FPL on Wheels Bookmobile", { name: "Fayetteville Public Library", aliases: ["FPL"] })).toBe(false);
    expect(namesMatchClosely("FPL - Arkansas", { name: "Fayetteville Public Library", aliases: ["FPL"] })).toBe(true);
    expect(namesMatchClosely("Momentary Coffee", { name: "Moment Bar", aliases: [] })).toBe(false);
    expect(namesMatchClosely(null, bud)).toBe(false);
  });
});

describe("placeholder threshold", () => {
  it("flags a point shared by just two venues", () => {
    expect(placeholderPoints([tm({ id: "X" }), tm({ id: "Y" }), tm({ id: "Z", lat: 36.1, lng: -94.1 })]).size).toBe(1);
  });
});

describe("linkProposalFor", () => {
  const BUD: OurVenue = {
    id: "v-bud",
    slug: "bud-walton-arena",
    name: "Bud Walton Arena",
    aliases: ["Bud Walton"],
    address: "1270 Nolan Richardson Dr",
    formerAddresses: ["1240 Leroy Pond Dr"],
    city: "Fayetteville",
    lat: 36.06157,
    lng: -94.178107,
  };
  const none = new Set<string>();

  it("path a: a real point within 150 m and a close name", () => {
    expect(linkProposalFor(tm({ address: "elsewhere", lat: 36.3035, lng: -94.1835 }), [AMP], none)).toMatchObject({ venue: AMP, path: "location" });
  });

  it("path b: a matching street address, including a former address, and a close name", () => {
    const bud = tm({ id: "B", name: "Bud Walton Arena", address: "1240 Leroy Pond Drive", city: "Fayetteville", lat: 35.9902, lng: -94.083 });
    expect(linkProposalFor(bud, [BUD], new Set(["35.9902,-94.083"]))).toEqual({ venue: BUD, path: "address", distanceM: null });
  });

  it("path b: proposes Ozark Music Hall, where Ticketmaster omits the N directional", () => {
    const OZARK: OurVenue = {
      id: "v-oz",
      slug: "ozark-music-hall",
      name: "Ozark Music Hall",
      aliases: ["JJ's Live"],
      address: "3615 N Steele Blvd",
      formerAddresses: [],
      city: "Fayetteville",
      lat: 36.117211,
      lng: -94.157155,
    };
    const tmOzark = tm({ id: "Z7r9jZa7fx", name: "Ozark Music Hall", address: "3615 Steele Blvd", city: "Fayetteville", lat: 36.106499, lng: -94.2715 });
    expect(linkProposalFor(tmOzark, [OZARK], none)).toEqual({ venue: OZARK, path: "address", distanceM: null });
  });

  it("path b: never proposes across opposite directionals (the Arvest case)", () => {
    const ARVEST: OurVenue = {
      id: "v-arv",
      slug: "arvest-ballpark",
      name: "Arvest Ballpark",
      aliases: [],
      address: "3000 S 56th St",
      formerAddresses: [],
      city: "Springdale",
      lat: 36.159952,
      lng: -94.194279,
    };
    const tmArvest = tm({ id: "A1", name: "Arvest Ballpark", address: "3000 N 56th St", city: "Springdale", lat: 35.9902, lng: -94.083 });
    expect(linkProposalFor(tmArvest, [ARVEST], new Set(["35.9902,-94.083"]))).toBeNull();
  });

  it("never proposes without a close name, whatever the address or distance", () => {
    expect(linkProposalFor(tm({ name: "Some Other Hall" }), [AMP], none)).toBeNull();
  });

  it("doesn't use a placeholder point, and doesn't match an address in another city", () => {
    expect(linkProposalFor(tm({ address: "elsewhere", lat: 36.3035, lng: -94.1835 }), [AMP], new Set(["36.3035,-94.1835"]))).toBeNull();
    expect(linkProposalFor(tm({ city: "Springdale", lat: null, lng: null }), [AMP], none)).toBeNull();
  });
});

describe("subSpaceName", () => {
  it("takes the room name after the venue name", () => {
    expect(subSpaceName("Walton Arts Center - Baum Walker Hall", WAC)).toBe("Baum Walker Hall");
    expect(subSpaceName("WAC: Starr Theater", WAC)).toBe("Starr Theater");
  });

  it("ignores state suffixes and plain names", () => {
    expect(subSpaceName("The Momentary - AR", { name: "The Momentary", aliases: [] })).toBeNull();
    expect(subSpaceName("Walmart AMP", AMP)).toBeNull();
    expect(subSpaceName("Other Place - Hall B", WAC)).toBeNull();
  });
});
