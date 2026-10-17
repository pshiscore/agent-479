/**
 * The venues map (Phase B; owner, 2026-10-17). Tiles are a regional extract of
 * the Protomaps basemap (OpenStreetMap data, a Produced Work under the ODbL),
 * self-hosted with its fonts and icons on our own R2 map bucket, so the map
 * makes no third-party requests. Attribution stays visible on the map, and
 * OpenStreetMap's copyright page says the data is available under the ODbL.
 */

/** Benton and Washington counties with a margin (venue pins are all inside). */
export const MAP_BOUNDS = { minLon: -94.7, minLat: 35.7, maxLon: -93.75, maxLat: 36.55 } as const;

export const MAP_ATTRIBUTION_HTML =
  '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Where the map files live: our R2 map bucket's own domain. Empty until it's set up; the map stays hidden until then. */
export const mapBaseUrl = () => (process.env.NEXT_PUBLIC_MAP_BASE_URL ?? "").replace(/\/+$/, "");

/** The tile file in the map bucket (a new extract gets a new name, so caches never serve a stale one). */
export const MAP_FILE = "nwa-20261016.pmtiles";
export const MAP_SPRITES = "sprites/v4";
