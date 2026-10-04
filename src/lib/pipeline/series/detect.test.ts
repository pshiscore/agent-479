import { describe, expect, it } from "vitest";
import { chicagoToUtc } from "@/lib/time";
import { type Occurrence, planSeries, rruleLabel, runLabel, weekdayLabel } from "./detect";

// Chicago wall-clock → occurrence. Oct 2026: Thu 1, Tue 6, Tue 13, ...
let n = 0;
const at = (date: string, time = "18:00", extra: Partial<Occurrence> = {}): Occurrence => {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return { eventId: `e${++n}`, startAt: chicagoToUtc({ year: y, month: m, day: d }, { hour: h, minute: min }), allDay: false, timeTba: false, ...extra };
};

describe("weekdayLabel", () => {
  it("names one day, pairs, lists, and the common sets", () => {
    expect(weekdayLabel([2])).toBe("Tuesdays");
    expect(weekdayLabel([4, 2])).toBe("Tue & Thu");
    expect(weekdayLabel([1, 3, 5])).toBe("Mon, Wed & Fri");
    expect(weekdayLabel([1, 2, 3, 4, 5])).toBe("Weekdays");
    expect(weekdayLabel([6, 7])).toBe("Weekends");
    expect(weekdayLabel([1, 2, 3, 4, 5, 6, 7])).toBe("Daily");
    expect(weekdayLabel([2], true)).toBe("Every other Tuesday");
  });
});

describe("planSeries", () => {
  it("finds a weekly program: 3 on the same weekday and time within 60 days", () => {
    const occ = [at("2026-10-06"), at("2026-10-13"), at("2026-10-20"), at("2026-10-27")];
    expect(planSeries(occ)).toEqual({ kind: "recurring", label: "Tuesdays", members: occ.map((o) => o.eventId) });
  });

  it("labels two weekly slots, and leaves out a one-off at another time", () => {
    const tue = [at("2026-10-06", "10:00"), at("2026-10-13", "10:00"), at("2026-10-20", "10:00")];
    const thu = [at("2026-10-08", "10:00"), at("2026-10-15", "10:00"), at("2026-10-22", "10:00")];
    const odd = at("2026-10-24", "14:00");
    const plan = planSeries([...tue, ...thu, odd]);
    expect(plan?.label).toBe("Tue & Thu");
    expect(plan?.members).toHaveLength(6);
    expect(plan?.members).not.toContain(odd.eventId);
  });

  it("says 'every other' when every gap is two weeks", () => {
    expect(planSeries([at("2026-10-06"), at("2026-10-20"), at("2026-11-03")])?.label).toBe("Every other Tuesday");
  });

  it("needs 3 in 60 days: two, or three spread too far, aren't a series", () => {
    expect(planSeries([at("2026-10-06"), at("2026-10-20")])).toBeNull();
    expect(planSeries([at("2026-10-06"), at("2026-11-17"), at("2026-12-29")])).toBeNull();
    // Same weekday but different times: no slot reaches 3.
    expect(planSeries([at("2026-10-06", "10:00"), at("2026-10-13", "11:00"), at("2026-10-20", "12:00")])).toBeNull();
  });

  it("handles DST: 6 PM stays one slot across the November change", () => {
    expect(planSeries([at("2026-10-27"), at("2026-11-03"), at("2026-11-10")])?.label).toBe("Tuesdays");
  });

  it("finds a run on consecutive days, with several shows a day", () => {
    const occ = [at("2026-10-06", "19:30"), at("2026-10-07", "19:30"), at("2026-10-08", "14:00"), at("2026-10-08", "19:30"), at("2026-10-09", "19:30")];
    expect(planSeries(occ)).toEqual({ kind: "run", label: "Oct 6–9", members: occ.map((o) => o.eventId) });
    expect(runLabel(at("2026-10-30").startAt, at("2026-11-01").startAt)).toBe("Oct 30–Nov 1");
  });

  it("groups all-day and time-TBA occurrences by weekday", () => {
    const occ = ["2026-10-10", "2026-10-17", "2026-10-24"].map((d) => at(d, "00:00", { allDay: true }));
    expect(planSeries(occ)?.label).toBe("Saturdays");
  });

  it("isn't a series with fewer than two occurrences", () => {
    expect(planSeries([at("2026-10-06")])).toBeNull();
    expect(planSeries([])).toBeNull();
  });
});

describe("rruleLabel", () => {
  it("describes weekly, every-other, daily, and monthly rules, else null", () => {
    expect(rruleLabel("FREQ=WEEKLY;BYDAY=TU")).toBe("Tuesdays");
    expect(rruleLabel("RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261231T000000Z")).toBe("Tue & Thu");
    expect(rruleLabel("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE")).toBe("Every other Wednesday");
    expect(rruleLabel("FREQ=DAILY")).toBe("Daily");
    expect(rruleLabel("FREQ=MONTHLY;BYDAY=1TU")).toBe("First Tuesday of the month");
    expect(rruleLabel("FREQ=MONTHLY;BYDAY=-1FR")).toBe("Last Friday of the month");
    expect(rruleLabel("FREQ=WEEKLY")).toBeNull();
    expect(rruleLabel("FREQ=YEARLY")).toBeNull();
  });
});
