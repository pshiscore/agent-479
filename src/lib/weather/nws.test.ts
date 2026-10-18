import { describe, expect, it } from "vitest";
import { robotsException } from "@/lib/http/robots-exceptions";
import { ALERTS_URL, conditionCode, hourlyUrl, parseAlerts, parseHourly } from "./nws";

// Shapes follow the NWS API; values are written for the test.
const hour = (start: string, over: Record<string, unknown> = {}) => ({
  startTime: start,
  isDaytime: true,
  temperature: 72,
  temperatureUnit: "F",
  probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: 20 },
  icon: "https://api.weather.gov/icons/land/day/sct?size=small",
  shortForecast: "Partly Sunny",
  ...over,
});

describe("NWS readers", () => {
  it("reads the primary condition code from an icon address", () => {
    expect(conditionCode("https://api.weather.gov/icons/land/day/tsra_hi,40/rain,30?size=small")).toBe("tsra_hi");
    expect(conditionCode("https://api.weather.gov/icons/land/night/skc?size=small")).toBe("skc");
    expect(conditionCode(null)).toBe("unknown");
  });

  it("keeps hours from the cut-off on, facts only, in UTC", () => {
    const body = JSON.stringify({
      properties: {
        updateTime: "2026-10-17T20:30:00+00:00",
        periods: [hour("2026-10-17T14:00:00-05:00"), hour("2026-10-17T16:00:00-05:00"), hour("2026-10-17T17:00:00-05:00", { isDaytime: false, temperature: 20, temperatureUnit: "C", probabilityOfPrecipitation: { value: null }, icon: "https://api.weather.gov/icons/land/night/rain,60?size=small" })],
      },
    });
    const r = parseHourly(body, new Date("2026-10-17T20:00:00Z"));
    expect(r.updatedAt).toEqual(new Date("2026-10-17T20:30:00Z"));
    expect(r.hours).toEqual([
      { start: "2026-10-17T21:00:00.000Z", tempF: 72, isDaytime: true, code: "sct", shortForecast: "Partly Sunny", popPct: 20 },
      { start: "2026-10-17T22:00:00.000Z", tempF: 68, isDaytime: false, code: "rain", shortForecast: "Partly Sunny", popPct: null },
    ]);
    expect(() => parseHourly("{}", new Date())).toThrow(/no periods/);
  });

  it("reads alerts with an outline, or only zones (as most NWS alerts come)", () => {
    const body = JSON.stringify({
      features: [
        { geometry: null, properties: { id: "urn:test:1", event: "Frost Advisory", severity: "Minor", onset: "2026-10-18T04:00:00-05:00", ends: null, expires: "2026-10-18T08:00:00-05:00", geocode: { UGC: ["ARZ001", "ARZ010"] }, affectedZones: ["https://api.weather.gov/zones/forecast/ARZ001"] } },
        { geometry: { type: "Polygon", coordinates: [] }, properties: { id: "urn:test:2", event: "Severe Thunderstorm Warning", severity: "Severe", effective: "2026-10-18T18:00:00-05:00", ends: "2026-10-18T19:00:00-05:00", geocode: { UGC: ["ARC007"] } } },
        { properties: { event: "No id" } },
      ],
    });
    const a = parseAlerts(body);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ nwsId: "urn:test:1", zones: ["ARZ001", "ARZ010"], geometry: null, endsAt: new Date("2026-10-18T13:00:00Z") });
    expect(a[1]).toMatchObject({ event: "Severe Thunderstorm Warning", zones: ["ARC007"], onsetAt: new Date("2026-10-18T23:00:00Z") });
  });

  it("only asks for endpoints inside the owner's exception", () => {
    expect(robotsException(hourlyUrl("TSA", 68, 120))).not.toBeNull();
    expect(robotsException(ALERTS_URL)).not.toBeNull();
  });
});
