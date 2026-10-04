import { and, eq } from "drizzle-orm";
import { proposeOnce } from "@/lib/actions/record";
import type { GlossaryEntry } from "@/config/glossary";
import type { DbExecutor } from "@/lib/db/client";
import { agentActions } from "@/lib/db/schema";

/**
 * Logs a pending propose_glossary for each acronym expansion a description
 * used that the glossary doesn't have (owner, 2026-10-04: only the owner adds
 * entries). A pending or rejected proposal for the same expansion isn't
 * logged again.
 */
export async function proposeGlossaryEntries(
  db: DbExecutor,
  candidates: readonly GlossaryEntry[],
  ctx: { actor: string; runId?: string | null; eventTitle: string },
) {
  let proposed = 0;
  for (const c of candidates) {
    const dedupeKey = `glossary:${c.acronym}:${c.expansion.toLowerCase()}`;
    const [rejected] = await db
      .select({ id: agentActions.id })
      .from(agentActions)
      .where(and(eq(agentActions.action, "propose_glossary"), eq(agentActions.dedupeKey, dedupeKey), eq(agentActions.approvalStatus, "rejected")))
      .limit(1);
    if (rejected) continue;
    const row = await proposeOnce(db, {
      runId: ctx.runId ?? null,
      actor: ctx.actor,
      action: "propose_glossary",
      entityType: "glossary",
      approvalStatus: "pending",
      dedupeKey,
      after: { acronym: c.acronym, expansion: c.expansion, seenIn: ctx.eventTitle },
      reason: `A description spelled out ${c.acronym} as "${c.expansion}" for "${ctx.eventTitle}"; it isn't in the glossary yet`,
    });
    if (row) proposed++;
  }
  return proposed;
}
