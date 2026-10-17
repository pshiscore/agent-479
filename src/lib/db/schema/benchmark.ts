import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, sqlList, updatedAt } from "./columns";
import { events } from "./events";
import { organizers } from "./organizers";
import { eventProposals } from "./review";

/**
 * The coverage benchmark (/admin/benchmark; owner, 2026-10-16). Each week the
 * owner types the names and dates of events from a roundup they read; each
 * line is matched against our events and the review queue. Only what the
 * owner types is stored, nothing else from the roundup.
 */

export const benchmarkWeeks = pgTable(
  "benchmark_weeks",
  {
    id: id(),
    // The Monday the week starts (America/Chicago calendar date).
    weekStart: date("week_start", { mode: "string" }).notNull(),
    // What the owner compared against, in their words (e.g. "Flyer weekend list").
    label: text("label"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("benchmark_weeks_week_label_uniq").on(t.weekStart, sql`coalesce(${t.label}, '')`),
    check("benchmark_weeks_monday_check", sql.raw(`extract(isodow from week_start) = 1`)),
  ],
).enableRLS();

/**
 * live: a published event. review: waiting in the review queue. shadow: a
 * shadow source has it ("would have caught"). missed: none of those.
 */
export const BENCHMARK_RESULTS = ["live", "review", "shadow", "missed"] as const;
export const MISS_REASONS = [
  // No source covers this organizer yet: creates a registry task.
  "no_source",
  // The organizer only posts on social media.
  "social_only",
  // A source covers it, but the event wasn't in its feed.
  "not_in_feed",
  "filtered",
  "rejected",
  // We have it, with a wrong date, time, or venue.
  "wrong_details",
  "other",
] as const;
export const TASK_STATUSES = ["open", "done", "dropped"] as const;

export const benchmarkItems = pgTable(
  "benchmark_items",
  {
    id: id(),
    weekId: uuid("week_id")
      .notNull()
      .references(() => benchmarkWeeks.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    // The date the owner typed; a multi-day event matches when it falls inside the event's range.
    eventDate: date("event_date", { mode: "string" }).notNull(),
    result: text("result", { enum: BENCHMARK_RESULTS }).notNull(),
    matchedEventId: uuid("matched_event_id").references(() => events.id, { onDelete: "restrict" }),
    matchedProposalId: uuid("matched_proposal_id").references(() => eventProposals.id, { onDelete: "restrict" }),
    matchedAt: timestamp("matched_at", { withTimezone: true }).notNull(),
    missReason: text("miss_reason", { enum: MISS_REASONS }),
    // The registry task a "no source" miss creates: find or add this organizer.
    taskStatus: text("task_status", { enum: TASK_STATUSES }),
    taskOrganizerId: uuid("task_organizer_id").references(() => organizers.id, { onDelete: "restrict" }),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("benchmark_items_week_idx").on(t.weekId),
    index("benchmark_items_open_task_idx").on(t.createdAt).where(sql`${t.taskStatus} = 'open'`),
    check("benchmark_items_result_check", sql.raw(`result in ${sqlList(BENCHMARK_RESULTS)}`)),
    check("benchmark_items_miss_reason_check", sql.raw(`miss_reason is null or (result = 'missed' and miss_reason in ${sqlList(MISS_REASONS)})`)),
    check("benchmark_items_task_status_check", sql.raw(`task_status is null or (miss_reason = 'no_source' and task_status in ${sqlList(TASK_STATUSES)})`)),
    // What a result points at: live an event, review and shadow a queue item, missed nothing.
    check(
      "benchmark_items_match_check",
      sql.raw(
        `case result when 'live' then matched_event_id is not null and matched_proposal_id is null ` +
          `when 'missed' then matched_event_id is null and matched_proposal_id is null ` +
          `else matched_proposal_id is not null and matched_event_id is null end`,
      ),
    ),
    check("benchmark_items_name_check", sql.raw(`length(trim(name)) between 2 and 300`)),
  ],
).enableRLS();
