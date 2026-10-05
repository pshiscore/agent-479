import { describe, expect, it } from "vitest";
import { changedFields, FormError, formValues, parseEventForm } from "./form";

const base = { title: "War Eagle Fair", moreInfoUrl: "https://fair.example", venueId: "", categoryId: "" };

describe("event form", () => {
  it("reads Chicago times and stores UTC", () => {
    const f = parseEventForm({ ...base, startDate: "2026-10-15", startTime: "08:00", endDate: "2026-10-18", endTime: "16:00" });
    expect(f).toMatchObject({ startAt: "2026-10-15T13:00:00.000Z", endAt: "2026-10-18T21:00:00.000Z", allDay: false });
  });

  it("treats no start time as all day, ending at the end of the last day", () => {
    expect(parseEventForm({ ...base, startDate: "2026-11-21", endDate: "2027-01-01" })).toMatchObject({ allDay: true, startAt: "2026-11-21T06:00:00.000Z", endAt: "2027-01-02T05:59:00.000Z" });
    expect(parseEventForm({ ...base, startDate: "2026-11-21" })).toMatchObject({ allDay: true, endAt: null });
  });

  it("reads checkboxes, tags, and numbers; requires a start date", () => {
    const f = parseEventForm({ ...base, startDate: "2026-10-15", free: "1", spanish: "1", tags: ["family-friendly", "outdoor"], ageMin: "21", priceMin: "" });
    expect(f).toMatchObject({ isFree: true, inSpanish: true, tagSlugs: ["family-friendly", "outdoor"], ageMin: 21, priceMin: null, registrationRequired: null });
    expect(() => parseEventForm({ ...base })).toThrow(FormError);
  });

  it("round-trips through formValues, and changedFields lists only edits", () => {
    const f = parseEventForm({ ...base, startDate: "2026-10-15", startTime: "08:00", endDate: "2026-10-18", endTime: "16:00", tags: ["outdoor"] });
    expect(parseEventForm(formValues(f))).toEqual(f);
    expect(changedFields(f, { ...f, title: "War Eagle Fair 2026" })).toEqual({ title: "War Eagle Fair 2026" });
  });
});

describe("daily hours", () => {
  const fair = { ...base, startDate: "2026-10-15", startTime: "08:00", endDate: "2026-10-18", endTime: "17:00" };

  it("reads one line per day", () => {
    expect(parseEventForm({ ...fair, dailyHours: "2026-10-15 08:00-17:00\n2026-10-18 8:00 – 16:00" }).dailyHours).toEqual([
      { day: "2026-10-15", opens: "08:00", closes: "17:00" },
      { day: "2026-10-18", opens: "08:00", closes: "16:00" },
    ]);
    expect(() => parseEventForm({ ...fair, dailyHours: "Thursday 8 to 5" })).toThrow(FormError);
  });

  it("fills every day with 'same hours every day'", () => {
    const f = parseEventForm({ ...fair, sameHours: "1" });
    expect(f.dailyHours.map((h) => h.day)).toEqual(["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(f.dailyHours[0]).toEqual({ day: "2026-10-15", opens: "08:00", closes: "17:00" });
    expect(() => parseEventForm({ ...fair, endTime: "", sameHours: "1" })).toThrow(/same hours/);
  });

  it("round-trips through formValues", () => {
    const f = parseEventForm({ ...fair, dailyHours: "2026-10-16 09:00-17:00" });
    expect(parseEventForm(formValues(f))).toEqual(f);
  });
});
