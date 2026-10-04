import { describe, expect, it } from "vitest";
import {
  icsDescriptionPurgeAfter,
  icsExternalId,
  IcsParseError,
  parseIcs,
  parseLine,
  repairCp1252,
  unfold,
  unescapeText,
} from "./ics";

const FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//CivicPlus//Calendar//EN",
  "X-WR-TIMEZONE:America/Chicago",
  "BEGIN:VTIMEZONE",
  "TZID:Central Standard Time",
  "BEGIN:STANDARD",
  "DTSTART:16010101T020000",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0600",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:event-123@example.org",
  "SUMMARY:Jazz on the Square\\, Night 1",
  "DTSTART;TZID=Central Standard Time:20261010T190000",
  "DTEND;TZID=Central Standard Time:20261010T210000",
  "LOCATION:Bentonville Square\\, 100 N Main St",
  "DESCRIPTION:Long promotional text, internal only. Free admission!",
  "X-ALT-DESC;FMTTYPE=text/html:<p>More text</p>",
  "URL:https://www.example.org/calendar.aspx?EID=123",
  "CATEGORIES:Music,Community\\, Outdoors",
  "STATUS:confirmed",
  "SEQUENCE:2",
  "BEGIN:VALARM",
  "TRIGGER:-PT15M",
  "DESCRIPTION:Reminder",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:storytime@example.org",
  "SUMMARY:Storytime",
  "DTSTART;VALUE=DATE:20261012",
  "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=6",
  "EXDATE;VALUE=DATE:20261019,20261026",
  "GEO:36.3727;-94.2088",
  "URL:javascript:alert(1)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:storytime@example.org",
  "RECURRENCE-ID;VALUE=DATE:20261102",
  "SUMMARY:Storytime (moved)",
  "DTSTART:20261103T150000Z",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

describe("unfold and parseLine", () => {
  it("joins folded lines", () => {
    // Each fold removes the line break and exactly one leading space or tab.
    expect(unfold("SUMMARY:Long\r\n  title\r\n\there\r\nUID:1")).toEqual(["SUMMARY:Long titlehere", "UID:1"]);
  });

  it("parses quoted params containing separators", () => {
    expect(parseLine('ATTENDEE;CN="Doe; John: Jr.";ROLE=CHAIR:mailto:j@example.org')).toEqual({
      name: "ATTENDEE",
      params: { CN: "Doe; John: Jr.", ROLE: "CHAIR" },
      value: "mailto:j@example.org",
    });
    expect(parseLine("not a content line")).toBeNull();
  });

  it("repairs Windows-1252 punctuation that arrived as C1 controls", () => {
    // Seen in the Fayetteville Public Library feed: "Baby Bookworms (Ages 0\u009624 months)".
    expect(repairCp1252("Ages 0\u009624 months")).toBe("Ages 0–24 months");
    expect(repairCp1252("\u0093Quoted\u0094 \u0085 it\u0092s")).toBe("“Quoted” … it’s");
    // Undefined slots are dropped, and normal text is untouched.
    expect(repairCp1252("a\u0081b")).toBe("ab");
    expect(repairCp1252("Café – “ok”")).toBe("Café – “ok”");
    expect(unescapeText("Grades 5\u009612\\, Teens")).toBe("Grades 5–12, Teens");
  });

  it("unescapes TEXT values", () => {
    expect(unescapeText("a\\, b\\; c\\\\d\\ne")).toBe("a, b; c\\d\ne");
  });
});

describe("parseIcs", () => {
  const cal = parseIcs(FEED);

  it("reads calendar-level zone info", () => {
    expect(cal.defaultTimezone).toBe("America/Chicago");
    expect(cal.timezones).toEqual(["Central Standard Time"]);
    expect(cal.events).toHaveLength(3);
  });

  it("keeps the whitelisted facts, exactly as written", () => {
    expect(cal.events[0]).toEqual({
      uid: "event-123@example.org",
      recurrenceId: null,
      summary: "Jazz on the Square, Night 1",
      description: "Long promotional text, internal only. Free admission!",
      dtstart: { value: "20261010T190000", tzid: "Central Standard Time", isDate: false },
      dtend: { value: "20261010T210000", tzid: "Central Standard Time", isDate: false },
      duration: null,
      rrule: null,
      rdate: [],
      exdate: [],
      location: "Bentonville Square, 100 N Main St",
      geo: null,
      url: "https://www.example.org/calendar.aspx?EID=123",
      status: "CONFIRMED",
      categories: ["Music", "Community, Outdoors"],
      sequence: 2,
      lastModified: null,
    });
  });

  it("reads the event's DESCRIPTION, but no other free text, and nothing from VALARM", () => {
    const json = JSON.stringify(cal);
    expect(json).not.toMatch(/More text|Reminder/);
    expect(cal.events[1].description).toBeNull();
  });

  it("handles date-only, recurrence, exceptions, GEO, and drops non-http URLs", () => {
    expect(cal.events[1]).toMatchObject({
      dtstart: { value: "20261012", isDate: true },
      rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=6",
      exdate: [
        { value: "20261019", isDate: true },
        { value: "20261026", isDate: true },
      ],
      geo: { lat: 36.3727, lng: -94.2088 },
      url: null,
    });
    expect(cal.events[2]).toMatchObject({
      recurrenceId: { value: "20261102", isDate: true },
      dtstart: { value: "20261103T150000Z", isDate: false },
    });
  });

  it("rejects things that aren't calendars, or are malformed", () => {
    expect(() => parseIcs("<html>Just a moment...</html>")).toThrow(IcsParseError);
    expect(() => parseIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT\nEND:VCALENDAR")).toThrow(/doesn't match/);
    expect(() => parseIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:1")).toThrow(/unclosed/);
  });

  it("caps the number of events", () => {
    const many = ["BEGIN:VCALENDAR", ...Array.from({ length: 4 }, (_, i) => `BEGIN:VEVENT\nUID:${i}\nEND:VEVENT`), "END:VCALENDAR"].join("\n");
    expect(() => parseIcs(many, { maxEvents: 3 })).toThrow(/more than 3/);
  });
});

describe("icsExternalId", () => {
  const cal = parseIcs(FEED);
  it("uses UID, adding RECURRENCE-ID for overridden occurrences", () => {
    expect(icsExternalId(cal.events[1])).toBe("storytime@example.org");
    expect(icsExternalId(cal.events[2])).toBe("storytime@example.org|20261102");
  });

  it("falls back to a stable hash without a UID", () => {
    const e = { ...cal.events[0], uid: null };
    expect(icsExternalId(e)).toMatch(/^nouid:[0-9a-f]{32}$/);
    expect(icsExternalId(e)).toBe(icsExternalId({ ...e }));
  });
});

describe("icsDescriptionPurgeAfter", () => {
  const base = parseIcs(FEED).events[0];
  it("is 31 days after the end date (30 plus a day of time-zone slack)", () => {
    expect(icsDescriptionPurgeAfter(base)?.toISOString()).toBe("2026-11-10T00:00:00.000Z");
  });

  it("falls back to the start date when there's no end", () => {
    expect(icsDescriptionPurgeAfter({ ...base, dtend: null })?.toISOString()).toBe("2026-11-10T00:00:00.000Z");
  });

  it("uses a recurring event's UNTIL, and is null for an open-ended series", () => {
    expect(icsDescriptionPurgeAfter({ ...base, rrule: "FREQ=WEEKLY;UNTIL=20261231T235959Z" })?.toISOString()).toBe(
      "2027-01-31T00:00:00.000Z",
    );
    expect(icsDescriptionPurgeAfter({ ...base, rrule: "FREQ=WEEKLY;COUNT=10" })).toBeNull();
    expect(icsDescriptionPurgeAfter({ ...base, rrule: "FREQ=WEEKLY" })).toBeNull();
  });
});
