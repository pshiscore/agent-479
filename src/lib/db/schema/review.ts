import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, sqlList, updatedAt } from "./columns";
import { events } from "./events";
import { rawRecords } from "./raw-records";
import { sources } from "./sources";
import { runs } from "./runs";

/**
 * The review queue (/admin/review; AGENTS.md, "Festivals and the review
 * queue"): proposed events that wait for the owner. Fail closed: nothing here
 * is public until the owner approves it, which writes the event. Every
 * create and decision is also logged through recordAction.
 */

export const PROPOSAL_STATUSES = ["pending", "approved", "rejected", "merged"] as const;
export const PROPOSAL_ORIGINS = ["owner_form", "registry", "calendar", "lead", "shadow"] as const;
// Why an item is in review (plan section 5, owner decisions 2026-10-05).
export const REVIEW_REASONS = [
  "owner_draft",
  "new_festival",
  "lead_only",
  "aggregator_only",
  "sources_conflict",
  "venue_unresolved",
  "unclear_schedule",
  "first_time_organizer",
  "outside_coverage_area",
  // From a source in shadow mode (owner, 2026-10-16).
  "shadow_source",
] as const;

/** Shadow items that need a look one by one; everything else is reviewed by source. */
export const SHADOW_FLAGS = ["conflict", "outside_coverage", "community_fallback", "description_held"] as const;
/** Why the owner rejected an item; wrong dates or venues block a source's promotion. */
export const REJECT_KINDS = ["wrong_date", "wrong_venue", "not_public", "duplicate", "filtered", "outside_area", "other"] as const;

/** The proposed event, as the owner (or later, the agent) states it. Times are UTC ISO strings. */
export interface ProposedEvent {
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  venueId: string | null;
  subSpace: string | null;
  categoryId: string | null;
  isFree: boolean | null;
  priceMin: number | null;
  priceMax: number | null;
  ageMin: number | null;
  ageMax: number | null;
  registrationRequired: boolean | null;
  inSpanish: boolean;
  // Tags the owner picks (Family-friendly, Outdoor, ...). Code-owned tags come from the facts.
  tagSlugs: string[];
  ticketUrl: string | null;
  // Where readers go for details: the official page.
  moreInfoUrl: string;
  // Per-day hours when the page states them (Chicago wall times, "HH:MM").
  dailyHours: DailyHours[];
  // The festival this is part of (festivals 2b).
  parentEventId?: string | null;
}

export interface DailyHours {
  day: string; // YYYY-MM-DD
  opens: string | null;
  closes: string | null;
}

/** A source behind a proposal: fetched by the agent (fetchedAt), or checked by the owner in the browser (verifiedBy). */
export interface ProposalSource {
  url: string;
  fetchedAt?: string;
  checkedAt?: string;
  verifiedBy?: "owner";
  confirmed?: string;
  sourceId?: string;
  note?: string;
}

export const eventProposals = pgTable(
  "event_proposals",
  {
    id: id(),
    status: text("status", { enum: PROPOSAL_STATUSES }).notNull().default("pending"),
    origin: text("origin", { enum: PROPOSAL_ORIGINS }).notNull(),
    reasons: text("reasons").array().notNull().default(sql`'{}'::text[]`),
    facts: jsonb("facts").$type<ProposedEvent>().notNull(),
    // Shadow items: the source record they came from, and the processed event
    // (venue, category, tags, description) that approval publishes unchanged.
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "restrict" }),
    rawRecordId: uuid("raw_record_id").references(() => rawRecords.id, { onDelete: "set null" }),
    externalId: text("external_id"),
    draft: jsonb("draft").$type<Record<string, unknown>>(),
    flags: text("flags").array().notNull().default(sql`'{}'::text[]`),
    rejectKind: text("reject_kind", { enum: REJECT_KINDS }),
    sources: jsonb("sources").$type<ProposalSource[]>().notNull().default([]),
    // A likely existing event, for the diff (set when the proposal is made).
    matchEventId: uuid("match_event_id").references(() => events.id, { onDelete: "set null" }),
    // The event this became (approved) or was merged into (merged).
    eventId: uuid("event_id").references(() => events.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by"),
    decisionNote: text("decision_note"),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("event_proposals_pending_idx").on(t.createdAt).where(sql`${t.status} = 'pending'`),
    // One item per source record: refetches update it instead of adding another.
    uniqueIndex("event_proposals_source_record_uniq").on(t.sourceId, t.externalId).where(sql`${t.sourceId} is not null`),
    check("event_proposals_shadow_check", sql.raw(`(origin = 'shadow') = (source_id is not null and external_id is not null and draft is not null)`)),
    check("event_proposals_flags_check", sql.raw(`flags <@ array[${sqlList(SHADOW_FLAGS).slice(1, -1)}]::text[]`)),
    check("event_proposals_reject_kind_check", sql.raw(`(reject_kind is null) or (status = 'rejected' and reject_kind in ${sqlList(REJECT_KINDS)})`)),
    check("event_proposals_status_check", sql.raw(`status in ${sqlList(PROPOSAL_STATUSES)}`)),
    check("event_proposals_origin_check", sql.raw(`origin in ${sqlList(PROPOSAL_ORIGINS)}`)),
    check("event_proposals_reasons_check", sql.raw(`reasons <@ array[${sqlList(REVIEW_REASONS).slice(1, -1)}]::text[]`)),
    // Approved and merged items point at their event; pending and rejected don't.
    check("event_proposals_event_check", sql.raw(`(status in ('approved', 'merged')) = (event_id is not null)`)),
    // A decision has a time and a decider; a pending item has neither.
    check("event_proposals_decided_check", sql.raw(`(status = 'pending') = (decided_at is null) and (decided_at is null) = (decided_by is null)`)),
    check("event_proposals_reject_note_check", sql.raw(`status <> 'rejected' or length(coalesce(decision_note, '')) >= 3`)),
  ],
).enableRLS();
