import { describe, expect, it } from "vitest";
import { addressLine, openedLabel, statedDate, targetLabel } from "./format";

describe("place dates", () => {
  it("shows the date as stated, with the source's qualifier in brackets", () => {
    expect(openedLabel({ openedOn: "2026-08-10", openedPrecision: "day" })).toBe("Opened Aug 10, 2026");
    expect(openedLabel({ openedOn: "2026-06-01", openedPrecision: "month", openedQualifier: "soft opening" })).toBe("Opened June 2026 (soft opening)");
    expect(openedLabel({ openedOn: "2026-08-18", openedPrecision: "day", openedQualifier: "grand opening" })).toBe("Opened Aug 18, 2026 (grand opening)");
    expect(openedLabel({ openedOn: null, openedPrecision: null })).toBeNull();
    expect(targetLabel({ targetOn: "2026-11-01", targetPrecision: "month" })).toBe("Opening in November 2026");
    expect(statedDate("2026-09-05", "day")).toBe("Sept 5, 2026");
  });
  it("shows a food truck's home base", () => {
    expect(addressLine({ address: "Railyard Park", addressKind: "home_base" })).toBe("Based at Railyard Park");
    expect(addressLine({ address: "481 S School Ave", addressKind: "street" })).toBe("481 S School Ave");
  });
});
