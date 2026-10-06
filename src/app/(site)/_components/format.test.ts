import { describe, expect, it } from "vitest";
import { hoursLabel, ongoingLabel, rangeLabel } from "./format";

const at = (iso: string) => new Date(iso);

describe("multi-day labels", () => {
  it("formats ranges in Chicago time", () => {
    expect(rangeLabel(at("2026-10-15T13:00:00Z"), at("2026-10-18T22:00:00Z"))).toBe("Oct 15–18");
    expect(rangeLabel(at("2026-10-30T13:00:00Z"), at("2026-11-02T22:00:00Z"))).toBe("Oct 30 – Nov 2");
    expect(rangeLabel(at("2026-12-30T13:00:00Z"), at("2027-01-02T22:00:00Z"))).toBe("Dec 30, 2026 – Jan 2, 2027");
    // 11:30 pm Chicago on Jan 1 is Jan 2 in UTC; the label follows Chicago.
    expect(rangeLabel(at("2026-11-21T06:00:00Z"), at("2027-01-02T05:30:00Z"))).toBe("Nov 21, 2026 – Jan 1, 2027");
  });

  it("says Through once a long run has started", () => {
    const lights = { startAt: at("2026-11-21T06:00:00Z"), endAt: at("2027-01-02T05:59:00Z") };
    expect(ongoingLabel(lights, at("2026-12-04T18:00:00Z"))).toBe("Through Jan 1");
    expect(ongoingLabel(lights, at("2026-11-01T18:00:00Z"))).toBe("Nov 21, 2026 – Jan 1, 2027");
  });

  it("formats a day's hours", () => {
    expect(hoursLabel({ opensAt: at("2026-10-17T13:00:00Z"), closesAt: at("2026-10-17T22:00:00Z") })).toBe("8:00 AM–5:00 PM");
    expect(hoursLabel({ opensAt: at("2026-10-17T13:00:00Z"), closesAt: null })).toBe("8:00 AM");
  });
});
