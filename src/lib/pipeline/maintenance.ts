import { and, eq, isNotNull, sql } from "drizzle-orm";
import { agentActor } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { rawRecords, sources } from "@/lib/db/schema";
import { Deadline } from "@/lib/cron-budget";
import { claimJob } from "@/lib/jobs";
import { finishRun } from "@/lib/runs";
import { demoteLiveSources } from "@/lib/sources/demotion";
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
export async function runMaintenanceJob(db: DbExecutor, opts: { now?: Date; deadline?: Deadline } = {}) {
  const now = opts.now ?? new Date();
  const deadline = opts.deadline ?? new Deadline();
  const claim = await claimJob(db, "maintenance", { now, staleAfterMs: 60 * 60_000 });
  if (!claim) return null;
  try {
    // Each step is a self-contained batch; out of time, the rest wait for the next daily run.
    const skipped: string[] = [];
    const step = async <T>(name: string, fallback: T, run: () => Promise<T>): Promise<T> => {
      if (deadline.passed) {
        skipped.push(name);
        return fallback;
      }
      return run();
    };
    const descriptionsPurged = await step("purge descriptions", 0, () => purgeDescriptions(db, now));
    const payloadsPurged = await step("purge payloads", 0, () => purgeStalePayloads(db, now));
    // Proposals only: never links a Ticketmaster venue by itself.
    const linkProposals = await step("Ticketmaster links", { proposed: 0, alreadyDecided: 0 }, async () => {
      const [tm] = await db.select({ id: sources.id }).from(sources).where(eq(sources.slug, "ticketmaster"));
      return tm ? proposeTicketmasterLinks(db, { actor: agentActor("maintenance"), runId: claim.id }) : { proposed: 0, alreadyDecided: 0 };
    });
    const needsVenueArchived = await step("archive needs_venue", 0, () => archiveExpiredNeedsVenue(db, now));
    const categoryProposals = await step("category proposals", { proposed: 0, themes: 0 }, () => proposeCategoriesFromHints(db, { actor: agentActor("maintenance"), now, runId: claim.id }));
    // Live sources that misbehaved this week go back to shadow (owner, 2026-10-16).
    const demoted = await step("demotions", [] as unknown[], () => demoteLiveSources(db, now, agentActor("maintenance")));
    const stats = {
      descriptionsPurged,
      payloadsPurged,
      linkProposals: linkProposals.proposed,
      needsVenueArchived,
      categoryProposals: categoryProposals.proposed,
      sourcesDemoted: demoted.length,
      stoppedForTime: skipped.length > 0,
      stepsSkipped: skipped,
      elapsedMs: deadline.elapsedMs,
    };
    await finishRun(db, claim.id, { status: skipped.length ? "partial" : "ok", stats });
    return stats;
  } catch (err) {
    await finishRun(db, claim.id, { status: "failed", error: String(err).slice(0, 2000) });
    throw err;
  }
}
