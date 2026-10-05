import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, sqlList, updatedAt } from "./columns";
import { events } from "./events";
import { runs } from "./runs";

/**
 * The review queue (/admin/review; AGENTS.md, "Festivals and the review
 * queue"): proposed events that wait for the owner. Fail closed: nothing here
 * is public until the owner approves it, which writes the event. Every
 * create and decision is also logged through recordAction.
 */

export const PROPOSAL_STATUSES = ["pending", "approved", "rejected", "merged"] as const;
export const PROPOSAL_ORIGINS = ["owner_form", "registry", "calendar", "lead"] as const;
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
] as const;

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
