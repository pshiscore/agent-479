import { describe, expect, it } from "vitest";
import { venueDisplayName } from "./display";

describe("venueDisplayName", () => {
  it("puts the hall first when there is one", () => {
    expect(venueDisplayName("Walton Arts Center", "Baum Walker Hall")).toBe("Baum Walker Hall, Walton Arts Center");
    expect(venueDisplayName("Walton Arts Center", null)).toBe("Walton Arts Center");
    expect(venueDisplayName("Walton Arts Center", "  ")).toBe("Walton Arts Center");
  });
});
