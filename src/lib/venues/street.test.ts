import { describe, expect, it } from "vitest";
import { sameStreetAddress, streetDifference, streetParts } from "./street";

describe("streetParts", () => {
  it("splits number, direction, name, and type", () => {
    expect(streetParts("449 S Garland Ave")).toEqual({ number: "449", direction: "s", name: "garland", type: "ave" });
    expect(streetParts("1270 Nolan Richardson Drive")).toEqual({ number: "1270", direction: null, name: "nolan richardson", type: "dr" });
    expect(streetParts("1009 MUSEUM WAY")).toEqual({ number: "1009", direction: null, name: "museum", type: "way" });
  });
});

describe("streetDifference", () => {
  it("flags a different street type (Razorback Field: ST for Ave)", () => {
    expect(streetDifference("449 S Garland Ave", "449 GARLAND ST")).toBe('street type "ave" vs "st"');
  });

  it("flags opposite directions (the Arvest pattern)", () => {
    expect(streetDifference("3000 S 56th St", "3000 N 56TH ST")).toBe('direction "s" vs "n"');
  });

  it("flags a different street name", () => {
    expect(streetDifference("1240 Leroy Pond Dr", "1270 NOLAN RICHARDSON DR")).toMatch(/street name/);
  });

  it("ignores case, spelling of types, and a direction or type missing on one side", () => {
    expect(streetDifference("5079 W Northgate Rd", "5079 WEST NORTHGATE ROAD")).toBeNull();
    expect(streetDifference("2203 Promenade Blvd", "2203 S PROMENADE BLVD")).toBeNull();
    expect(streetDifference("100 N Main", "100 N MAIN ST")).toBeNull();
  });
});

describe("sameStreetAddress", () => {
  it("matches when only one side has a directional (Ozark Music Hall)", () => {
    expect(sameStreetAddress("3615 Steele Blvd", "3615 N Steele Blvd")).toBe(true);
  });

  it("never matches different directionals (the Arvest case)", () => {
    expect(sameStreetAddress("3000 N 56th St", "3000 S 56th St")).toBe(false);
  });

  it("needs the same house number and street name, and compatible types", () => {
    expect(sameStreetAddress("3615 Steele Blvd", "3617 N Steele Blvd")).toBe(false);
    expect(sameStreetAddress("3615 Steele Blvd", "3615 N Stone Blvd")).toBe(false);
    expect(sameStreetAddress("449 Garland Ave", "449 Garland St")).toBe(false);
    expect(sameStreetAddress("285 N. Stadium Drive", "285 N Stadium Dr")).toBe(true);
    expect(sameStreetAddress("Steele Blvd", "Steele Blvd")).toBe(false);
  });
});
