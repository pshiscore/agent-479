import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, sqlList, updatedAt } from "./columns";
import { sources } from "./sources";

export const VENUE_TYPES = [
  "arena",
  "theater",
  "museum",
  "music_venue",
  "bar",
  "park",
  "library",
  "plaza",
  "campus",
  "area",
  // Halls, centers, and rooms booked for events (owner, 2026-10-17; shown as "Event Spaces").
  "event_space",
  // Market halls and shopping centers that hold public events (shown under "Districts & Markets").
  "market",
  "other",
] as const;

/** Where a field's value was checked: a page we read, and when. */
export interface FieldProvenance {
  // Absent only for owner-verified values given without a page.
  url?: string;
  // ISO date (YYYY-MM-DD) the value was confirmed at url.
  checkedAt: string;
  note?: string;
  // Set when the owner checked it in their browser because a tool couldn't.
  verifiedBy?: "owner";
  confirmed?: string;
}

/** Per-field provenance, plus who signed off on the seed file it came from. */
export interface VenueVerification {
  name?: FieldProvenance;
  address?: FieldProvenance;
  formerAddresses?: FieldProvenance;
  postalCode?: FieldProvenance;
  location?: FieldProvenance;
  website?: FieldProvenance;
  notes?: FieldProvenance[];
  reviewed?: { by: string; at: string; sha256: string };
}

const coord = (name: string) => numeric(name, { precision: 9, scale: 6, mode: "number" });

/**
 * Physical places events happen at. An `area` (e.g. Downtown Bentonville
 * Square, Dickson Street) has a center point and an optional address.
 */
export const venues = pgTable(
  "venues",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    address: text("address"),
    // Earlier street addresses other sources may still use (e.g. Bud Walton's
    // pre-2021 street name). Sourced like any other field; used for matching only.
    formerAddresses: text("former_addresses").array().notNull().default(sql`'{}'::text[]`),
    city: text("city").notNull(),
    state: text("state").notNull().default("AR"),
    postalCode: text("postal_code"),
    // For an area, the center point.
    lat: coord("lat").notNull(),
    lng: coord("lng").notNull(),
    website: text("website"),
    venueType: text("venue_type", { enum: VENUE_TYPES }).notNull(),
    parentVenueId: uuid("parent_venue_id").references((): AnyPgColumn => venues.id, {
      onDelete: "restrict",
    }),
    active: boolean("active").notNull().default(true),
    // Outdoor despite its type (an amphitheater, a ballpark); parks, areas, and plazas are
    // outdoor by type (src/lib/weather/outdoor.ts). From the venue seed, with the owner's sign-off.
    outdoor: boolean("outdoor").notNull().default(false),
    // The National Weather Service forecast grid and zones for our coordinates, from
    // /points (refreshed monthly; NWS can move them). Venue data, so changes are logged.
    nwsOffice: text("nws_office"),
    nwsGridX: integer("nws_grid_x"),
    nwsGridY: integer("nws_grid_y"),
    nwsForecastZone: text("nws_forecast_zone"),
    nwsCountyZone: text("nws_county_zone"),
    nwsPointsCheckedAt: timestamp("nws_points_checked_at", { withTimezone: true }),
    verification: jsonb("verification").$type<VenueVerification>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("venues_slug_uniq").on(t.slug),
    index("venues_aliases_gin_idx").using("gin", t.aliases),
    // pg_trgm lives in the extensions schema (Supabase convention).
    index("venues_name_trgm_idx").using("gin", t.name.op("extensions.gin_trgm_ops")),
    index("venues_parent_idx").on(t.parentVenueId),
    check("venues_type_check", sql.raw(`venue_type in ${sqlList(VENUE_TYPES)}`)),
    check("venues_address_check", sql.raw(`venue_type = 'area' or address is not null`)),
    check("venues_lat_check", sql.raw(`lat between -90 and 90`)),
    check("venues_lng_check", sql.raw(`lng between -180 and 180`)),
    check("venues_state_check", sql.raw(`state ~ '^[A-Z]{2}$'`)),
    check("venues_slug_check", sql.raw(`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)),
    check("venues_parent_check", sql.raw(`parent_venue_id is null or parent_venue_id <> id`)),
    // A grid is all three parts or none.
    check("venues_nws_grid_check", sql.raw(`(nws_office is null) = (nws_grid_x is null) and (nws_office is null) = (nws_grid_y is null)`)),
  ],
).enableRLS();

/** A source's own ID for a venue (e.g. a Ticketmaster venue ID). */
export const venueExternalIds = pgTable(
  "venue_external_ids",
  {
    id: id(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references((): AnyPgColumn => sources.id, { onDelete: "restrict" }),
    externalId: text("external_id").notNull(),
    // The room or hall inside the venue this external record names, e.g.
    // "Baum Walker Hall" for Ticketmaster's "Walton Arts Center - Baum Walker
    // Hall". Copied onto events and shown as "Baum Walker Hall, Walton Arts Center".
    subSpace: text("sub_space"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("venue_external_ids_source_external_uniq").on(t.sourceId, t.externalId),
    index("venue_external_ids_venue_idx").on(t.venueId),
  ],
).enableRLS();
