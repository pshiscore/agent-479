import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./columns";
import { runs } from "./runs";

/**
 * Event weather (owner, 2026-10-17): National Weather Service data, public
 * domain, fetched on a schedule (api.weather.gov, a narrow owner exception to
 * its robots.txt; AGENTS.md, Fetching). Like raw_records, these tables are
 * refreshed in bulk: writes are counted in runs.stats and each row carries the
 * run that wrote it, rather than being logged row by row (AGENTS.md, rule 2).
 */

/** One hour of an NWS hourly forecast, as we keep it. */
export interface WeatherHour {
  start: string; // ISO, UTC
  tempF: number;
  isDaytime: boolean;
  // The NWS condition code (e.g. "tsra_hi"), read from its icon address; we draw our own icons.
  code: string;
  shortForecast: string;
  popPct: number | null;
}

/** One forecast grid square's hourly forecast (about 7 days). */
export const weatherGrids = pgTable(
  "weather_grids",
  {
    id: id(),
    office: text("office").notNull(),
    gridX: integer("grid_x").notNull(),
    gridY: integer("grid_y").notNull(),
    hours: jsonb("hours").$type<WeatherHour[]>().notNull().default([]),
    // NWS's own update time for the forecast; stale after 6 hours (shown as nothing).
    nwsUpdatedAt: timestamp("nws_updated_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("weather_grids_square_uniq").on(t.office, t.gridX, t.gridY)],
).enableRLS();

/** Active NWS alerts for Arkansas, kept while NWS lists them. */
export const weatherAlerts = pgTable(
  "weather_alerts",
  {
    id: id(),
    nwsId: text("nws_id").notNull(),
    event: text("event").notNull(),
    severity: text("severity"),
    onsetAt: timestamp("onset_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    // The alert on weather.gov, for the badge's link (a link, never a fetch).
    link: text("link"),
    // The alert outline when NWS gives one (GeoJSON); otherwise match by zones.
    geometry: jsonb("geometry").$type<Record<string, unknown> | null>(),
    zones: text("zones").array().notNull().default(sql`'{}'::text[]`),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("weather_alerts_nws_id_uniq").on(t.nwsId), index("weather_alerts_last_seen_idx").on(t.lastSeenAt)],
).enableRLS();

/** A latest observation (or forecast-hour fallback) for the header widget. */
export interface CityReading {
  tempF: number;
  code: string;
  text: string;
  observedAt: string;
  source: "observation" | "forecast";
}

/**
 * The header widget's cities (owner: Bentonville, Rogers, Springdale,
 * Fayetteville, Bella Vista, Siloam Springs, Centerton, Lowell, Pea Ridge,
 * Farmington). Coordinates from the Census Gazetteer, cited.
 */
export const weatherCities = pgTable(
  "weather_cities",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    lat: numeric("lat", { precision: 9, scale: 6, mode: "number" }).notNull(),
    lng: numeric("lng", { precision: 9, scale: 6, mode: "number" }).notNull(),
    coordSource: jsonb("coord_source").$type<{ url: string; checkedAt: string; note?: string }>().notNull(),
    nwsOffice: text("nws_office"),
    nwsGridX: integer("nws_grid_x"),
    nwsGridY: integer("nws_grid_y"),
    stationId: text("station_id"),
    pointsCheckedAt: timestamp("points_checked_at", { withTimezone: true }),
    reading: jsonb("reading").$type<CityReading | null>(),
    readingFetchedAt: timestamp("reading_fetched_at", { withTimezone: true }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("weather_cities_slug_uniq").on(t.slug),
    check("weather_cities_slug_check", sql.raw(`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)),
    check("weather_cities_grid_check", sql.raw(`(nws_office is null) = (nws_grid_x is null) and (nws_office is null) = (nws_grid_y is null)`)),
  ],
).enableRLS();
