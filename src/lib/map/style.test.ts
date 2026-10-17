import { layers, namedFlavor } from "@protomaps/basemaps";
import { describe, expect, it } from "vitest";
import { MAP_ATTRIBUTION_HTML } from "@/config/map";
import { mapStyle } from "./style";

const BASE = "https://map.479.guide";

describe("map style", () => {
  for (const flavor of ["light", "dark"] as const) {
    it(`${flavor}: loads every file from our own map bucket, nothing third-party`, () => {
      const style = mapStyle(BASE, flavor, layers("protomaps", namedFlavor(flavor), { lang: "en" }));
      const { sources, ...rest } = style;
      const { attribution, ...source } = sources.protomaps as Record<string, unknown>;
      const urls = JSON.stringify({ ...rest, source }).match(/[a-z]+:\/\/[^"]+/g) ?? [];
      expect(urls.length).toBeGreaterThan(0);
      for (const u of urls) expect(u.replace(/^pmtiles:\/\//, "").startsWith(`${BASE}/`), u).toBe(true);
      expect(attribution).toBe(MAP_ATTRIBUTION_HTML);
    });
  }

  it("credits OpenStreetMap and links its copyright page (ODbL notice)", () => {
    expect(MAP_ATTRIBUTION_HTML).toContain("© <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>");
  });
});
