import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, sqlList, updatedAt } from "./columns";
import { rawRecords } from "./raw-records";
import { sources } from "./sources";
import { categories, tags } from "./taxonomy";
import { venues } from "./venues";

export const EVENT_STATUSES = ["scheduled", "cancelled", "postponed", "merged", "hidden"] as const;

const money = (name: string) => numeric(name, { precision: 10, scale: 2, mode: "number" });

/**
 * What the site shows. Written by the pipeline only after a venue is resolved
 * and a category is chosen (build step 13), and every change is logged row by
 * row (AGENTS.md rule 2). Never deleted: hidden or merged instead.
 */
export const events = pgTable(
  "events",
  {
    id: id(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    // For the trigram index and dedup: lowercased, unaccented, punctuation-free.
    normalizedTitle: text("normalized_title").notNull(),
    // Our own words, generated from the facts (step 13). Never source text.
    shortDescription: text("short_description"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }),
    allDay: boolean("all_day").notNull().default(false),
    // The date is known but the time isn't (Ticketmaster "time TBA"): show no time.
    timeTba: boolean("time_tba").notNull().default(false),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "restrict" }),
    // A room or hall inside the venue, shown as "Baum Walker Hall, Walton Arts Center".
    subSpace: text("sub_space"),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    // FK to event_series is added when that table exists (build step 14).
    seriesId: uuid("series_id"),
    isFree: boolean("is_free"),
    priceMin: money("price_min"),
    priceMax: money("price_max"),
    priceText: text("price_text"),
    primarySourceUrl: text("primary_source_url"),
    ticketUrl: text("ticket_url"),
    status: text("status", { enum: EVENT_STATUSES }).notNull().default("scheduled"),
    canonicalEventId: uuid("canonical_event_id").references((): AnyPgColumn => events.id, { onDelete: "restrict" }),
    qualityScore: numeric("quality_score", { precision: 5, scale: 3, mode: "number" }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("events_slug_uniq").on(t.slug),
    index("events_scheduled_start_idx").on(t.startAt).where(sql`${t.status} = 'scheduled'`),
    index("events_venue_start_idx").on(t.venueId, t.startAt),
    index("events_category_start_idx").on(t.categoryId, t.startAt),
    index("events_series_start_idx").on(t.seriesId, t.startAt),
    index("events_title_trgm_idx").using("gin", t.normalizedTitle.op("extensions.gin_trgm_ops")),
    check("events_status_check", sql.raw(`status in ${sqlList(EVENT_STATUSES)}`)),
    check("events_slug_check", sql.raw(`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)),
    check("events_end_check", sql.raw(`end_at is null or end_at >= start_at`)),
    check(
      "events_price_check",
      sql.raw(`(price_min is null or price_min >= 0) and (price_max is null or price_min is null or price_max >= price_min)`),
    ),
    // A merged event points at its survivor; nothing else does.
    check(
      "events_merged_check",
      sql.raw(`(status = 'merged') = (canonical_event_id is not null)`),
    ),
    check("events_canonical_check", sql.raw(`canonical_event_id is null or canonical_event_id <> id`)),
  ],
).enableRLS();

/** Every source record behind an event: one row per (source, external id). */
export const eventSources = pgTable(
  "event_sources",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    rawRecordId: uuid("raw_record_id").references(() => rawRecords.id, { onDelete: "set null" }),
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url"),
    ticketUrl: text("ticket_url"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("event_sources_source_external_uniq").on(t.sourceId, t.externalId),
    index("event_sources_event_idx").on(t.eventId),
    // At most one primary source per event.
    uniqueIndex("event_sources_primary_uniq").on(t.eventId).where(sql`${t.isPrimary}`),
  ],
).enableRLS();

export const eventTags = pgTable(
  "event_tags",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.tagId] }), index("event_tags_tag_idx").on(t.tagId)],
).enableRLS();
