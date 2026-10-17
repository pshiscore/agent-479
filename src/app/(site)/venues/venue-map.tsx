"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { ExpressionSpecification, GeoJSONSource, MapLayerMouseEvent, Map as MlMap, StyleSpecification } from "maplibre-gl";
import { useEffect, useImperativeHandle, useRef } from "react";
import { MAP_BOUNDS } from "@/config/map";
import { mapStyle } from "@/lib/map/style";
import { VENUE_GROUPS } from "@/config/venue-groups";

/**
 * The venues map (Phase B). Loaded only on /venues, and only when it's on
 * screen (venue-map-shell.tsx). Everything comes from our own map bucket: the
 * tile extract, fonts, and sprites. Pins are our signed-off coordinates.
 */

export interface Pin {
  slug: string;
  name: string;
  group: string;
  lat: number;
  lng: number;
}

export interface VenueMapHandle {
  focus(slug: string): void;
}

const flavorNow = (): "light" | "dark" => {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "light" || t === "dark") return t;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function VenueMap({ pins, base, onSelect, ref }: { pins: Pin[]; base: string; onSelect: (slug: string) => void; ref?: React.Ref<VenueMapHandle> }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const pinsRef = useRef(pins);
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);

  useImperativeHandle(ref, () => ({
    focus(slug) {
      const p = pinsRef.current.find((x) => x.slug === slug);
      const m = map.current;
      if (!p || !m) return;
      const opts = { center: [p.lng, p.lat] as [number, number], zoom: Math.max(m.getZoom(), 14) };
      if (reduced()) m.jumpTo(opts);
      else m.flyTo({ ...opts, speed: 1.6 });
    },
  }));

  // Pins follow the filters.
  useEffect(() => {
    pinsRef.current = pins;
    (map.current?.getSource("venues") as GeoJSONSource | undefined)?.setData(geojson(pins));
  }, [pins]);

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    (async () => {
      const [maplibregl, { Protocol }, basemaps] = await Promise.all([import("maplibre-gl"), import("pmtiles"), import("@protomaps/basemaps")]);
      if (cancelled || !box.current) return;
      // The worker comes from our own domain (scripts/copy-maplibre-worker.mjs).
      maplibregl.setWorkerUrl(`/maplibre/${maplibregl.getVersion()}/maplibre-gl-worker.mjs`);
      const protocol = new Protocol();
      maplibregl.addProtocol("pmtiles", protocol.tile);
      const style = (flavor: "light" | "dark"): StyleSpecification => mapStyle(base, flavor, basemaps.layers("protomaps", basemaps.namedFlavor(flavor), { lang: "en" }));
      const m = new maplibregl.Map({
        container: box.current,
        style: style(flavorNow()),
        // Opens framed on the pins; never pans past the extract (no blank, tile-less edges).
        bounds: pinBounds(pinsRef.current),
        fitBoundsOptions: { padding: 40 },
        maxBounds: [
          [MAP_BOUNDS.minLon, MAP_BOUNDS.minLat],
          [MAP_BOUNDS.maxLon, MAP_BOUNDS.maxLat],
        ],
        maxZoom: 18,
        // Always visible, never collapsed (OpenStreetMap's attribution guidelines).
        attributionControl: { compact: false },
        // Phones: one finger scrolls the page; two move the map.
        cooperativeGestures: window.matchMedia("(pointer: coarse)").matches,
      });
      map.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      const addVenues = () => {
        if (m.getSource("venues")) return;
        m.addSource("venues", { type: "geojson", data: geojson(pinsRef.current), cluster: true, clusterRadius: 40, clusterMaxZoom: 13 });
        m.addLayer({ id: "venue-clusters", type: "circle", source: "venues", filter: ["has", "point_count"], paint: { "circle-color": "#3d2b1f", "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 25, 22], "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" } });
        m.addLayer({ id: "venue-cluster-count", type: "symbol", source: "venues", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Medium"], "text-size": 13 }, paint: { "text-color": "#ffffff" } });
        m.addLayer({
          id: "venue-pins",
          type: "circle",
          source: "venues",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": PIN_COLOR,
            "circle-radius": 8,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
      };
      m.on("style.load", addVenues);
      m.on("click", "venue-pins", (e: MapLayerMouseEvent) => {
        const slug = e.features?.[0]?.properties?.slug;
        if (typeof slug === "string") select.current(slug);
      });
      m.on("click", "venue-clusters", async (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        const zoom = await (m.getSource("venues") as GeoJSONSource).getClusterExpansionZoom(f.properties?.cluster_id);
        const center = (f.geometry as GeoJSON.Point).coordinates as [number, number];
        if (reduced()) m.jumpTo({ center, zoom });
        else m.easeTo({ center, zoom });
      });
      for (const layer of ["venue-pins", "venue-clusters"]) {
        m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
      }

      // Follow the site's theme switch and the system setting.
      let flavor = flavorNow();
      const restyle = () => {
        const next = flavorNow();
        if (next === flavor) return;
        flavor = next;
        m.setStyle(style(next));
      };
      const observer = new MutationObserver(restyle);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", restyle);

      cleanup = () => {
        observer.disconnect();
        media.removeEventListener("change", restyle);
        m.remove();
        maplibregl.removeProtocol("pmtiles");
        map.current = null;
      };
    })();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [base]);

  return <div ref={box} role="region" aria-label="Map of the venues listed. Every venue is also in the list." className="h-full w-full" />;
}

// Pin color by type group: ["match", ["get", "group"], slug1, color1, ..., fallback].
const PIN_COLOR = ["match", ["get", "group"], ...VENUE_GROUPS.flatMap((g) => [g.slug, g.color]), "#6B6B6B"] as unknown as ExpressionSpecification;

/** The pins' extent, or the whole area when there are none. */
function pinBounds(pins: Pin[]): [[number, number], [number, number]] {
  if (pins.length === 0) return [[MAP_BOUNDS.minLon, MAP_BOUNDS.minLat], [MAP_BOUNDS.maxLon, MAP_BOUNDS.maxLat]];
  const lons = pins.map((p) => p.lng);
  const lats = pins.map((p) => p.lat);
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
}

function geojson(pins: Pin[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: pins.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: { slug: p.slug, name: p.name, group: p.group } })),
  };
}
