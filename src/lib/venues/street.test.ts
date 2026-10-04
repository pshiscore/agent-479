import { describe, expect, it } from "vitest";
import { streetDifference, streetParts } from "./street";

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
