import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRON_BUDGET_MS, CRON_MAX_DURATION_S, Deadline, runTiming, SLOW_RUN_MS } from "./cron-budget";

describe("cron budget", () => {
  it("stops at 60% of the limit and flags runs over half of it", () => {
    expect(CRON_BUDGET_MS).toBe(180_000);
    expect(SLOW_RUN_MS).toBe(150_000);
    const start = new Date("2026-10-17T09:00:00Z");
    expect(runTiming({ startedAt: start, finishedAt: new Date(start.getTime() + 151_000) })).toEqual({ durationMs: 151_000, slow: true });
    expect(runTiming({ startedAt: start, finishedAt: new Date(start.getTime() + 30_000) }).slow).toBe(false);
    expect(runTiming({ startedAt: start, finishedAt: null })).toEqual({ durationMs: null, slow: false });
  });

  it("Deadline passes once the budget is used", () => {
    let t = 0;
    const d = new Deadline(1000, () => t);
    expect(d.passed).toBe(false);
    t = 999;
    expect(d.passed).toBe(false);
    t = 1000;
    expect(d.passed).toBe(true);
  });

  it("every cron route's maxDuration equals CRON_MAX_DURATION_S", () => {
    const dir = "src/app/api/cron";
    const routes = readdirSync(dir);
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      const src = readFileSync(`${dir}/${r}/route.ts`, "utf8");
      expect(/export const maxDuration = (\d+);/.exec(src)?.[1], r).toBe(String(CRON_MAX_DURATION_S));
    }
  });
});
