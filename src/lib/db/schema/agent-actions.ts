import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, sqlList } from "./columns";
import { llmCalls } from "./llm";
import { runs } from "./runs";

export const AGENT_ACTIONS = [
  "insert",
  "update",
  "merge",
  "unmerge",
  "disable",
  "enable",
  "propose_venue",
  "propose_link",
  "publish",
  "hold",
  "veto",
  "recheck_drop",
  "recheck_correct",
  "rollback",
] as const;
export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;

/**
 * Append-only log of every automated (and admin) change, with full before/after
 * snapshots so any action can be rolled back. Only the review and revert
 * columns are ever updated after insert.
 */
export const agentActions = pgTable(
  "agent_actions",
  {
    id: id(),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    // "agent:<job>" or "human:<who>".
    actor: text("actor").notNull(),
    job: text("job"),
    action: text("action", { enum: AGENT_ACTIONS }).notNull(),
    entityType: text("entity_type").notNull(),
    // Null for proposals, where the entity doesn't exist yet.
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason").notNull(),
    model: text("model"),
    llmCallId: uuid("llm_call_id").references(() => llmCalls.id, { onDelete: "set null" }),
    confidence: numeric("confidence", { precision: 4, scale: 3, mode: "number" }),
    // Null unless the action needs a human decision (propose_venue, propose_link).
    approvalStatus: text("approval_status", { enum: APPROVAL_STATUSES }),
    dedupeKey: text("dedupe_key"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    revertsActionId: uuid("reverts_action_id").references((): AnyPgColumn => agentActions.id),
    revertedByActionId: uuid("reverted_by_action_id").references(
      (): AnyPgColumn => agentActions.id,
    ),
    createdAt: createdAt(),
  },
  (t) => [
    index("agent_actions_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    index("agent_actions_run_idx").on(t.runId),
    index("agent_actions_created_idx").on(t.createdAt.desc()),
    index("agent_actions_pending_idx")
      .on(t.createdAt)
      .where(sql`${t.approvalStatus} = 'pending'`),
    // The same proposal can't be pending twice.
    uniqueIndex("agent_actions_pending_dedupe_uniq")
      .on(t.action, t.dedupeKey)
      .where(sql`${t.approvalStatus} = 'pending'`),
    check("agent_actions_action_check", sql.raw(`action in ${sqlList(AGENT_ACTIONS)}`)),
    check(
      "agent_actions_approval_check",
      sql.raw(`approval_status is null or approval_status in ${sqlList(APPROVAL_STATUSES)}`),
    ),
    check("agent_actions_actor_check", sql.raw(`actor ~ '^(agent|human):.+'`)),
    check(
      "agent_actions_confidence_check",
      sql.raw(`confidence is null or (confidence >= 0 and confidence <= 1)`),
    ),
  ],
).enableRLS();
