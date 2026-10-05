import { sql } from "drizzle-orm";
import { boolean, check, date, doublePrecision, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, sqlList, updatedAt } from "./columns";
import { venues } from "./venues";

/**
 * New in Town (docs/product/front-page.md, section H): places that just
 * opened or are about to. Separate from venues (where events happen), linked
 * when the owner confirms a match. Every add, edit, publish, and hide is
 * logged. Public only while status is opening_soon or open.
 */

export const PLACE_TYPES = ["restaurant", "cafe", "coffee_shop", "bakery", "bakery_cafe", "bar", "brewery", "food_truck"] as const;
export const PLACE_CATEGORIES = ["restaurants", "shops", "venues", "outdoors"] as const;
export const PLACE_KINDS = ["new", "new_location", "moved", "reopened"] as const;
export const PLACE_STATUSES = ["draft", "opening_soon", "open", "hidden"] as const;
export const ADDRESS_KINDS = ["street", "intersection", "home_base"] as const;
export const DATE_PRECISIONS = ["day", "month"] as const;

/** Where a fact came from, like venue provenance: the owner's browser check is "verifiedBy: owner". */
export interface PlaceSource {
  url: string;
  checkedAt?: string; // YYYY-MM-DD
  verifiedBy?: "owner";
  confirmed?: string; // what the owner saw
  facts?: string[]; // other facts this source states, in the owner's words (for the description)
  note?: string;
}

export const places = pgTable(
  "places",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    placeType: text("place_type", { enum: PLACE_TYPES }).notNull(),
    category: text("category", { enum: PLACE_CATEGORIES }).notNull(),
    kind: text("kind", { enum: PLACE_KINDS }).notNull(),
    status: text("status", { enum: PLACE_STATUSES }).notNull().default("draft"),
    // A street address, an intersection, or a food truck's stated home base.
    address: text("address").notNull(),
    addressKind: text("address_kind", { enum: ADDRESS_KINDS }).notNull().default("street"),
    streetNumberUnconfirmed: boolean("street_number_unconfirmed").notNull().default(false),
    city: text("city").notNull(),
    postalCode: text("postal_code"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    // The opening date as the source states it: a day or a month, plus its own qualifier ("soft opening").
    openedOn: date("opened_on"),
    openedPrecision: text("opened_precision", { enum: DATE_PRECISIONS }),
    openedQualifier: text("opened_qualifier"),
    // "Opening soon": the stated target date or month.
    targetOn: date("target_on"),
    targetPrecision: text("target_precision", { enum: DATE_PRECISIONS }),
    targetQualifier: text("target_qualifier"),
    website: text("website"),
    // Null until confirmed; publishing requires true.
    openToPublic: boolean("open_to_public"),
    venueId: uuid("venue_id").references(() => venues.id, { onDelete: "restrict" }),
    description: text("description"),
    descriptionGeneratedAt: timestamp("description_generated_at", { withTimezone: true }),
    sources: jsonb("sources").$type<PlaceSource[]>().notNull().default([]),
    notes: text("notes"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenReason: text("hidden_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("places_slug_uniq").on(t.slug),
    index("places_public_idx").on(t.category, t.openedOn).where(sql`${t.status} in ('opening_soon', 'open')`),
    check("places_slug_check", sql.raw(`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)),
    check("places_type_check", sql.raw(`place_type in ${sqlList(PLACE_TYPES)}`)),
    check("places_category_check", sql.raw(`category in ${sqlList(PLACE_CATEGORIES)}`)),
    check("places_kind_check", sql.raw(`kind in ${sqlList(PLACE_KINDS)}`)),
    check("places_status_check", sql.raw(`status in ${sqlList(PLACE_STATUSES)}`)),
    check("places_address_kind_check", sql.raw(`address_kind in ${sqlList(ADDRESS_KINDS)}`)),
    // A date and its precision come together (NULL-safe: coalesce).
    check("places_opened_check", sql.raw(`(opened_on is null) = (opened_precision is null) and coalesce(opened_precision in ${sqlList(DATE_PRECISIONS)}, true)`)),
    check("places_target_check", sql.raw(`(target_on is null) = (target_precision is null) and coalesce(target_precision in ${sqlList(DATE_PRECISIONS)}, true)`)),
    // Food trucks are listed only with a stated home base; nothing else uses one.
    check("places_food_truck_check", sql.raw(`(place_type = 'food_truck') = (address_kind = 'home_base')`)),
    // "Now open" needs a stated opening date; "opening soon" a stated target.
    check("places_open_check", sql.raw(`status <> 'open' or opened_on is not null`)),
    check("places_soon_check", sql.raw(`status <> 'opening_soon' or target_on is not null`)),
    // Public places: open to the public, published, with at least one source.
    check(
      "places_public_check",
      sql.raw(`status not in ('open', 'opening_soon') or (coalesce(open_to_public, false) and published_at is not null and jsonb_array_length(sources) > 0)`),
    ),
    check("places_hidden_check", sql.raw(`(status = 'hidden') = (hidden_at is not null)`)),
    check("places_description_check", sql.raw(`(description is null) = (description_generated_at is null)`)),
    check("places_lat_check", sql.raw(`lat is null or (lat between -90 and 90 and lng between -180 and 180)`)),
  ],
).enableRLS();
