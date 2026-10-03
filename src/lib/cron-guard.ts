import { chicagoParts } from "./time";

/**
 * Vercel cron runs in UTC, but some jobs must run at a Chicago wall-clock
 * time year-round. Each such job gets two cron entries one hour apart (the
 * CDT and CST UTC equivalents), and this guard lets exactly one of them work.
 */
export interface LocalSchedule {
  /** ISO weekday in Chicago: 1 = Monday ... 7 = Sunday. */
  weekday: number;
  /** Hour in Chicago, 0-23. */
  hour: number;
  /** The two UTC cron expressions for vercel.json (CDT first, then CST). */
  crons: readonly [string, string];
}

export const LOCAL_SCHEDULES = {
  /** Thursday 6:00pm Chicago: build the weekend digest draft. */
  digestDraft: { weekday: 4, hour: 18, crons: ["0 23 * * 4", "0 0 * * 5"] },
  /** Friday 6:00am Chicago: re-check the draft's events against sources. */
  digestRecheck: { weekday: 5, hour: 6, crons: ["0 11 * * 5", "0 12 * * 5"] },
} as const satisfies Record<string, LocalSchedule>;

/** True when `now` falls in the scheduled Chicago weekday and hour. */
export function isLocalScheduleDue(schedule: LocalSchedule, now: Date): boolean {
  const p = chicagoParts(now);
  return p.weekday === schedule.weekday && p.hour === schedule.hour;
}
