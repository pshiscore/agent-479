import { describe, expect, it } from "vitest";
import { robotsException } from "@/lib/http/robots-exceptions";
import { parsePoints, pointsUrl } from "./grid";

describe("NWS points", () => {
  it("reads the grid and zones", () => {
    const body = JSON.stringify({ properties: { gridId: "TSA", gridX: 68, gridY: 120, forecastZone: "https://api.weather.gov/zones/forecast/ARZ001", county: "https://api.weather.gov/zones/county/ARC007" } });
    expect(parsePoints(body)).toEqual({ office: "TSA", x: 68, y: 120, forecastZone: "ARZ001", countyZone: "ARC007" });
    expect(() => parsePoints("{}")).toThrow(/no forecast grid/);
  });

  it("asks with four decimals, inside the owner's exception", () => {
    const u = pointsUrl(36.372912, -94.208812);
    expect(u).toBe("https://api.weather.gov/points/36.3729,-94.2088");
    expect(robotsException(u)).not.toBeNull();
  });
});
