import { describe, expect, it } from "vitest";
import { exclusionReason } from "./exclude";
import type { Facts } from "./map";

const NOW = new Date("2026-10-04T15:00:00Z");
const facts = (over: Partial<Facts>): Facts => ({
  title: "Movies in the Park",
  startAt: "2026-10-10T00:30:00.000Z",
  endAt: null,
  allDay: false,
  timeTba: false,
  status: "scheduled",
  sourceUrl: null,
  ticketUrl: null,
  location: { text: null, name: null, room: null, street: null, city: null, externalVenueId: null },
  price: { min: null, max: null, currency: null },
  performers: [],
  sourceCategories: [],
  legalAgeEnforced: null,
  recurrence: null,
  timezoneAssumed: false,
  ...over,
});

describe("exclusionReason", () => {
  it.each([
    ["City Council Meeting", "government_meeting"],
    ["Planning Commission Meeting", "government_meeting"],
    ["Board of Adjustment", "government_meeting"],
    ["Public Hearing: Rezoning", "government_meeting"],
    ["Veterans Day - City Offices Closed", "office_closure"],
    ["Thanksgiving Holiday - City Offices Closed", "office_closure"],
  ])("skips %s", (title, reason) => {
    expect(exclusionReason(facts({ title }), NOW)).toBe(reason);
  });

  it.each(["Movies in the Park", "Fall Developers Forum", "Shred It and Electronics Recycling", "City Expo and Community Volunteer Fair", "Christmas Parade"])(
    "keeps %s",
    (title) => {
      expect(exclusionReason(facts({ title }), NOW)).toBeNull();
    },
  );

  it("skips past events and events more than 18 months out, but not recurring ones with an old start", () => {
    expect(exclusionReason(facts({ startAt: "2026-09-01T00:00:00.000Z" }), NOW)).toBe("past_event");
    expect(exclusionReason(facts({ startAt: "2026-10-03T23:00:00.000Z" }), NOW)).toBeNull();
    expect(exclusionReason(facts({ startAt: "2028-06-01T00:00:00.000Z" }), NOW)).toBe("out_of_window");
    expect(exclusionReason(facts({ startAt: "2026-01-05T00:00:00.000Z", recurrence: { rrule: "FREQ=WEEKLY", exdates: [] } }), NOW)).toBeNull();
  });
});
