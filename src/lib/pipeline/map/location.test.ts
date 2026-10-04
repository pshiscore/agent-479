import { describe, expect, it } from "vitest";
import { locationKey, parseLocation } from "./location";

describe("parseLocation", () => {
  it("reads CivicPlus 'Name - street  City AR zip', stripping HTML", () => {
    expect(parseLocation("<p>Rogers Historical Museum</p> - 313 S 2nd St  Rogers AR 72756")).toEqual({
      text: "Rogers Historical Museum - 313 S 2nd St Rogers AR 72756",
      name: "Rogers Historical Museum",
      room: null,
      street: "313 S 2nd St",
      city: "Rogers",
    });
    expect(parseLocation("Upper Ramble - 251 N West Ave  Fayetteville AR 72701")).toMatchObject({
      name: "Upper Ramble",
      street: "251 N West Ave",
      city: "Fayetteville",
    });
  });

  it("reads Communico rooms as a room, not an address", () => {
    expect(parseLocation("Fayetteville Public Library - Walmart Story Time Room (1st Floor)")).toMatchObject({
      name: "Fayetteville Public Library",
      room: "Walmart Story Time Room (1st Floor)",
      street: null,
    });
    expect(parseLocation("FPL on Wheels Bookmobile -")).toMatchObject({ name: "FPL on Wheels Bookmobile", room: null });
  });

  it("handles a location with only a city", () => {
    expect(parseLocation("-   Bentonville AR 72712")).toMatchObject({ name: null, street: null, city: "Bentonville" });
    expect(parseLocation(null)).toEqual({ text: null, name: null, room: null, street: null, city: null });
  });
});

describe("locationKey", () => {
  it("groups by name and street, and never proposes a bare city", () => {
    expect(locationKey(parseLocation("Upper Ramble - 251 N West Ave  Fayetteville AR 72701"))).toBe(
      "upper ramble | 251 n west ave | fayetteville",
    );
    expect(locationKey(parseLocation("-   Bentonville AR 72712"))).toBe("nolocation:bentonville");
    expect(locationKey(parseLocation(null))).toBe("nolocation:unknown");
  });
});
