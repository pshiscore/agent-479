import { describe, expect, it } from "vitest";
import { PoliteClient } from "@/lib/sources/http";
import { robotsException } from "./robots-exceptions";

describe("owner robots.txt exceptions", () => {
  it("cover exactly the NWS endpoints the owner named", () => {
    for (const u of [
      "https://api.weather.gov/points/36.3729,-94.2088",
      "https://api.weather.gov/gridpoints/TSA/68,120/forecast/hourly",
      "https://api.weather.gov/stations/KXNA/observations/latest",
      "https://api.weather.gov/alerts/active?area=AR",
    ])
      expect(robotsException(u), u).not.toBeNull();
    for (const u of [
      "https://api.weather.gov/",
      "https://api.weather.gov/gridpoints/TSA/68,120/forecast",
      "https://api.weather.gov/gridpoints/TSA/68,120/stations",
      "https://api.weather.gov/alerts/active?area=OK",
      "https://api.weather.gov/alerts/active",
      "https://api.weather.gov/points/36.37291234,-94.2088",
      "https://other.example/points/36.3,-94.2",
    ])
      expect(robotsException(u), u).toBeNull();
  });

  it("let PoliteClient through a Disallow: / only on those endpoints", async () => {
    const calls: string[] = [];
    const fetch = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /\n");
      return new Response("{}", { headers: { "content-type": "application/geo+json" } });
    }) as typeof globalThis.fetch;
    const http = new PoliteClient({ fetch, userAgent: "Agent479Bot/test", minGapMs: 0, sleep: async () => {} });
    await expect(http.get("https://api.weather.gov/points/36.3729,-94.2088")).resolves.toMatchObject({ status: 200 });
    await expect(http.get("https://api.weather.gov/gridpoints/TSA/68,120/forecast")).rejects.toThrow(/robots.txt disallows/);
    expect(await http.allows("https://api.weather.gov/alerts/active?area=AR")).toBe(true);
    expect(await http.allows("https://api.weather.gov/zones/forecast/ARZ001")).toBe(false);
    expect(calls.filter((c) => c.endsWith("/robots.txt"))).toHaveLength(1);
  });
});
