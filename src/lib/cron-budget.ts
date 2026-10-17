/**
 * Time budgets for the scheduled jobs (owner, 2026-10-17). Each /api/cron/*
 * route has a 300 s function limit (`maxDuration`, a literal in each route
 * file; a test keeps them equal to CRON_MAX_DURATION_S). A job stops starting
 * new work at 60% of that and saves its progress: records it didn't reach stay
 * pending, sources it didn't fetch stay due, skipped maintenance steps run on
 * the next daily run. A run that takes more than half the limit is flagged on
 * the admin overview.
 */

export const CRON_MAX_DURATION_S = 300;
export const CRON_BUDGET_MS = Math.round(CRON_MAX_DURATION_S * 1000 * 0.6);
export const SLOW_RUN_MS = Math.round(CRON_MAX_DURATION_S * 1000 * 0.5);

export class Deadline {
  private readonly startedAt: number;
  constructor(
    readonly budgetMs = CRON_BUDGET_MS,
    private readonly clock: () => number = Date.now,
  ) {
    this.startedAt = clock();
  }
  get passed(): boolean {
    return this.clock() - this.startedAt >= this.budgetMs;
  }
  get elapsedMs(): number {
    return this.clock() - this.startedAt;
  }
}

/** A finished run's duration, and whether it used more than half the function limit. */
export function runTiming(run: { startedAt: Date; finishedAt: Date | null }): { durationMs: number | null; slow: boolean } {
  if (!run.finishedAt) return { durationMs: null, slow: false };
  const durationMs = run.finishedAt.getTime() - run.startedAt.getTime();
  return { durationMs, slow: durationMs > SLOW_RUN_MS };
}
