import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like, sql } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { eventProposals, rawRecords, sources } from "@/lib/db/schema";
import { type SourceFilter, sourceFilters, titleMatches } from "@/lib/pipeline/exclude";
import { approveProposal, rejectProposal, ReviewError } from "./proposals";

/**
 * Review by source (owner, 2026-10-16): each shadow source's counts, a sample,
 * filter rules, bulk decisions, and whether it's ready for promotion. One-by-
 * one review is only for flagged items (src/lib/review/proposals.ts).
 */

/** Promotion thresholds (owner, 2026-10-16). */
export const PROMOTION = { minDays: 14, minReviewed: 15, minApprovalRate: 0.9 } as const;

export interface SourceStats {
  pending: number;
  flagged: number;
  conflicts: number;
  approved: number;
  rejected: number;
  rejectedByKind: Record<string, number>;
  filteredSkips: number;
}

/** Pure: is this shadow source ready to recommend for live? Filtered items don't count against it. */
export function promotionCheck(s: SourceStats, shadowSince: Date, now: Date): { ready: boolean; notes: string[] } {
  const notes: string[] = [];
  const days = Math.floor((now.getTime() - shadowSince.getTime()) / 86_400_000);
  const rejected = s.rejected - (s.rejectedByKind.filtered ?? 0);
  const reviewed = s.approved + rejected;
  const rate = reviewed ? s.approved / reviewed : 0;
  const wrong = (s.rejectedByKind.wrong_date ?? 0) + (s.rejectedByKind.wrong_venue ?? 0);
  if (days < PROMOTION.minDays) notes.push(`${days} of ${PROMOTION.minDays} days in shadow`);
  if (reviewed < PROMOTION.minReviewed) notes.push(`${reviewed} of ${PROMOTION.minReviewed} events reviewed`);
  if (reviewed && rate < PROMOTION.minApprovalRate) notes.push(`${Math.round(rate * 100)}% approved (needs ${PROMOTION.minApprovalRate * 100}%)`);
  if (wrong) notes.push(`${wrong} rejected for a wrong date or venue`);
  return { ready: notes.length === 0, notes: notes.length ? notes : [`${days} days, ${reviewed} reviewed, ${Math.round(rate * 100)}% approved, no wrong dates or venues`] };
}

const STOP = new Set(["the", "a", "an", "and", "of", "at", "in", "on", "for", "to", "with", "&", "-", "–"]);

/**
 * Pure: phrases (2 or 3 words) shared by at least 3 pending titles of one
 * source, most common first; candidates for a skip rule, never applied
 * without the owner. Phrases already covered by a rule are left out.
 */
export function suggestFilters(titles: string[], existing: readonly string[] = [], limit = 5): { phrase: string; count: number; examples: string[] }[] {
  const counts = new Map<string, Set<number>>();
  titles.forEach((t, i) => {
    const words = t.toLowerCase().replace(/[^a-z0-9+ ]/g, " ").split(/\s+/).filter(Boolean);
    for (const n of [2, 3]) {
      for (let j = 0; j + n <= words.length; j++) {
        const gram = words.slice(j, j + n);
        if (STOP.has(gram[0]) || STOP.has(gram[n - 1])) continue;
        const phrase = gram.join(" ");
        (counts.get(phrase) ?? counts.set(phrase, new Set()).get(phrase)!).add(i);
      }
    }
  });
  return [...counts]
    .filter(([p, ids]) => ids.size >= 3 && ids.size < titles.length && !existing.some((e) => titleMatches(p, e)))
    .sort((a, b) => b[1].size - a[1].size || b[0].length - a[0].length)
    .filter(([p], i, all) => !all.slice(0, i).some(([q]) => q.includes(p) || p.includes(q)))
    .slice(0, limit)
    .map(([phrase, ids]) => ({ phrase, count: ids.size, examples: [...ids].slice(0, 3).map((i) => titles[i]) }));
}

/** Shadow sources and any source with shadow items still in review. */
export async function sourcesForReview(db: DbExecutor) {
  const withItems = (await db.selectDistinct({ id: eventProposals.sourceId }).from(eventProposals).where(eq(eventProposals.origin, "shadow"))).map((r) => r.id!);
  return db
    .select()
    .from(sources)
    .where(withItems.length ? sql`${sources.publishState} = 'shadow' or ${inArray(sources.id, withItems)}` : eq(sources.publishState, "shadow"))
    .orderBy(asc(sources.slug));
}

export async function sourceStats(db: DbExecutor, sourceId: string): Promise<SourceStats> {
  const rows = (await db.execute(sql`
    select status, reject_kind, cardinality(flags) > 0 flagged, 'conflict' = any(flags) conflict, count(*)::int n
    from event_proposals where source_id = ${sourceId} group by 1, 2, 3, 4`)) as unknown as { status: string; reject_kind: string | null; flagged: boolean; conflict: boolean; n: number }[];
  const s: SourceStats = { pending: 0, flagged: 0, conflicts: 0, approved: 0, rejected: 0, rejectedByKind: {}, filteredSkips: 0 };
  for (const r of rows) {
    if (r.status === "pending") {
      s.pending += r.n;
      if (r.flagged) s.flagged += r.n;
      if (r.conflict) s.conflicts += r.n;
    } else if (r.status === "approved" || r.status === "merged") s.approved += r.n;
    else if (r.status === "rejected") {
      s.rejected += r.n;
      s.rejectedByKind[r.reject_kind ?? "other"] = (s.rejectedByKind[r.reject_kind ?? "other"] ?? 0) + r.n;
    }
  }
  const [skips] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(rawRecords)
    .where(and(eq(rawRecords.sourceId, sourceId), eq(rawRecords.status, "skipped"), like(rawRecords.skipReason, "filter:%")));
  s.filteredSkips = skips?.n ?? 0;
  return s;
}

/** Up to 10 pending items, soonest first, for the source card. */
export async function sourceSample(db: DbExecutor, sourceId: string, limit = 10) {
  return db
    .select()
    .from(eventProposals)
    .where(and(eq(eventProposals.sourceId, sourceId), eq(eventProposals.status, "pending")))
    .orderBy(sql`${eventProposals.facts}->>'startAt'`)
    .limit(limit);
}

async function pendingTitles(db: DbExecutor, sourceId: string) {
  return db
    .select({ id: eventProposals.id, title: sql<string>`${eventProposals.facts}->>'title'`, flags: eventProposals.flags })
    .from(eventProposals)
    .where(and(eq(eventProposals.sourceId, sourceId), eq(eventProposals.status, "pending")));
}

export async function filterSuggestions(db: DbExecutor, source: { id: string; config: unknown }) {
  const titles = (await pendingTitles(db, source.id)).map((r) => r.title);
  return suggestFilters(titles, sourceFilters(source.config).map((f) => f.contains));
}

/**
 * The owner approves a skip rule for a source: it's saved in the source's
 * config (logged), applies to every later fetch, and pending items it matches
 * are rejected as "filtered" now, each logged.
 */
export async function addSourceFilter(db: DbExecutor, sourceId: string, phrase: string, opts: { actor: string }) {
  if (!opts.actor.startsWith("human:")) throw new ReviewError("only the owner approves a filter rule");
  const contains = phrase.trim();
  if (contains.length < 3 || contains.length > 80) throw new ReviewError("a filter phrase is 3 to 80 characters");
  const [before] = await db.select().from(sources).where(eq(sources.id, sourceId));
  if (!before) throw new ReviewError("no such source");
  const filter: SourceFilter = { id: randomUUID().slice(0, 8), contains, approvedBy: opts.actor, approvedAt: new Date().toISOString() };
  await db.transaction(async (tx) => {
    const config = { ...(before.config as Record<string, unknown>), filters: [...sourceFilters(before.config), filter] };
    const [after] = await tx.update(sources).set({ config }).where(eq(sources.id, sourceId)).returning();
    await recordAction(tx, { actor: opts.actor, action: "update", entityType: "source", entityId: sourceId, before, after, reason: `Filter rule for ${before.slug}: skip titles containing "${contains}"` });
  });
  const matched = (await pendingTitles(db, sourceId)).filter((r) => titleMatches(r.title, contains));
  for (const r of matched) await rejectProposal(db, r.id, { actor: opts.actor, reason: `Filter rule: titles containing "${contains}"`, kind: "filtered" });
  return { filter, rejected: matched.length };
}

/**
 * Approves or rejects every pending item of a source whose title contains the
 * phrase, one logged decision each. Bulk approval skips flagged items: those
 * are reviewed one by one.
 */
export async function bulkDecide(db: DbExecutor, sourceId: string, phrase: string, decision: "approve" | "reject", opts: { actor: string; note: string }) {
  if (!opts.actor.startsWith("human:")) throw new ReviewError("only the owner decides in bulk");
  const contains = phrase.trim();
  if (contains.length < 2) throw new ReviewError("give a phrase to match (2+ characters)");
  const items = (await pendingTitles(db, sourceId)).filter((r) => titleMatches(r.title, contains));
  let done = 0;
  let skippedFlagged = 0;
  for (const r of items) {
    if (decision === "approve") {
      if (r.flags.length) {
        skippedFlagged++;
        continue;
      }
      await approveProposal(db, r.id, { actor: opts.actor, note: opts.note || `Bulk approve: titles containing "${contains}"` });
    } else {
      await rejectProposal(db, r.id, { actor: opts.actor, reason: opts.note || `Bulk reject: titles containing "${contains}"`, kind: "other" });
    }
    done++;
  }
  return { done, skippedFlagged, matched: items.length };
}
