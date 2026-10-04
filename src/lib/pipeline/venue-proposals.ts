import { and, eq, inArray, sql } from "drizzle-orm";
import { proposeOnce } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { agentActions, rawRecords, sources } from "@/lib/db/schema";

/**
 * Plan section 5, rule 5: when one location_key appears on 2 or more distinct
 * unmatched records and has no pending or rejected proposal, log a pending
 * propose_venue for the owner. A bare city ("nolocation:" keys) is never
 * proposed. Approving means adding the venue through the venue sign-off
 * process; the records are then re-queued.
 */
export async function proposeVenues(db: DbExecutor, opts: { actor: string; runId?: string | null }) {
  const groups = await db
    .select({
      locationKey: rawRecords.locationKey,
      records: sql<number>`count(*)::int`,
      sample: sql<string>`min(${rawRecords.facts}->'location'->>'text')`,
      titles: sql<string[]>`(array_agg(distinct ${rawRecords.facts}->>'title'))[1:5]`,
      sources: sql<string[]>`array_agg(distinct ${sources.slug})`,
    })
    .from(rawRecords)
    .innerJoin(sources, eq(sources.id, rawRecords.sourceId))
    .where(and(eq(rawRecords.status, "needs_venue"), sql`${rawRecords.locationKey} not like 'nolocation:%'`))
    .groupBy(rawRecords.locationKey)
    .having(sql`count(*) >= 2`);

  let proposed = 0;
  let alreadyDecided = 0;
  for (const g of groups) {
    const dedupeKey = `venue:${g.locationKey}`;
    const [rejected] = await db
      .select({ id: agentActions.id })
      .from(agentActions)
      .where(and(eq(agentActions.action, "propose_venue"), eq(agentActions.dedupeKey, dedupeKey), inArray(agentActions.approvalStatus, ["rejected"])))
      .limit(1);
    if (rejected) {
      alreadyDecided++;
      continue;
    }
    const row = await proposeOnce(db, {
      runId: opts.runId ?? null,
      actor: opts.actor,
      action: "propose_venue",
      entityType: "venue",
      approvalStatus: "pending",
      dedupeKey,
      after: { locationKey: g.locationKey, locationText: g.sample, records: g.records, sampleTitles: g.titles, sources: g.sources },
      reason: `${g.records} records share an unmatched location: ${g.sample}`,
    });
    if (row) proposed++;
  }
  return { proposed, alreadyDecided };
}
