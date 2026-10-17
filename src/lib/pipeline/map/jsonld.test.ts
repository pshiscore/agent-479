import { describe, expect, it } from "vitest";
import type { JsonLdFacts } from "@/lib/sources/jsonld";
import { mapRecord, SkipRecord } from "./index";
import { jsonLdInstant } from "./jsonld";

const event = (over: Partial<JsonLdFacts> = {}): JsonLdFacts => ({
  type: "MusicEvent",
  name: "Band Night",
  startDate: "2026-10-24T20:00:00-05:00",
  endDate: null,
  eventStatus: null,
  attendanceMode: null,
  url: "https://venue.example/events/band-night/",
  location: { name: "The Hall", street: "1 Main St", city: "Rogers", text: "The Hall, 1 Main St, Rogers", virtual: false },
  offers: [{ price: 10, lowPrice: null, highPrice: 15, currency: "USD", url: "https://tickets.example/band" }],
  performers: ["The Band"],
  ...over,
});
const map = (e: JsonLdFacts) => mapRecord({ format: "jsonld", page: { url: "https://venue.example/events/" }, event: e }, { baseUrl: "https://venue.example/", config: {} });

describe("jsonLdInstant", () => {
  it("accepts Chicago's own offset, in daylight and standard time", () => {
    expect(jsonLdInstant("2026-10-24T20:00:00-05:00")).toEqual({ at: new Date("2026-10-25T01:00:00Z"), allDay: false, assumed: false });
    expect(jsonLdInstant("2026-12-05T18:30:00-0600")).toEqual({ at: new Date("2026-12-06T00:30:00Z"), allDay: false, assumed: false });
  });

  it("fails an offset that isn't Chicago's on that date (a site set to UTC, or the wrong season)", () => {
    expect(() => jsonLdInstant("2026-10-24T20:00:00+00:00")).toThrow(/isn't Chicago time/);
    expect(() => jsonLdInstant("2026-10-24T20:00:00Z")).toThrow(/isn't Chicago time/);
    expect(() => jsonLdInstant("2026-12-05T18:30:00-05:00")).toThrow(/isn't Chicago time/);
  });

  it("a date alone is all day; a time without an offset is Chicago time, assumed", () => {
    expect(jsonLdInstant("2026-10-25")).toEqual({ at: new Date("2026-10-25T05:00:00Z"), allDay: true, assumed: false });
    expect(jsonLdInstant("2026-10-25T09:00")).toEqual({ at: new Date("2026-10-25T14:00:00Z"), allDay: false, assumed: true });
    expect(() => jsonLdInstant("next Saturday")).toThrow(/unreadable/);
  });
});

describe("mapJsonLd", () => {
  it("maps facts, prices, the ticket link, and the schema.org type as a hint", () => {
    expect(map(event())).toMatchObject({
      title: "Band Night",
      startAt: "2026-10-25T01:00:00.000Z",
      allDay: false,
      status: "scheduled",
      sourceUrl: "https://venue.example/events/band-night/",
      ticketUrl: "https://tickets.example/band",
      location: { name: "The Hall", city: "Rogers", street: "1 Main St" },
      price: { min: 10, max: 15, currency: "USD" },
      performers: ["The Band"],
      sourceCategories: ["Music"],
      timezoneAssumed: false,
    });
  });

  it("an all-day range ends at the midnight after its last day; cancellations carry over", () => {
    const f = map(event({ startDate: "2026-10-24", endDate: "2026-10-25", eventStatus: "EventCancelled", type: "Event" }));
    expect(f).toMatchObject({ allDay: true, startAt: "2026-10-24T05:00:00.000Z", endAt: "2026-10-26T05:00:00.000Z", status: "cancelled", sourceCategories: [] });
  });

  it("skips online-only events", () => {
    expect(() => map(event({ attendanceMode: "OnlineEventAttendanceMode" }))).toThrow(SkipRecord);
  });
});
