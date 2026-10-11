import { describe, expect, it } from "vitest";
import { yelpSearchUrl } from "./format";

describe("place links", () => {
  it("builds a plain Yelp search for the business", () => {
    expect(yelpSearchUrl({ name: "Saltine", address: "659 E Huntsville Rd", city: "Fayetteville" })).toBe(
      "https://www.yelp.com/search?find_desc=Saltine&find_loc=659%20E%20Huntsville%20Rd%2C%20Fayetteville%2C%20AR",
    );
  });
});
