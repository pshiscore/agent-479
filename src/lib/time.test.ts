import { describe, expect, it } from "vitest";
import {
  addDays,
  chicagoParts,
  chicagoToUtc,
  formatDate,
  formatInChicago,
  isoWeekday,
  parseDate,
  weekendWindow,
} from "./time";

const iso = (d: Date) => d.toISOString();

// 2026 DST in Chicago: starts Sun Mar 8 (2:00 CST → 3:00 CDT),
// ends Sun Nov 1 (2:00 CDT → 1:00 CST).
describe("chicagoParts", () => {
  it("reads CDT wall time", () => {
    expect(chicagoParts(new Date("2026-10-08T23:00:00Z"))).toMatchObject({
      year: 2026, month: 10, day: 8, hour: 18, minute: 0, weekday: 4,
    });
  });

  it("reads CST wall time", () => {
    expect(chicagoParts(new Date("2026-12-04T00:00:00Z"))).toMatchObject({
      year: 2026, month: 12, day: 3, hour: 18, weekday: 4,
    });
  });

  it("uses 0, not 24, for midnight", () => {
    expect(chicagoParts(new Date("2026-10-09T05:00:00Z")).hour).toBe(0);
  });
});

describe("chicagoToUtc", () => {
  it("converts CDT and CST wall times", () => {
    expect(iso(chicagoToUtc({ year: 2026, month: 10, day: 9 }, { hour: 7 }))).toBe(
      "2026-10-09T12:00:00.000Z",
    );
    expect(iso(chicagoToUtc({ year: 2026, month: 12, day: 11 }, { hour: 7 }))).toBe(
      "2026-12-11T13:00:00.000Z",
    );
  });

  it("round-trips every hour across both 2026 transitions", () => {
    for (const start of ["2026-03-06T00:00:00Z", "2026-10-30T00:00:00Z"]) {
      for (let h = 0; h < 96; h++) {
        const instant = new Date(Date.parse(start) + h * 3_600_000);
        const p = chicagoParts(instant);
        const back = chicagoToUtc(p, p);
        // Ambiguous fall-back hour resolves to the earlier instant by design.
        if (back.getTime() !== instant.getTime()) {
          expect(p).toMatchObject({ month: 11, day: 1, hour: 1 });
          expect(instant.getTime() - back.getTime()).toBe(3_600_000);
        }
      }
    }
  });

  it("moves a nonexistent spring-forward time ahead by the gap", () => {
    const t = chicagoToUtc({ year: 2026, month: 3, day: 8 }, { hour: 2, minute: 30 });
    expect(iso(t)).toBe("2026-03-08T08:30:00.000Z");
    expect(chicagoParts(t)).toMatchObject({ hour: 3, minute: 30 });
  });

  it("resolves an ambiguous fall-back time to the earlier (CDT) instant", () => {
    const t = chicagoToUtc({ year: 2026, month: 11, day: 1 }, { hour: 1, minute: 30 });
    expect(iso(t)).toBe("2026-11-01T06:30:00.000Z");
  });

  it("is independent of the process time zone", () => {
    expect(process.env.TZ).toBe("UTC");
    expect(iso(chicagoToUtc({ year: 2026, month: 7, day: 4 }, { hour: 21 }))).toBe(
      "2026-07-05T02:00:00.000Z",
    );
  });
});

describe("calendar helpers", () => {
  it("formats and parses YYYY-MM-DD", () => {
    expect(formatDate({ year: 2026, month: 3, day: 8 })).toBe("2026-03-08");
    expect(parseDate("2026-03-08")).toEqual({ year: 2026, month: 3, day: 8 });
    expect(() => parseDate("3/8/2026")).toThrow();
  });

  it("adds days across month, year, and DST boundaries", () => {
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({ year: 2027, month: 1, day: 1 });
    expect(addDays({ year: 2026, month: 3, day: 7 }, 2)).toEqual({ year: 2026, month: 3, day: 9 });
    expect(addDays({ year: 2026, month: 10, day: 9 }, -5)).toEqual({ year: 2026, month: 10, day: 4 });
  });

  it("computes ISO weekdays", () => {
    expect(isoWeekday({ year: 2026, month: 10, day: 5 })).toBe(1); // Monday
    expect(isoWeekday({ year: 2026, month: 10, day: 11 })).toBe(7); // Sunday
  });
});

describe("weekendWindow", () => {
  const expected = {
    periodStart: "2026-10-09",
    periodEnd: "2026-10-11",
    startUtc: new Date("2026-10-09T05:00:00Z"),
    endUtc: new Date("2026-10-12T05:00:00Z"),
  };

  it.each([
    ["Monday morning", "2026-10-05T14:00:00Z"],
    ["Thursday 6pm draft run", "2026-10-08T23:00:00Z"],
    ["Friday 6am re-check run", "2026-10-09T11:00:00Z"],
    ["Saturday night", "2026-10-11T03:00:00Z"],
    ["Sunday 11:59pm", "2026-10-12T04:59:00Z"],
  ])("%s → the Oct 9-11 weekend", (_label, now) => {
    expect(weekendWindow(new Date(now))).toEqual(expected);
  });

  it("rolls to the next weekend at Monday 00:00 Chicago", () => {
    expect(weekendWindow(new Date("2026-10-12T05:00:00Z")).periodStart).toBe("2026-10-16");
  });

  it("is 73 hours long over the fall-back weekend", () => {
    const w = weekendWindow(new Date("2026-10-29T23:00:00Z"));
    expect(w.periodStart).toBe("2026-10-30");
    expect(iso(w.startUtc)).toBe("2026-10-30T05:00:00.000Z"); // CDT
    expect(iso(w.endUtc)).toBe("2026-11-02T06:00:00.000Z"); // CST
    expect((w.endUtc.getTime() - w.startUtc.getTime()) / 3_600_000).toBe(73);
  });

  it("is 71 hours long over the spring-forward weekend", () => {
    const w = weekendWindow(new Date("2026-03-05T12:00:00Z"));
    expect(w.periodStart).toBe("2026-03-06");
    expect(iso(w.startUtc)).toBe("2026-03-06T06:00:00.000Z"); // CST
    expect(iso(w.endUtc)).toBe("2026-03-09T05:00:00.000Z"); // CDT
    expect((w.endUtc.getTime() - w.startUtc.getTime()) / 3_600_000).toBe(71);
  });
});

describe("formatInChicago", () => {
  it("formats in Chicago regardless of the process zone", () => {
    const s = formatInChicago(new Date("2026-10-10T00:30:00Z"), {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
    expect(s).toBe("Fri, Oct 9, 7:30 PM");
  });
});
