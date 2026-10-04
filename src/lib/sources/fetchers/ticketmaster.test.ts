import { describe, expect, it, vi } from "vitest";
import { PoliteClient } from "../http";
import { SourceConfigError, type SourceRow } from "../types";
import { makeTicketmasterFetcher, ticketmasterPageUrl } from "./ticketmaster";

const KEY = "SECRET-API-KEY-123";
const NOW = new Date("2026-10-03T15:00:00Z");
const source = {
  slug: "ticketmaster",
  baseUrl: "https://app.ticketmaster.com/discovery/v2/",
  config: { center: { lat: 36.25, lng: -94.15 }, radiusMiles: 40, windowDays: 180, pageSize: 200 },
} as unknown as SourceRow;

/** Shaped like a real Discovery API event, including fields we must not keep. */
const tmEvent = (id: string) => ({
  name: "Jason Aldean: Full Throttle Tour",
  type: "event",
  id,
  url: `https://www.ticketmaster.com/event/${id}`,
  locale: "en-us",
  images: [{ ratio: "16_9", url: "https://s1.ticketm.net/dam/a/IMAGE.jpg", width: 1024 }],
  info: "INFO TEXT: bring a lawn chair",
  pleaseNote: "PLEASE NOTE TEXT: no refunds",
  description: "DESCRIPTION TEXT about the show",
  promoter: { id: "1", name: "PROMOTER NAME", description: "PROMOTER DESCRIPTION" },
  promoters: [{ id: "1", name: "PROMOTER NAME" }],
  seatmap: { staticUrl: "https://maps.ticketmaster.com/SEATMAP.png" },
  accessibility: { info: "ACCESSIBILITY TEXT" },
  products: [{ name: "PARKING PRODUCT" }],
  sales: { public: { startDateTime: "2026-05-01T15:00:00Z" } },
  dates: {
    start: { localDate: "2026-10-10", localTime: "19:00:00", dateTime: "2026-10-11T00:00:00Z", dateTBD: false, timeTBA: false },
    timezone: "America/Chicago",
    status: { code: "onsale" },
  },
  priceRanges: [{ type: "standard", currency: "USD", min: 39.5, max: 149.5 }],
  classifications: [{ primary: true, segment: { name: "Music" }, genre: { name: "Country" }, subGenre: { name: "Country" } }],
  ageRestrictions: { legalAgeEnforced: false },
  _embedded: {
    venues: [
      {
        name: "Walmart AMP",
        id: "KovZpZAEkIEA",
        url: "https://www.ticketmaster.com/venue/x",
        images: [{ url: "https://s1.ticketm.net/VENUE_IMAGE.jpg" }],
        postalCode: "72758",
        city: { name: "Rogers" },
        state: { name: "Arkansas", stateCode: "AR" },
        address: { line1: "5079 W Northgate Rd" },
        location: { longitude: "-94.18376", latitude: "36.30288" },
        generalInfo: { generalRule: "VENUE RULES TEXT" },
        boxOfficeInfo: { openHoursDetail: "BOX OFFICE TEXT" },
      },
    ],
    attractions: [{ name: "Jason Aldean", id: "K8vZ917G7x0", images: [{ url: "https://s1.ticketm.net/ARTIST.jpg" }] }],
  },
});

const page = (events: unknown[], number: number, totalPages: number, totalElements: number) =>
  JSON.stringify({ _embedded: { events }, page: { size: 200, totalElements, totalPages, number } });

function fakeTm(pages: Record<number, string>) {
  const calls: string[] = [];
  const f = vi.fn(async (url: string | URL) => {
    const u = new URL(String(url));
    calls.push(String(url));
    if (u.pathname === "/robots.txt") return new Response("", { status: 404 });
    const body = pages[Number(u.searchParams.get("page"))];
    return body === undefined ? new Response("", { status: 500 }) : new Response(body);
  });
  const http = new PoliteClient({ fetch: f as unknown as typeof fetch, userAgent: "Agent479Bot (contact: t@example.org)", minGapMs: 0 });
  return { http, calls };
}

const fetcher = makeTicketmasterFetcher({ apiKey: () => KEY, now: () => NOW });

describe("ticketmasterPageUrl", () => {
  it("asks for 180 days of events around NWA, sorted by date", () => {
    const u = new URL(ticketmasterPageUrl(source, KEY, 2, NOW).url);
    expect(u.pathname).toBe("/discovery/v2/events.json");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      radius: "40",
      unit: "miles",
      startDateTime: "2026-10-03T15:00:00Z",
      endDateTime: "2027-04-01T15:00:00Z",
      sort: "date,asc",
      size: "200",
      page: "2",
    });
    expect(u.searchParams.get("geoPoint")).toMatch(/^9y[a-z0-9]{5}$/);
  });
});

describe("ticketmaster fetcher", () => {
  it("keeps only whitelisted facts and links", async () => {
    const { http } = fakeTm({ 0: page([tmEvent("E1")], 0, 1, 1) });
    const { items } = await fetcher.fetch(source, http);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ externalId: "E1", sourceUrl: "https://www.ticketmaster.com/event/E1", descriptionText: null });
    expect(items[0].payload).toEqual({
      format: "ticketmaster",
      event: {
        id: "E1",
        name: "Jason Aldean: Full Throttle Tour",
        url: "https://www.ticketmaster.com/event/E1",
        start: {
          localDate: "2026-10-10",
          localTime: "19:00:00",
          dateTime: "2026-10-11T00:00:00Z",
          dateTBD: false,
          dateTBA: false,
          timeTBA: false,
          noSpecificTime: false,
        },
        end: null,
        timezone: "America/Chicago",
        status: "onsale",
        priceRanges: [{ type: "standard", currency: "USD", min: 39.5, max: 149.5 }],
        classification: { segment: "Music", genre: "Country", subGenre: "Country" },
        legalAgeEnforced: false,
        venues: [
          {
            id: "KovZpZAEkIEA",
            name: "Walmart AMP",
            address: "5079 W Northgate Rd",
            city: "Rogers",
            state: "AR",
            postalCode: "72758",
            lat: 36.30288,
            lng: -94.18376,
          },
        ],
        attractions: [{ id: "K8vZ917G7x0", name: "Jason Aldean" }],
      },
    });
    const json = JSON.stringify(items);
    for (const banned of ["IMAGE", "INFO TEXT", "PLEASE NOTE", "DESCRIPTION", "PROMOTER", "SEATMAP", "ACCESSIBILITY", "PARKING", "VENUE RULES", "BOX OFFICE", "ARTIST.jpg"]) {
      expect(json).not.toContain(banned);
    }
  });

  it("pages until the last page, and never stores the API key", async () => {
    const { http, calls } = fakeTm({
      0: page([tmEvent("E1"), tmEvent("E2")], 0, 2, 3),
      1: page([tmEvent("E3")], 1, 2, 3),
    });
    const result = await fetcher.fetch(source, http);
    expect(result.items.map((i) => i.externalId)).toEqual(["E1", "E2", "E3"]);
    expect(calls.filter((u) => u.includes("events.json"))).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(result.feedUrls.every((u) => u.includes("apikey=REDACTED"))).toBe(true);
  });

  it("stops at the API's 1,000-result deep paging limit", async () => {
    const pages = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, page([tmEvent(`E${i}`)], i, 8, 1_600)]));
    const { http, calls } = fakeTm(pages);
    const result = await fetcher.fetch(source, http);
    // Pages 0-4 at 200 a page reach 1,000; page 5 would go past it, so it's never requested.
    expect(calls.filter((u) => u.includes("events.json"))).toHaveLength(5);
    expect(result.items).toHaveLength(5);
    expect(result.stats.truncated).toBe(1);
  });

  it("skips events that don't parse, and counts them", async () => {
    const { http } = fakeTm({ 0: page([tmEvent("E1"), { name: "no id" }], 0, 1, 2) });
    const result = await fetcher.fetch(source, http);
    expect(result.items).toHaveLength(1);
    expect(result.stats.skipped).toBe(1);
  });

  it("refuses to run without an API key, and keeps the key out of error messages", async () => {
    const { http } = fakeTm({});
    await expect(makeTicketmasterFetcher({ apiKey: () => "" }).fetch(source, http)).rejects.toBeInstanceOf(SourceConfigError);
    const err = await fetcher.fetch(source, http).catch((e: Error) => e);
    expect(String((err as Error).message)).toMatch(/HTTP 500/);
    expect(String((err as Error).message)).not.toContain(KEY);
  });
});
