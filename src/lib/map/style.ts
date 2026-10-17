import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { MAP_ATTRIBUTION_HTML, MAP_FILE, MAP_SPRITES } from "@/config/map";

/**
 * The venues map's style (Phase B): every file it loads (tiles, fonts,
 * sprites) comes from `base`, our own map bucket. Basemap layers come from
 * @protomaps/basemaps (CC0 styling); the attribution names OpenStreetMap and
 * links its copyright page, which says the data is available under the ODbL.
 */
export function mapStyle(base: string, flavor: "light" | "dark", layers: LayerSpecification[]): StyleSpecification {
  return {
    version: 8,
    glyphs: `${base}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${base}/${MAP_SPRITES}/${flavor}`,
    sources: { protomaps: { type: "vector", url: `pmtiles://${base}/${MAP_FILE}`, attribution: MAP_ATTRIBUTION_HTML } },
    layers,
  };
}
