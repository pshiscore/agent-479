import { and, inArray, lt, not, sql } from "drizzle-orm";
import type { DbExecutor } from "@/lib/db/client";
import { type BENCHMARK_RESULTS, eventProposals, events, type MISS_REASONS, type ProposedEvent } from "@/lib/db/schema";
import { tokenSetRatio, trigramSimilarity } from "@/lib/pipeline/dedup/score";
import { UPDATE_SUFFIX } from "@/lib/review/shadow";
import { addDays, chicagoToUtc, parseDate } from "@/lib/time";

/**
 * Matches one benchmark line against what we have (docs/product/organizers.md):
 * events and review items whose dates overlap the typed date ±1 day (a
 * multi-day event matches when the date falls inside its range), by title.
 * The title bar is the review queue's "likely match" bar (0.6), so the
 * benchmark sees what the owner sees there. The owner can mark a match wrong.
 */

export const TITLE_MATCH = 0.6;

type Result = (typeof BENCHMARK_RESULTS)[number];
type Reason = (typeof MISS_REASONS)[number];

export type Candidate =
  | { kind: "event"; id: string; title: string; status: string }
  | { kind: "proposal"; id: string; title: string; status: string; origin: string; flags: string[]; rejectKind: string | null };

export interface Match {
  result: Result;
  eventId: string | null;
  proposalId: string | null;
  title: string | null;
  score: number | null;
  // Set by code only for a fact we hold: the event waits in review outside the coverage area.
  missReason: Reason | null;
  suggestedReason: Reason | null;
  note: string | null;
}

export const titleScore = (a: string, b: string) => Math.max(tokenSetRatio(a, b), trigramSimilarity(a, b));

const MISSED: Match = { result: "missed", eventId: null, proposalId: null, title: null, score: null, missReason: null, suggestedReason: null, note: null };

/** Pure: the best match among candidates, preferring live, then review, then shadow. */
export function pickMatch(name: string, candidates: readonly Candidate[]): Match {
  const scored = candidates.map((c) => ({ c, score: Math.round(titleScore(name, c.title) * 1000) / 1000 })).filter((s) => s.score >= TITLE_MATCH);
  const best = (pred: (c: Candidate) => boolean) => scored.filter((s) => pred(s.c)).sort((a, b) => b.score - a.score)[0];
  const pending = (c: Candidate) => c.kind === "proposal" && c.status === "pending";
  const outside = (c: Candidate) => c.kind === "proposal" && c.flags.includes("outside_coverage");

  const live = best((c) => c.kind === "event" && ["scheduled", "postponed", "cancelled"].includes(c.status));
  if (live) return { ...MISSED, result: "live", eventId: live.c.id, title: live.c.title, score: live.score };
  const review = best((c) => pending(c) && !outside(c) && c.kind === "proposal" && c.origin !== "shadow");
  if (review) return { ...MISSED, result: "review", proposalId: review.c.id, title: review.c.title, score: review.score };
  const shadow = best((c) => pending(c) && !outside(c) && c.kind === "proposal" && c.origin === "shadow");
  if (shadow) return { ...MISSED, result: "shadow", proposalId: shadow.c.id, title: shadow.c.title, score: shadow.score };
  const held = best((c) => pending(c) && outside(c));
  if (held) return { ...MISSED, missReason: "outside_area", suggestedReason: "outside_area", title: held.c.title, score: held.score, note: `Held in review outside the coverage area: ${held.c.title}` };
  const rejected = best((c) => (c.kind === "proposal" && c.status === "rejected") || (c.kind === "event" && c.status === "hidden"));
  if (rejected) {
    const kind = rejected.c.kind === "proposal" ? rejected.c.rejectKind : null;
    const suggestedReason: Reason = kind === "filtered" ? "filtered" : kind === "outside_area" ? "outside_area" : "rejected";
    return { ...MISSED, suggestedReason, title: rejected.c.title, score: rejected.score, note: `${rejected.c.kind === "event" ? "Hidden event" : "Rejected item"}: ${rejected.c.title}` };
  }
  return MISSED;
}

/** Events and review items whose dates overlap the typed date ±1 day (Chicago days). */
export async function candidatesFor(db: DbExecutor, date: string): Promise<Candidate[]> {
  const day = parseDate(date);
  const lo = chicagoToUtc(addDays(day, -1));
  const hi = chicagoToUtc(addDays(day, 2));
  const evs = await db
    .select({ id: events.id, title: events.title, status: events.status })
    .from(events)
    .where(and(lt(events.startAt, hi), sql`coalesce(${events.endAt}, ${events.startAt}) >= ${lo.toISOString()}::timestamptz`, not(inArray(events.status, ["merged"]))));
  const start = sql`(${eventProposals.facts}->>'startAt')::timestamptz`;
  const props = await db
    .select({ id: eventProposals.id, facts: eventProposals.facts, status: eventProposals.status, origin: eventProposals.origin, flags: eventProposals.flags, rejectKind: eventProposals.rejectKind, externalId: eventProposals.externalId })
    .from(eventProposals)
    .where(
      and(
        inArray(eventProposals.status, ["pending", "rejected"]),
        sql`${start} < ${hi.toISOString()}::timestamptz`,
        sql`coalesce((${eventProposals.facts}->>'endAt')::timestamptz, ${start}) >= ${lo.toISOString()}::timestamptz`,
      ),
    );
  return [
    ...evs.map((e) => ({ kind: "event" as const, ...e })),
    ...props
      // Update items repeat a published event, which matches on its own.
      .filter((p) => !p.externalId?.endsWith(UPDATE_SUFFIX))
      .map((p) => ({ kind: "proposal" as const, id: p.id, title: (p.facts as ProposedEvent).title, status: p.status, origin: p.origin, flags: p.flags, rejectKind: p.rejectKind })),
  ];
}

export async function matchLine(db: DbExecutor, line: { name: string; date: string }): Promise<Match> {
  return pickMatch(line.name, await candidatesFor(db, line.date));
}
