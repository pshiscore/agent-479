import { and, eq, isNull, lt, ne } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { eventProposals, eventSubmissions } from "@/lib/db/schema";
import { redacted } from "./submit";

/** Submitters' emails and notes are deleted 30 days after the owner decides (owner, 2026-10-16). */
export const SUBMITTER_EMAIL_DAYS = 30;

export async function purgeSubmitterEmails(db: DbExecutor, now: Date, actor: string, runId: string | null): Promise<number> {
  const cutoff = new Date(now.getTime() - SUBMITTER_EMAIL_DAYS * 86_400_000);
  const due = await db
    .select({ s: eventSubmissions })
    .from(eventSubmissions)
    .innerJoin(eventProposals, eq(eventProposals.id, eventSubmissions.proposalId))
    .where(and(isNull(eventSubmissions.purgedAt), ne(eventProposals.status, "pending"), lt(eventProposals.decidedAt, cutoff)));
  for (const { s } of due) {
    await db.transaction(async (tx) => {
      const [after] = await tx.update(eventSubmissions).set({ email: null, note: null, purgedAt: now }).where(eq(eventSubmissions.id, s.id)).returning();
      await recordAction(tx, { actor, runId, action: "update", entityType: "event_submission", entityId: s.id, before: redacted(s), after: redacted(after), reason: `Submitter's email and note deleted ${SUBMITTER_EMAIL_DAYS} days after the decision` });
    });
  }
  return due.length;
}
