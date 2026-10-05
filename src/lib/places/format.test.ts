import { describe, expect, it } from "vitest";
import { addressLine, appleDirectionsUrl, googleDirectionsUrl, googleMapsSearchUrl, justOpened, mapsQuery, openedLabel, schemaType, statedDate, targetLabel, windowLabel, windowStart } from "./format";

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

describe("New in Town window, labels, and links", () => {
  it("starts the window on the 1st of the month 6 months back, in Chicago time", () => {
    expect(windowStart(new Date("2026-10-05T12:00:00Z"))).toBe("2026-04-01");
    expect(windowStart(new Date("2026-03-15T12:00:00Z"))).toBe("2025-09-01");
    // 11 pm Sept 30 in Chicago is already Oct 1 in UTC; the window still follows Chicago.
    expect(windowStart(new Date("2026-10-01T04:00:00Z"))).toBe("2026-03-01");
    expect(windowLabel("2026-04-01")).toBe("April 2026");
  });

  it("marks Just opened only for a stated day within 30 days", () => {
    const now = new Date("2026-10-05T17:00:00Z");
    expect(justOpened({ openedOn: "2026-09-20", openedPrecision: "day" }, now)).toBe(true);
    expect(justOpened({ openedOn: "2026-08-18", openedPrecision: "day" }, now)).toBe(false);
    expect(justOpened({ openedOn: "2026-10-01", openedPrecision: "month" }, now)).toBe(false);
    expect(justOpened({ openedOn: null, openedPrecision: null }, now)).toBe(false);
  });

  it("builds Maps links from the name, address, and city (no API, no key)", () => {
    const q = mapsQuery({ name: "Dodo Coffee", address: "W McMillan Dr at W Wedington Dr", city: "Fayetteville" });
    expect(q).toBe("Dodo Coffee, W McMillan Dr at W Wedington Dr, Fayetteville, AR");
    expect(googleMapsSearchUrl(q)).toBe("https://www.google.com/maps/search/?api=1&query=Dodo%20Coffee%2C%20W%20McMillan%20Dr%20at%20W%20Wedington%20Dr%2C%20Fayetteville%2C%20AR");
    expect(googleDirectionsUrl("A & B")).toBe("https://www.google.com/maps/dir/?api=1&destination=A%20%26%20B");
    expect(appleDirectionsUrl("A & B")).toBe("https://maps.apple.com/?daddr=A%20%26%20B");
  });

  it("maps place types to schema.org types", () => {
    expect(schemaType("brewery")).toBe("Brewery");
    expect(schemaType("coffee_shop")).toBe("CafeOrCoffeeShop");
    expect(schemaType("food_truck")).toBe("FoodEstablishment");
  });
});
