import { describe, expect, it, vi } from "vitest";
import { botUserAgent } from "@/lib/bot-identity";
import { FetchBlockedError } from "@/lib/http/fetch";
import { censusGeocode } from "./geocode";
import { normalizeVenueName, venueNameKeys } from "./normalize";
import { type SeedVenue, seedFileSchema, seedVenueSchema, venuesHash } from "./seed-file";
import { checkGeocode, checkVenues, distanceMeters } from "./verify";

const TODAY = new Date("2026-10-03T12:00:00Z");
const prov = { url: "https://example.org/visit", checkedAt: "2026-10-02" };

function venue(overrides: Record<string, unknown> = {}): SeedVenue {
  return seedVenueSchema.parse({
    slug: "walton-arts-center",
    name: "Walton Arts Center",
    aliases: ["WAC"],
    venueType: "theater",
    address: "495 W Dickson St",
    city: "Fayetteville",
    postalCode: "72701",
    lat: 36.066,
    lng: -94.164,
    verification: { name: prov, address: prov, location: prov },
    ...overrides,
  });
}

const messages = (vs: SeedVenue[]) => checkVenues(vs, TODAY).map((i) => `${i.level}: ${i.message}`);

describe("normalizeVenueName", () => {
  it.each([
    ["The Momentary", "momentary"],
    ["  Walton  Arts Center. ", "walton arts center"],
    ["George's Majestic Lounge", "georges majestic lounge"],
    ["W.A.C.", "wac"],
    ["Café Rollé", "cafe rolle"],
    ["Arts & Science", "arts and science"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeVenueName(input)).toBe(expected);
  });

  it("dedupes name and alias keys", () => {
    expect(venueNameKeys({ name: "The Momentary", aliases: ["Momentary", "the momentary"] })).toEqual([
      "momentary",
    ]);
  });
});

describe("seed file schema", () => {
  it("fills defaults", () => {
    const v = venue();
    expect(v).toMatchObject({ state: "AR", parent: null, website: null });
  });

  it("lets only area venues omit the address", () => {
    expect(() => venue({ address: null, verification: { name: prov, location: prov } })).toThrow(
      /only area venues/,
    );
    expect(
      venue({
        slug: "dickson-street",
        venueType: "area",
        address: null,
        postalCode: null,
        verification: { name: prov, location: prov },
      }).address,
    ).toBeNull();
  });

  it("requires provenance for every stated field", () => {
    expect(() => venue({ verification: { name: prov, location: prov } })).toThrow(/address needs provenance/);
    expect(() => venue({ website: "https://www.waltonartscenter.org/" })).toThrow(/website needs provenance/);
    expect(() => venue({ verification: { name: prov, address: prov } })).toThrow();
  });

  it("rejects non-https websites, bad slugs, and over-precise coordinates", () => {
    const withSite = { verification: { name: prov, address: prov, location: prov, website: prov } };
    expect(() => venue({ ...withSite, website: "http://example.org" })).toThrow();
    expect(() => venue({ slug: "Walton Arts" })).toThrow(/kebab-case/);
    expect(() => venue({ lat: 36.0661234 })).toThrow(/6 decimal/);
  });

  it("requires a source for former addresses", () => {
    expect(() => venue({ formerAddresses: ["1240 Leroy Pond Dr"] })).toThrow(/former addresses need provenance/);
    const v = venue({
      formerAddresses: ["1240 Leroy Pond Dr"],
      verification: { name: prov, address: prov, location: prov, formerAddresses: prov },
    });
    expect(v.formerAddresses).toEqual(["1240 Leroy Pond Dr"]);
    expect(venue().formerAddresses).toEqual([]);
  });

  it("rejects unknown keys, so typos don't silently drop data", () => {
    expect(() => venue({ adress: "x" })).toThrow();
  });

  it("records owner-verified sources with what the owner confirmed", () => {
    const owner = { ...prov, verifiedBy: "owner", confirmed: "springdalear.gov lists 3000 Gene George Blvd" };
    expect(venue({ verification: { name: prov, address: owner, location: prov } }).verification.address).toEqual(owner);
    expect(() => venue({ verification: { name: prov, address: { ...prov, verifiedBy: "owner" }, location: prov } })).toThrow(
      /confirmed/,
    );
    expect(() => venue({ verification: { name: prov, address: { ...prov, confirmed: "x x x x x" }, location: prov } })).toThrow();
  });

  it("allows a missing url only for owner-verified sources", () => {
    const given = { checkedAt: "2026-10-03", verifiedBy: "owner", confirmed: "Owner gave the ZIP as 72758" };
    expect(venue({ verification: { name: prov, address: given, location: prov } }).verification.address?.url).toBeUndefined();
    expect(() => venue({ verification: { name: prov, address: { checkedAt: "2026-10-03" }, location: prov } })).toThrow(/url/);
  });

  it("accepts hand checks with a source, and rejects ones without", () => {
    const check = { finding: "OSM way 1 is the arena building", url: "https://www.openstreetmap.org/way/1", checkedAt: "2026-10-03" };
    expect(venue({ handChecks: [check] }).handChecks).toEqual([check]);
    expect(() => venue({ handChecks: [{ ...check, url: "not a url" }] })).toThrow();
  });

  it("parses an empty file", () => {
    expect(seedFileSchema.parse({ reviewed: null, venues: [] }).venues).toEqual([]);
  });
});

describe("venuesHash", () => {
  it("ignores key order but not values", () => {
    const a = venue();
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as SeedVenue;
    expect(venuesHash([reordered])).toBe(venuesHash([a]));
    expect(venuesHash([venue({ lat: 36.067 })])).not.toBe(venuesHash([a]));
  });
});

describe("checkVenues", () => {
  it("passes a clean venue", () => {
    expect(messages([venue()])).toEqual([]);
  });

  it("flags duplicate slugs and locations outside NWA", () => {
    expect(messages([venue(), venue({ name: "Other", aliases: [] })])).toContain("error: duplicate slug");
    expect(messages([venue({ lat: 35.15, lng: -90.05 })])[0]).toMatch(/^error: .*outside Northwest Arkansas/);
  });

  it("warns on a city outside the list", () => {
    expect(messages([venue({ city: "Fort Smith" })])).toEqual([
      'warning: city "Fort Smith" is not in the NWA city list',
    ]);
  });

  it("catches missing parents and cycles", () => {
    expect(messages([venue({ parent: "nowhere" })])).toContain('error: parent "nowhere" is not in the file');
    const a = venue({ slug: "a", name: "Alpha", aliases: [], parent: "b", lat: 36.2 });
    const b = venue({ slug: "b", name: "Beta", aliases: [], parent: "a", lat: 36.3 });
    expect(messages([a, b]).filter((m) => m.includes("loops"))).toHaveLength(2);
  });

  it("flags names or aliases shared within a city, not across cities", () => {
    const other = venue({ slug: "wac-annex", name: "WAC Annex", aliases: ["W.A.C."], lat: 36.2 });
    expect(messages([venue(), other])).toContain(
      'error: name or alias "wac" also belongs to walton-arts-center in Fayetteville',
    );
    expect(messages([venue(), { ...other, city: "Rogers" }])).toEqual([]);
  });

  it("warns on unrelated venues within 75 m, unless parented or an area", () => {
    const near = venue({ slug: "starr-theater", name: "Starr Theater", aliases: [], lat: 36.0662 });
    expect(messages([venue(), near])[0]).toMatch(/^warning: 22 m from walton-arts-center/);
    expect(messages([venue(), { ...near, parent: "walton-arts-center" }])).toEqual([]);
    const area = venue({
      slug: "dickson-street",
      name: "Dickson Street",
      aliases: [],
      venueType: "area",
      address: null,
      postalCode: null,
      verification: { name: prov, location: prov },
    });
    expect(messages([venue(), area])).toEqual([]);
  });

  it("flags stale and future-dated provenance", () => {
    const old = { ...prov, checkedAt: "2026-01-01" };
    const future = { ...prov, checkedAt: "2026-12-01" };
    expect(messages([venue({ verification: { name: old, address: prov, location: prov } })])).toEqual([
      "warning: name provenance is 275 days old",
    ]);
    expect(messages([venue({ verification: { name: prov, address: prov, location: future } })])).toEqual([
      "error: location provenance is dated in the future (2026-12-01)",
    ]);
  });
});

describe("distanceMeters", () => {
  it("is about 111 km per degree of latitude", () => {
    expect(distanceMeters({ lat: 36, lng: -94 }, { lat: 37, lng: -94 })).toBeCloseTo(111_195, -1);
  });
});

describe("checkGeocode", () => {
  const at = (dLat: number) => ({ lat: 36.066 + dLat, lng: -94.164, matchedAddress: "495 W DICKSON ST" });
  it("passes within 250 m, warns up to 1 km, errors beyond", () => {
    expect(checkGeocode(venue(), at(0.001))).toEqual([]);
    expect(checkGeocode(venue(), at(0.005))[0]?.level).toBe("warning");
    expect(checkGeocode(venue(), at(0.02))[0]?.level).toBe("error");
    expect(checkGeocode(venue(), null)[0]?.message).toMatch(/no match/);
  });

  it("warns when the ZIP disagrees with the geocoder's", () => {
    expect(checkGeocode(venue(), { ...at(0), zip: "72703" })).toEqual([
      expect.objectContaining({ level: "warning", message: expect.stringMatching(/ZIP 72701 disagrees/) }),
    ]);
    expect(checkGeocode(venue(), { ...at(0), zip: "72701" })).toEqual([]);
  });

  it("gives parks and campuses more room", () => {
    const park = venue({ venueType: "park" });
    expect(checkGeocode(park, at(0.005))).toEqual([]);
    expect(checkGeocode(park, at(0.02))[0]?.level).toBe("warning");
    expect(checkGeocode(park, at(0.03))[0]?.level).toBe("error");
  });

  it("errors when a building's address geocodes over 1 km away, whatever the cause", () => {
    // The real Arvest Ballpark case: a stale address matched the far end of the street.
    const ballpark = venue({ venueType: "arena", address: "3000 S 56th St", lat: 36.159952, lng: -94.194279 });
    const far = { lat: 36.2126, lng: -94.1953, matchedAddress: "3000 N 56TH ST, SPRINGDALE, AR, 72762" };
    expect(checkGeocode(ballpark, far)[0]?.level).toBe("error");
  });
});

describe("censusGeocode", () => {
  it("sends our user agent and returns the first match", async () => {
    const fetchMock = vi.fn<(url: URL, init?: RequestInit) => Promise<Response>>(async () =>
      Response.json({
        result: {
          addressMatches: [
            { matchedAddress: "495 W DICKSON ST, FAYETTEVILLE, AR, 72701", coordinates: { x: -94.1641, y: 36.0659 } },
          ],
        },
      }),
    );
    const match = await censusGeocode("495 W Dickson St, Fayetteville, AR 72701", {
      fetch: fetchMock as unknown as typeof fetch,
      userAgent: "Agent479Bot (contact: test@example.org)",
    });
    expect(match).toMatchObject({
      lat: 36.0659,
      lng: -94.1641,
      matchedAddress: "495 W DICKSON ST, FAYETTEVILLE, AR, 72701",
      zip: "72701",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url.searchParams.get("address")).toBe("495 W Dickson St, Fayetteville, AR 72701");
    expect(new Headers(init?.headers).get("User-Agent")).toBe("Agent479Bot (contact: test@example.org)");
  });

  it("returns null when nothing matches, throws on HTTP errors, and stops on a block", async () => {
    const empty = async () => Response.json({ result: { addressMatches: [] } });
    const opts = { userAgent: "Agent479Bot (contact: t@example.org)" };
    expect(await censusGeocode("nowhere", { ...opts, fetch: empty as unknown as typeof fetch })).toBeNull();
    const down = async () => new Response("", { status: 503 });
    await expect(censusGeocode("x", { ...opts, fetch: down as unknown as typeof fetch })).rejects.toThrow(
      /503/,
    );
    const refused = async () => new Response("", { status: 403 });
    await expect(
      censusGeocode("x", { ...opts, fetch: refused as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(FetchBlockedError);
  });
});

describe("botUserAgent", () => {
  it("builds the honest user agent and refuses without a contact", () => {
    expect(botUserAgent("ops@example.org")).toBe("Agent479Bot (contact: ops@example.org)");
    expect(() => botUserAgent("  ")).toThrow(/BOT_CONTACT_EMAIL/);
  });
});
