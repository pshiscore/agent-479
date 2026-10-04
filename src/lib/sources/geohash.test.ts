import { describe, expect, it } from "vitest";
import { geohash } from "./geohash";

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** Decodes a geohash to its bounding box, to check cells independently of the encoder. */
function bounds(hash: string) {
  const lat = [-90, 90];
  const lng = [-180, 180];
  let even = true;
  for (const c of hash) {
    const v = BASE32.indexOf(c);
    for (let bit = 4; bit >= 0; bit--) {
      const range = even ? lng : lat;
      const mid = (range[0] + range[1]) / 2;
      if ((v >> bit) & 1) range[0] = mid;
      else range[1] = mid;
      even = !even;
    }
  }
  return { lat, lng };
}

describe("geohash", () => {
  it("matches published reference values", () => {
    // The canonical example from the geohash spec.
    expect(geohash(57.64911, 10.40744, 11)).toBe("u4pruydqqvj");
    expect(geohash(0, 0, 5)).toBe("s0000");
  });

  it("encodes a cell that contains the point", () => {
    for (const [lat, lng] of [
      [36.19, -94.13], // Springdale
      [36.3727, -94.2088], // Bentonville Square
      [-33.8688, 151.2093],
    ]) {
      const b = bounds(geohash(lat, lng, 7));
      expect(lat).toBeGreaterThanOrEqual(b.lat[0]);
      expect(lat).toBeLessThan(b.lat[1]);
      expect(lng).toBeGreaterThanOrEqual(b.lng[0]);
      expect(lng).toBeLessThan(b.lng[1]);
    }
  });
});
