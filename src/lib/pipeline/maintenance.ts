import { and, isNotNull, sql } from "drizzle-orm";
import type { DbExecutor } from "@/lib/db/client";
import { rawRecords } from "@/lib/db/schema";
import { claimJob } from "@/lib/jobs";
import { finishRun } from "@/lib/runs";

/**
 * The daily maintenance job. So far it purges source descriptions (AGENTS.md
 * rule 4): 30 days after the event ends, or, for an open-ended series, 30 days
 * after the item was last seen in its feed. Counts go in runs.stats. Later
 * steps add the dedup sweep, payload purge, and source health checks.
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

/** Returns null if another maintenance job holds the lease. */
export async function runMaintenanceJob(db: DbExecutor, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const claim = await claimJob(db, "maintenance", { now, staleAfterMs: 60 * 60_000 });
  if (!claim) return null;
  try {
    const descriptionsPurged = await purgeDescriptions(db, now);
    const stats = { descriptionsPurged };
    await finishRun(db, claim.id, { status: "ok", stats });
    return stats;
  } catch (err) {
    await finishRun(db, claim.id, { status: "failed", error: String(err).slice(0, 2000) });
    throw err;
  }
}
