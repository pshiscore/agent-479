import { describe, expect, it } from "vitest";
import { googleWidgetEnabled, isGooglePlaceId, mapsPlaceUrl } from "./places";

describe("Google places helpers", () => {
  it("accepts place IDs and rejects anything else", () => {
    expect(isGooglePlaceId("ChIJC8HakaIRkFQRiOgkgdHmqkk")).toBe(true);
    for (const bad of ["", "short", "ChIJ abc def ghi", "<script>alert(1)</script>", "x".repeat(301)]) expect(isGooglePlaceId(bad)).toBe(false);
  });

  it("is on only with the switch true (tolerating spaces, line breaks, case, quotes) and a key", () => {
    for (const v of ["true", "TRUE", " true\n", '"true"']) expect(googleWidgetEnabled({ GOOGLE_PLACES_WIDGET: v, NEXT_PUBLIC_GOOGLE_MAPS_KEY: "k" })).toBe(true);
    for (const v of ["false", "1", "yes", ""]) expect(googleWidgetEnabled({ GOOGLE_PLACES_WIDGET: v, NEXT_PUBLIC_GOOGLE_MAPS_KEY: "k" })).toBe(false);
    expect(googleWidgetEnabled({ GOOGLE_PLACES_WIDGET: "true" })).toBe(false);
    expect(googleWidgetEnabled({ NEXT_PUBLIC_GOOGLE_MAPS_KEY: "k" })).toBe(false);
  });

  it("builds Google's documented Maps link for one place", () => {
    expect(mapsPlaceUrl("Saltine, Fayetteville", "ChIJabc123def")).toBe("https://www.google.com/maps/search/?api=1&query=Saltine%2C%20Fayetteville&query_place_id=ChIJabc123def");
  });
});
