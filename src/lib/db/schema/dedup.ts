import { sql } from "drizzle-orm";
import { check, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, sqlList, updatedAt } from "./columns";
import { events } from "./events";
import { llmCalls } from "./llm";
import { runs } from "./runs";

/**
 * Duplicate detection (build step 15, plan section 6). One row per unordered
 * pair of events that blocking put side by side: event_a_id < event_b_id.
 * Every insert and change is logged in agent_actions too.
 *
 * decision:
 *   auto_merge  score ≥ T_merge and starts within 30 minutes (or a matching
 *               Ticketmaster event ID)
 *   llm_same    the tiebreak said "same" with confidence ≥ 0.8
 *   uncertain   the tiebreak said "same" with less confidence: both stay live,
 *               and the digest never picks both
 *   distinct    below T_llm, or the tiebreak said "different"
 * mode: shadow (logged only: nothing merged) or live (merged). A pair is live
 * only when both events' sources are in dedup_mode live.
 */

export const DEDUP_DECISIONS = ["auto_merge", "llm_same", "uncertain", "distinct"] as const;
export const DEDUP_RUN_MODES = ["shadow", "live"] as const;
export const DEDUP_LABELS = ["same", "different"] as const;

export interface DedupScores {
  title: number;
  trigram: number;
  tokenSet: number;
  startDiffMinutes: number;
  ticketmasterIdMatch: boolean;
  // Both name a room and the rooms differ: never an auto-merge.
  subSpaceDiffers?: boolean;
  score: number;
  tMerge: number;
  tLlm: number;
  llm?: { same: boolean; confidence: number } | null;
}

export const dedupCandidates = pgTable(
  "dedup_candidates",
  {
    id: id(),
    eventAId: uuid("event_a_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    eventBId: uuid("event_b_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    scores: jsonb("scores").$type<DedupScores>().notNull(),
    decision: text("decision", { enum: DEDUP_DECISIONS }).notNull(),
    mode: text("mode", { enum: DEDUP_RUN_MODES }).notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3, mode: "number" }),
    llmCallId: uuid("llm_call_id").references(() => llmCalls.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    // Set when the pair was merged (live), or decided by the owner's label.
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("dedup_candidates_pair_uniq").on(t.eventAId, t.eventBId),
    index("dedup_candidates_b_idx").on(t.eventBId),
    index("dedup_candidates_decision_idx").on(t.decision),
    check("dedup_candidates_order_check", sql.raw(`event_a_id < event_b_id`)),
    check("dedup_candidates_decision_check", sql.raw(`decision in ${sqlList(DEDUP_DECISIONS)}`)),
    check("dedup_candidates_mode_check", sql.raw(`mode in ${sqlList(DEDUP_RUN_MODES)}`)),
    check("dedup_candidates_confidence_check", sql.raw(`confidence is null or (confidence >= 0 and confidence <= 1)`)),
  ],
).enableRLS();

/**
 * The owner's labels on candidate pairs (step 17), with frozen copies of both
 * events' facts so the regression set survives later data changes.
 */
export const dedupLabels = pgTable(
  "dedup_labels",
  {
    id: id(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => dedupCandidates.id, { onDelete: "restrict" }),
    factsA: jsonb("facts_a").notNull(),
    factsB: jsonb("facts_b").notNull(),
    label: text("label", { enum: DEDUP_LABELS }).notNull(),
    sourceIds: uuid("source_ids").array().notNull(),
    labeledBy: text("labeled_by").notNull(),
    labeledAt: timestamp("labeled_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
  },
  (t) => [
    uniqueIndex("dedup_labels_candidate_uniq").on(t.candidateId),
    check("dedup_labels_label_check", sql.raw(`label in ${sqlList(DEDUP_LABELS)}`)),
    check("dedup_labels_by_check", sql.raw(`labeled_by ~ '^human:.+'`)),
  ],
).enableRLS();
