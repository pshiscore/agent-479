import { and, eq, isNotNull, sql } from "drizzle-orm";
import { agentActor } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { rawRecords, sources } from "@/lib/db/schema";
import { claimJob } from "@/lib/jobs";
import { finishRun } from "@/lib/runs";
import { proposeTicketmasterLinks } from "@/lib/sources/ticketmaster-venues";
import { proposeCategoriesFromHints } from "./category-themes";

/**
 * The daily maintenance job. So far it purges source descriptions (AGENTS.md
 * rule 4): 30 days after the event ends, or, for an open-ended series, 30 days
 * after the item was last seen in its feed; and raw payloads not seen for 30
 * days; and proposes Ticketmaster venue links for the owner (never links).
 * Counts go in runs.stats. Later steps add the dedup sweep and source health
 * checks.
 */

export async function purgeDescriptions(db: DbExecutor, now: Date): Promise<number> {
  const purged = await db
    .update(rawRecords)
    .set({ descriptionText: null })
    .where(
      and(
        isNotNull(rawRecords.descriptionText),
        sql`coalesce(${rawRecords.descriptionPurgeAfter}, ${rawRecords.fetchedAt} + interval '30 days') <= ${now.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: rawRecords.id });
  return purged.length;
}

/**
 * Raw payloads (and any description) for items no fetch has seen in 30 days
 * are purged: storage "only for reasonable periods" (Ticketmaster's terms;
 * plan section 3). If an item comes back, the fetch stores it again.
 */
export async function purgeStalePayloads(db: DbExecutor, now: Date): Promise<number> {
  const purged = await db
    .update(rawRecords)
    .set({ payload: null, descriptionText: null })
    .where(
      and(
        isNotNull(rawRecords.payload),
        sql`${rawRecords.fetchedAt} <= ${now.toISOString()}::timestamptz - interval '30 days'`,
      ),
    )
    .returning({ id: rawRecords.id });
  return purged.length;
}

/**
 * needs_venue records never become events; once their event is over they're
 * archived (status skipped, reason needs_venue_expired), counted in runs.stats.
 */
export async function archiveExpiredNeedsVenue(db: DbExecutor, now: Date): Promise<number> {
  const archived = await db
    .update(rawRecords)
    .set({ status: "skipped", skipReason: "needs_venue_expired" })
    .where(
      and(
        eq(rawRecords.status, "needs_venue"),
        sql`coalesce((${rawRecords.facts}->>'endAt')::timestamptz, (${rawRecords.facts}->>'startAt')::timestamptz) < ${now.toISOString()}::timestamptz - interval '1 day'`,
      ),
    )
    .returning({ id: rawRecords.id });
  return archived.length;
}

/** For the admin page: records waiting for a venue, by location. */
export async function needsVenueSummary(db: DbExecutor) {
  const byKey = await db
    .select({ locationKey: rawRecords.locationKey, records: sql<number>`count(*)::int` })
    .from(rawRecords)
    .where(eq(rawRecords.status, "needs_venue"))
    .groupBy(rawRecords.locationKey)
    .orderBy(sql`count(*) desc`);
  return { total: byKey.reduce((n, r) => n + r.records, 0), byKey };
}

/** Returns null if another maintenance job holds the lease. */
export async function runMaintenanceJob(db: DbExecutor, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const claim = await claimJob(db, "maintenance", { now, staleAfterMs: 60 * 60_000 });
  if (!claim) return null;
  try {
    const descriptionsPurged = await purgeDescriptions(db, now);
    const payloadsPurged = await purgeStalePayloads(db, now);
    // Proposals only: never links a Ticketmaster venue by itself.
    const [tm] = await db.select({ id: sources.id }).from(sources).where(eq(sources.slug, "ticketmaster"));
    const linkProposals = tm
      ? await proposeTicketmasterLinks(db, { actor: agentActor("maintenance"), runId: claim.id })
      : { proposed: 0, alreadyDecided: 0 };
    const needsVenueArchived = await archiveExpiredNeedsVenue(db, now);
    const categoryProposals = await proposeCategoriesFromHints(db, { actor: agentActor("maintenance"), now, runId: claim.id });
    const stats = {
      descriptionsPurged,
      payloadsPurged,
      linkProposals: linkProposals.proposed,
      needsVenueArchived,
      categoryProposals: categoryProposals.proposed,
    };
    await finishRun(db, claim.id, { status: "ok", stats });
    return stats;
  } catch (err) {
    await finishRun(db, claim.id, { status: "failed", error: String(err).slice(0, 2000) });
    throw err;
  }
}
