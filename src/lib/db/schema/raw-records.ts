import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, sqlList } from "./columns";
import { runs } from "./runs";
import { events } from "./events";
import { sources } from "./sources";
import { venues } from "./venues";

export const RAW_RECORD_STATUSES = ["pending", "mapped", "extracted", "needs_venue", "skipped", "failed"] as const;

/**
 * What the fetch layer writes, and the only thing it writes: one row per item
 * a source publishes (an ICS VEVENT, an API event). Payloads are facts only
 * (each fetcher whitelists fields) and are purged after 30 days.
 */
export const rawRecords = pgTable(
  "raw_records",
  {
    id: id(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    // The run that last wrote this row's payload, so a bad run can be traced
    // and purged as a batch. Runs are never deleted.
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "restrict" }),
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url"),
    // sha256 of the canonical payload: unchanged items aren't reprocessed.
    contentHash: text("content_hash").notNull(),
    // Null once purged.
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    // The source's own description: internal staging for extraction only.
    // Never displayed or published (AGENTS.md rule 4), and set to null by the
    // maintenance job once description_purge_after passes.
    descriptionText: text("description_text"),
    // 30 days after the event ends. Null for an open-ended series: then it's
    // 30 days after the item was last seen in the feed.
    descriptionPurgeAfter: timestamp("description_purge_after", { withTimezone: true }),
    // Last time a fetch saw this item.
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status", { enum: RAW_RECORD_STATUSES }).notNull().default("pending"),
    skipReason: text("skip_reason"),
    locationKey: text("location_key"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    eventId: uuid("event_id").references((): AnyPgColumn => events.id, { onDelete: "set null" }),
    // Set by the process stage (build step 12): the facts the mapper produced,
    // validated, with times in UTC; and the venue the resolver chose.
    facts: jsonb("facts").$type<Record<string, unknown>>(),
    venueId: uuid("venue_id").references((): AnyPgColumn => venues.id, { onDelete: "set null" }),
    subSpace: text("sub_space"),
    // How the venue was found (external_id, default_venue, alias, address, trigram, llm).
    venueMatchedBy: text("venue_matched_by"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    // When a vague needs_venue location (a bare city or ZIP, or prose) was last
    // looked up on the event's own detail page; re-checked weekly at most.
    locationCheckedAt: timestamp("location_checked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("raw_records_source_external_uniq").on(t.sourceId, t.externalId),
    index("raw_records_status_fetched_idx").on(t.status, t.fetchedAt),
    index("raw_records_needs_venue_idx").on(t.locationKey).where(sql`${t.status} = 'needs_venue'`),
    check("raw_records_status_check", sql.raw(`status in ${sqlList(RAW_RECORD_STATUSES)}`)),
    check("raw_records_skip_check", sql.raw(`status <> 'skipped' or skip_reason is not null`)),
    check("raw_records_attempts_check", sql.raw(`attempts >= 0`)),
    check("raw_records_needs_venue_check", sql.raw(`status <> 'needs_venue' or location_key is not null`)),
    check("raw_records_mapped_check", sql.raw(`status not in ('mapped', 'extracted') or (facts is not null and venue_id is not null)`)),
    index("raw_records_description_purge_idx")
      .on(t.descriptionPurgeAfter)
      .where(sql`${t.descriptionText} is not null`),
  ],
).enableRLS();
