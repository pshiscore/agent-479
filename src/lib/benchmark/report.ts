import type { BENCHMARK_RESULTS, MISS_REASONS } from "@/lib/db/schema";

/**
 * Coverage for a benchmark week (owner, 2026-10-17). Items missed as
 * "outside coverage area" are left out of the total and counted apart.
 * Live coverage is live over the total; potential coverage is live, review,
 * and shadow together over the total.
 */

export interface CoverageItem {
  result: (typeof BENCHMARK_RESULTS)[number];
  missReason: (typeof MISS_REASONS)[number] | null;
}

export interface Coverage {
  total: number;
  outside: number;
  live: number;
  review: number;
  shadow: number;
  missed: number;
  // Missed items still waiting for the owner's reason.
  unexplained: number;
  livePct: number | null;
  potentialPct: number | null;
}

const pct = (n: number, of: number) => (of === 0 ? null : Math.round((n / of) * 1000) / 10);

export function coverage(items: readonly CoverageItem[]): Coverage {
  const counted = items.filter((i) => i.missReason !== "outside_area");
  const n = (r: CoverageItem["result"]) => counted.filter((i) => i.result === r).length;
  const live = n("live");
  const review = n("review");
  const shadow = n("shadow");
  const missed = n("missed");
  return {
    total: counted.length,
    outside: items.length - counted.length,
    live,
    review,
    shadow,
    missed,
    unexplained: counted.filter((i) => i.result === "missed" && !i.missReason).length,
    livePct: pct(live, counted.length),
    potentialPct: pct(live + review + shadow, counted.length),
  };
}
