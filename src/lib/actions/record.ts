import { z } from "zod";
import type { DbExecutor } from "@/lib/db/client";
import { AGENT_ACTIONS, agentActions, APPROVAL_STATUSES } from "@/lib/db/schema";

export type AgentAction = typeof agentActions.$inferSelect;

export const agentActor = (job: string) => `agent:${job}`;
export const humanActor = (who: string) => `human:${who}`;

const snapshot = z.record(z.string(), z.unknown());

/** Actions that wait for a human decision: created pending, with no entity yet. */
const PROPOSALS = new Set<string>(["propose_venue", "propose_link", "propose_category"]);

/** Actions that change an existing entity and so need both snapshots to be reversible. */
const NEEDS_BEFORE_AND_AFTER = new Set<string>([
  "update",
  "merge",
  "unmerge",
  "disable",
  "enable",
  "recheck_correct",
]);

export const actionInputSchema = z
  .object({
    runId: z.uuid().nullish(),
    actor: z.string().regex(/^(agent|human):.+$/, 'actor must be "agent:<job>" or "human:<who>"'),
    job: z.string().min(1).nullish(),
    action: z.enum(AGENT_ACTIONS),
    entityType: z.string().min(1),
    entityId: z.uuid().nullish(),
    before: snapshot.nullish(),
    after: snapshot.nullish(),
    reason: z.string().trim().min(3, "reason is required"),
    model: z.string().min(1).nullish(),
    llmCallId: z.uuid().nullish(),
    confidence: z.number().min(0).max(1).nullish(),
    approvalStatus: z.enum(APPROVAL_STATUSES).nullish(),
    dedupeKey: z.string().min(1).nullish(),
    revertsActionId: z.uuid().nullish(),
  })
  .superRefine((a, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    const isProposal = PROPOSALS.has(a.action);

    if (isProposal) {
      if (a.approvalStatus !== "pending") issue(`${a.action} must be created as pending`);
      if (!a.dedupeKey) issue(`${a.action} needs a dedupeKey`);
      if (!a.after) issue(`${a.action} needs the proposed fields in after`);
      if (a.entityId) issue(`${a.action} has no entityId until approved`);
    } else {
      if (!a.entityId) issue(`${a.action} needs an entityId`);
      if (a.approvalStatus) issue("only proposals are created with an approval status");
    }
    if (a.action === "insert") {
      if (!a.after) issue("insert needs after");
      if (a.before) issue("insert must not have before");
    }
    if (NEEDS_BEFORE_AND_AFTER.has(a.action) && (!a.before || !a.after)) {
      issue(`${a.action} needs both before and after so it can be rolled back`);
    }
    if (a.action === "rollback" && !a.revertsActionId) issue("rollback needs revertsActionId");
    if (a.model && !a.actor.startsWith("agent:")) issue("model is only set on agent actions");
    if (a.llmCallId && !a.model) issue("llmCallId needs the model name too");
  });

export type ActionInput = z.input<typeof actionInputSchema>;

/**
 * Logs one automated or admin change. Call it inside the same transaction as
 * the change itself, so the change and its log entry commit or fail together:
 *
 *   await db.transaction(async (tx) => {
 *     const [after] = await tx.update(events).set(...).where(...).returning();
 *     await recordAction(tx, { action: "update", before, after, ... });
 *   });
 *
 * Throws a ZodError before touching the database if the input is invalid.
 */
export async function recordAction(db: DbExecutor, input: ActionInput): Promise<AgentAction> {
  const values = actionInputSchema.parse(input);
  const [row] = await db.insert(agentActions).values(values).returning();
  return row;
}

/**
 * Logs a proposal (e.g. a new venue) unless the same dedupeKey is already
 * pending. Returns null when an identical proposal is still awaiting review.
 */
export async function proposeOnce(db: DbExecutor, input: ActionInput): Promise<AgentAction | null> {
  const values = actionInputSchema.parse(input);
  if (values.approvalStatus !== "pending") throw new Error("proposeOnce is for pending proposals");
  const [row] = await db.insert(agentActions).values(values).onConflictDoNothing().returning();
  return row ?? null;
}
