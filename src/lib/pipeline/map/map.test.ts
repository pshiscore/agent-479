import { describe, expect, it } from "vitest";
import { MapError, mapRecord, SkipRecord } from "./index";
import { eventUrlFromTemplate } from "./ics";
import { durationMs, icsInstant } from "./time";

const CITY = { baseUrl: "https://www.rogersar.gov/", config: { eventUrl: "Calendar.aspx?EID={uid}" } };
const LIB = { baseUrl: "https://www.faylib.org/", config: { eventUrl: "https://faylib.org/event/{uid}" } };

const icsEvent = (over: Record<string, unknown> = {}) => ({
  uid: "4397",
  recurrenceId: null,
  summary: "Ghost Walks",
  dtstart: { value: "20261028T190000", tzid: "America/Chicago", isDate: false },
  dtend: { value: "20261028T203000", tzid: "America/Chicago", isDate: false },
  duration: null,
  rrule: null,
  rdate: [],
  exdate: [],
  location: "<p>Rogers Historical Museum</p> - 313 S 2nd St  Rogers AR 72756",
  geo: null,
  url: null,
  status: "CONFIRMED",
  categories: ["Museum"],
  sequence: null,
  lastModified: null,
  ...over,
});
const ics = (over: Record<string, unknown> = {}, feed: Record<string, unknown> = {}) => ({
  format: "ics",
  feed: { url: "https://www.rogersar.gov/x.ics", defaultTimezone: "America/Chicago", timezones: ["America/Chicago"], ...feed },
  event: icsEvent(over),
});

describe("time conversion", () => {
  it("converts Chicago wall time across DST, and UTC as given", () => {
    // October: CDT (UTC-5). December: CST (UTC-6).
    expect(icsInstant({ value: "20261028T190000", tzid: "America/Chicago", isDate: false }, null).at.toISOString()).toBe("2026-10-29T00:00:00.000Z");
    expect(icsInstant({ value: "20261212T190000", tzid: "Central Standard Time", isDate: false }, null).at.toISOString()).toBe("2026-12-13T01:00:00.000Z");
    expect(icsInstant({ value: "20261013T143000Z", isDate: false }, null).at.toISOString()).toBe("2026-10-13T14:30:00.000Z");
  });

  it("treats date-only values as Chicago midnight, all day", () => {
    expect(icsInstant({ value: "20261010", isDate: true }, null)).toEqual({ at: new Date("2026-10-10T05:00:00.000Z"), allDay: true, assumed: false });
  });

  it("assumes Chicago for floating times only when the feed names no zone, and refuses other zones", () => {
    expect(icsInstant({ value: "20261010T190000", isDate: false }, null).assumed).toBe(true);
    expect(icsInstant({ value: "20261010T190000", isDate: false }, "America/Chicago").assumed).toBe(false);
    expect(() => icsInstant({ value: "20261010T190000", tzid: "America/New_York", isDate: false }, null)).toThrow(MapError);
  });

  it("reads ICS durations", () => {
    expect(durationMs("PT2H30M")).toBe(9_000_000);
    expect(durationMs("P1D")).toBe(86_400_000);
    expect(() => durationMs("two hours")).toThrow(MapError);
  });
});

describe("ICS mapper", () => {
  it("maps a CivicPlus event: Chicago times, parsed location, and the confirmed event link", () => {
    const f = mapRecord(ics(), CITY);
    expect(f).toMatchObject({
      title: "Ghost Walks",
      startAt: "2026-10-29T00:00:00.000Z",
      endAt: "2026-10-29T01:30:00.000Z",
      allDay: false,
      status: "scheduled",
      sourceUrl: "https://www.rogersar.gov/Calendar.aspx?EID=4397",
      ticketUrl: null,
      location: { name: "Rogers Historical Museum", street: "313 S 2nd St", city: "Rogers", externalVenueId: null },
      sourceCategories: ["Museum"],
      timezoneAssumed: false,
    });
  });

  it("maps a library event with a UTC start and a room", () => {
    const f = mapRecord(
      ics(
        {
          uid: "17128407",
          summary: "Preschool Story Time (Ages 3–5)",
          dtstart: { value: "20261013T143000Z", isDate: false },
          dtend: null,
          duration: "PT30M",
          location: "Fayetteville Public Library - Walmart Story Time Room (1st Floor)",
        },
        { defaultTimezone: null },
      ),
      LIB,
    );
    expect(f).toMatchObject({
      startAt: "2026-10-13T14:30:00.000Z",
      endAt: "2026-10-13T15:00:00.000Z",
      sourceUrl: "https://faylib.org/event/17128407",
      location: { name: "Fayetteville Public Library", room: "Walmart Story Time Room (1st Floor)" },
    });
  });

  it("keeps a feed URL over the template, and only templates numeric UIDs", () => {
    expect(mapRecord(ics({ url: "https://example.org/e/1" }), CITY).sourceUrl).toBe("https://example.org/e/1");
    expect(eventUrlFromTemplate(CITY, "abc@x.org")).toBeNull();
    expect(eventUrlFromTemplate({ baseUrl: "https://x.example/", config: {} }, "42")).toBeNull();
  });

  it("marks cancellations, keeps recurrence for series detection, and drops inverted ends", () => {
    expect(mapRecord(ics({ status: "CANCELLED" }), CITY).status).toBe("cancelled");
    expect(mapRecord(ics({ rrule: "FREQ=WEEKLY", exdate: [{ value: "20261104T190000", isDate: false }] }), CITY).recurrence).toEqual({
      rrule: "FREQ=WEEKLY",
      exdates: ["20261104T190000"],
    });
    expect(mapRecord(ics({ dtend: { value: "20261028T180000", tzid: "America/Chicago", isDate: false } }), CITY).endAt).toBeNull();
  });

  it("fails records with no title or start", () => {
    expect(() => mapRecord(ics({ summary: null }), CITY)).toThrow(MapError);
    expect(() => mapRecord(ics({ dtstart: null }), CITY)).toThrow(MapError);
  });
});

const tmEvent = (over: Record<string, unknown> = {}) => ({
  id: "E1",
  name: "Ziggy Marley",
  url: "https://www.ticketmaster.com/event/E1",
  start: { localDate: "2026-10-16", localTime: "20:00:00", dateTime: "2026-10-17T01:00:00Z", dateTBD: false, dateTBA: false, timeTBA: false, noSpecificTime: false },
  end: null,
  timezone: "America/Chicago",
  status: "onsale",
  priceRanges: [
    { type: "standard", currency: "USD", min: 45, max: 89.5 },
    { type: "standard including fees", currency: "USD", min: 52.1, max: 99 },
  ],
  classification: { segment: "Music", genre: "Reggae", subGenre: "Undefined" },
  legalAgeEnforced: false,
  venues: [{ id: "Z7r9jZa7fx", name: "Ozark Music Hall", address: "3615 Steele Blvd", city: "Fayetteville", state: "AR", postalCode: "72703", lat: 36.1065, lng: -94.2715 }],
  attractions: [{ id: "A1", name: "Ziggy Marley" }],
  ...over,
});
const tm = (over: Record<string, unknown> = {}) => ({ format: "ticketmaster", event: tmEvent(over) });
const TM_SOURCE = { baseUrl: "https://app.ticketmaster.com/discovery/v2/", config: {} };

describe("Ticketmaster mapper", () => {
  it("maps facts and links, and carries the venue ID, not Ticketmaster's coordinates", () => {
    const f = mapRecord(tm(), TM_SOURCE);
    expect(f).toMatchObject({
      title: "Ziggy Marley",
      startAt: "2026-10-17T01:00:00.000Z",
      timeTba: false,
      status: "scheduled",
      sourceUrl: "https://www.ticketmaster.com/event/E1",
      ticketUrl: "https://www.ticketmaster.com/event/E1",
      location: { name: "Ozark Music Hall", street: "3615 Steele Blvd", city: "Fayetteville", externalVenueId: "Z7r9jZa7fx" },
      price: { min: 45, max: 99, currency: "USD" },
      performers: ["Ziggy Marley"],
      sourceCategories: ["Music", "Reggae"],
    });
    expect(JSON.stringify(f)).not.toMatch(/36\.1065|-94\.2715/);
  });

  it("keeps the date and shows no time when the time is TBA", () => {
    const f = mapRecord(tm({ start: { localDate: "2026-10-10", localTime: null, dateTime: null, dateTBD: false, dateTBA: false, timeTBA: true, noSpecificTime: false } }), TM_SOURCE);
    expect(f).toMatchObject({ timeTba: true, startAt: "2026-10-10T05:00:00.000Z" });
  });

  it("skips events with no date yet, and maps statuses", () => {
    expect(() => mapRecord(tm({ start: { localDate: null, localTime: null, dateTime: null, dateTBD: true, dateTBA: false, timeTBA: false, noSpecificTime: false } }), TM_SOURCE)).toThrow(SkipRecord);
    expect(mapRecord(tm({ status: "cancelled" }), TM_SOURCE).status).toBe("cancelled");
    expect(mapRecord(tm({ status: "postponed" }), TM_SOURCE).status).toBe("postponed");
  });

  it("refuses a time zone other than Chicago", () => {
    expect(() => mapRecord(tm({ timezone: "America/New_York" }), TM_SOURCE)).toThrow(MapError);
  });
});
