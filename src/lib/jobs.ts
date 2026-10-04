import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { DbExecutor } from "@/lib/db/client";
import { runs } from "@/lib/db/schema";
import type { Run, RunJob } from "@/lib/runs";

/**
 * Makes sure only one instance of a job runs at a time. The app talks to
 * Postgres through the transaction pooler, where session advisory locks don't
 * hold across statements, so the lock is a lease: a transaction-scoped
 * advisory lock makes the check-and-claim atomic, and the claim itself is a
 * "running" row in `runs` (with no source) that lasts until the job finishes.
 * A claim older than `staleAfterMs` is from a crashed job and is marked failed.
 */
export async function claimJob(
  db: DbExecutor,
  job: RunJob,
  opts: { now?: Date; staleAfterMs?: number } = {},
): Promise<Run | null> {
  const now = opts.now ?? new Date();
  const staleBefore = new Date(now.getTime() - (opts.staleAfterMs ?? 15 * 60_000));
  return db.transaction(async (tx) => {
    const [{ locked }] = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext(${`agent479:job:${job}`})) as locked`,
    );
    if (!locked) return null;

    const isClaim = and(eq(runs.job, job), isNull(runs.sourceId), eq(runs.status, "running"));
    await tx
      .update(runs)
      .set({ status: "failed", finishedAt: now, error: "stale: the job never finished; lease expired" })
      .where(and(isClaim, lt(runs.startedAt, staleBefore)));
    const [held] = await tx.select({ id: runs.id }).from(runs).where(isClaim).limit(1);
    if (held) return null;

    const [claim] = await tx.insert(runs).values({ job, startedAt: now }).returning();
    return claim;
  });
}
