import { eq } from "drizzle-orm";
import type { DbExecutor } from "@/lib/db/client";
import { RUN_JOBS, runs } from "@/lib/db/schema";

export type Run = typeof runs.$inferSelect;
export type RunJob = (typeof RUN_JOBS)[number];
type Stats = Record<string, unknown>;

export async function startRun(
  db: DbExecutor,
  job: RunJob,
  opts: { sourceId?: string } = {},
): Promise<Run> {
  const [run] = await db.insert(runs).values({ job, sourceId: opts.sourceId }).returning();
  return run;
}

export async function finishRun(
  db: DbExecutor,
  runId: string,
  result: { status: "ok" | "partial" | "failed"; stats?: Stats; error?: string },
): Promise<void> {
  await db
    .update(runs)
    .set({
      status: result.status,
      stats: result.stats ?? {},
      error: result.error ?? null,
      finishedAt: new Date(),
    })
    .where(eq(runs.id, runId));
}

/**
 * Runs `work` inside a tracked run. The run row is written outside the work's
 * own transactions, so a failed job still leaves a "failed" run behind.
 * Return `{ status: "partial" }` in stats to mark partial success.
 */
export async function withRun<T extends Stats>(
  db: DbExecutor,
  job: RunJob,
  work: (run: Run) => Promise<T & { status?: "ok" | "partial" }>,
  opts: { sourceId?: string } = {},
): Promise<T> {
  const run = await startRun(db, job, opts);
  try {
    const { status = "ok", ...stats } = await work(run);
    await finishRun(db, run.id, { status, stats });
    return stats as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(db, run.id, { status: "failed", error: message.slice(0, 2000) });
    throw err;
  }
}
