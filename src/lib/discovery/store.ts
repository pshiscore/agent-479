import { and, asc, eq, inArray, like } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { feedDiscoveries, organizers, sources } from "@/lib/db/schema";
import { CIVICPLUS_EVENT_URL, CIVICPLUS_ICS } from "@/lib/sources/seed-data";
import { canonicalJson } from "@/lib/venues/seed-file";
import type { Find } from "./discover";

/**
 * Discovery proposals (feed_discoveries): saved by the agent, decided by the
 * owner. Approving one creates a disabled, untested source in `proposed`;
 * the normal test fetch and enable steps follow, and it starts in shadow.
 * Every write is logged.
 */

export class DiscoveryError extends Error {}

type Discovery = typeof feedDiscoveries.$inferSelect;
const COMPARED = ["label", "kind", "platform", "robotsResult", "termsUrl", "termsFlags", "sampleEvents", "suggestedFilters", "notes"] as const;

/**
 * Upserts one organizer's finds. New ones are proposals; known ones get their
 * latest look. A waiting proposal this look didn't find is marked gone
 * (logged), so the queue holds only feeds that work today.
 */
export async function saveFinds(db: DbExecutor, organizerId: string, finds: readonly Find[], opts: { actor: string; runId: string | null; now?: Date; complete?: boolean }) {
  const now = opts.now ?? new Date();
  const stats = { proposed: 0, refreshed: 0, gone: 0 };
  // Only a complete look can say a feed is gone.
  const waiting = opts.complete === false ? [] : await db.select().from(feedDiscoveries).where(and(eq(feedDiscoveries.organizerId, organizerId), eq(feedDiscoveries.status, "proposed")));
  for (const w of waiting.filter((w) => !finds.some((f) => f.url === w.url))) {
    await db.transaction(async (tx) => {
      const [after] = await tx.update(feedDiscoveries).set({ status: "gone", updatedAt: now }).where(eq(feedDiscoveries.id, w.id)).returning();
      await recordAction(tx, { actor: opts.actor, runId: opts.runId, action: "update", entityType: "feed_discovery", entityId: w.id, before: w, after, reason: "Not found as a working feed on the latest look" });
    });
    stats.gone++;
  }
  for (const f of finds) {
    const values = { label: f.label, kind: f.kind, platform: f.platform, robotsResult: f.robotsResult, robotsCheckedAt: f.robotsCheckedAt, termsUrl: f.termsUrl, termsFlags: f.termsFlags, sampleEvents: f.sampleEvents, suggestedFilters: f.suggestedFilters, notes: f.notes };
    await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(feedDiscoveries).where(and(eq(feedDiscoveries.organizerId, organizerId), eq(feedDiscoveries.url, f.url)));
      if (!existing) {
        const [row] = await tx.insert(feedDiscoveries).values({ organizerId, url: f.url, ...values, firstSeenAt: now, lastSeenAt: now, runId: opts.runId }).returning();
        await recordAction(tx, { actor: opts.actor, runId: opts.runId, action: "insert", entityType: "feed_discovery", entityId: row.id, after: row, reason: `Discovered ${f.kind} feed "${f.label}" (robots: ${f.robotsResult})` });
        stats.proposed++;
        return;
      }
      const changed = COMPARED.filter((k) => canonicalJson(existing[k] ?? null) !== canonicalJson(values[k] ?? null));
      const [after] = await tx.update(feedDiscoveries).set({ ...values, lastSeenAt: now, updatedAt: now }).where(eq(feedDiscoveries.id, existing.id)).returning();
      await recordAction(tx, { actor: opts.actor, runId: opts.runId, action: "update", entityType: "feed_discovery", entityId: existing.id, before: existing, after, reason: changed.length ? `Seen again; changed: ${changed.join(", ")}` : "Seen again" });
      stats.refreshed++;
    });
  }
  return stats;
}

/** Public .gov calendar feeds published for subscribing get one-click approval (owner, 2026-10-16). */
export function oneClick(d: Pick<Discovery, "url" | "kind" | "robotsResult" | "termsFlags">): boolean {
  return /\.gov$/i.test(new URL(d.url).hostname) && (d.kind === "ics" || d.kind === "rss") && d.robotsResult === "allowed" && d.termsFlags.length === 0;
}

const SOURCE_KIND = { ics: "ics", rss: "rss", events_api: "api", page_data: "html", html: "html" } as const;

async function freeSlug(db: DbExecutor, base: string): Promise<string> {
  const taken = new Set((await db.select({ slug: sources.slug }).from(sources).where(like(sources.slug, `${base}%`))).map((s) => s.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

async function loadProposed(db: DbExecutor, id: string) {
  const [d] = await db.select().from(feedDiscoveries).where(eq(feedDiscoveries.id, id)).for("update");
  if (!d) throw new DiscoveryError("no such discovery");
  if (d.status !== "proposed") throw new DiscoveryError(`already ${d.status}`);
  return d;
}

export async function approveDiscovery(db: DbExecutor, id: string, opts: { actor: string; note?: string; now?: Date }) {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const d = await loadProposed(tx, id);
    if (d.robotsResult === "disallowed") throw new DiscoveryError("robots.txt disallows this feed; it can't be approved");
    const note = opts.note?.trim() ?? "";
    if (!oneClick(d) && note.length < 3) throw new DiscoveryError("say why the terms are fine (only public .gov feeds with no flagged terms are one click)");
    const [org] = await tx.select().from(organizers).where(eq(organizers.id, d.organizerId));
    const url = new URL(d.url);
    const cat = d.platform === "civicplus" ? url.searchParams.get("catID") : null;
    const slug = await freeSlug(tx, cat ? `${org.slug}-cat${cat}` : `${org.slug}-${d.kind.replace("_", "-")}`);
    const config: Record<string, unknown> = cat ? { icsPath: CIVICPLUS_ICS, catIds: [Number(cat)], eventUrl: CIVICPLUS_EVENT_URL } : d.kind === "ics" ? { feedUrl: d.url } : { pageUrl: d.url };
    const termsNotes = [
      `Found by discovery ${d.firstSeenAt.toISOString().slice(0, 10)} on ${org.name}'s site; robots.txt allowed this address when checked ${d.robotsCheckedAt.toISOString().slice(0, 10)}.`,
      d.termsUrl ? `Terms page: ${d.termsUrl}${d.termsFlags.length ? ` (flagged: ${d.termsFlags.join(", ")})` : " (no flagged phrases)"}.` : "No terms page found.",
      note ? `Owner: ${note}` : "Approved as a public .gov feed (one click).",
      "Facts and links only.",
    ].join(" ");
    const [source] = await tx
      .insert(sources)
      .values({
        slug,
        name: `${org.name}: ${d.label ?? d.kind}`.slice(0, 200),
        kind: SOURCE_KIND[d.kind],
        // iCal and event data on a page (JSON-LD, step 7) have fetchers; RSS and the rest don't yet.
        fetcher: d.kind === "ics" ? "ics" : d.kind === "page_data" ? "jsonld" : null,
        baseUrl: org.website ?? `${url.origin}/`,
        config,
        trustLevel: 3,
        fetchIntervalMinutes: 24 * 60,
        commercialUseOk: "unknown",
        termsNotes,
        enabled: false,
        disabledReason: "untested",
        publishState: "proposed",
        publishStateSince: now,
      })
      .returning();
    await recordAction(tx, { actor: opts.actor, action: "insert", entityType: "source", entityId: source.id, after: source, reason: `Approved discovery ${d.id}: ${source.name}` });
    const [after] = await tx.update(feedDiscoveries).set({ status: "approved", sourceId: source.id, decidedAt: now, decidedBy: opts.actor, decisionNote: note || "one click (public .gov feed)", updatedAt: now }).where(eq(feedDiscoveries.id, d.id)).returning();
    await recordAction(tx, { actor: opts.actor, action: "update", entityType: "feed_discovery", entityId: d.id, before: d, after, reason: `Approved; source ${slug} created (disabled, untested)` });
    const channel = d.kind === "page_data" ? "structured_page" : "feed";
    if (org.channel === "unknown" || (channel === "feed" && org.channel !== "feed")) {
      const [orgAfter] = await tx.update(organizers).set({ channel, updatedAt: now }).where(eq(organizers.id, org.id)).returning();
      await recordAction(tx, { actor: opts.actor, action: "update", entityType: "organizer", entityId: org.id, before: org, after: orgAfter, reason: `Publishes by ${channel} (approved discovery)` });
    }
    return { source, discovery: after };
  });
}

export async function rejectDiscovery(db: DbExecutor, id: string, opts: { actor: string; note: string; now?: Date }) {
  const now = opts.now ?? new Date();
  if (opts.note.trim().length < 3) throw new DiscoveryError("say why");
  return db.transaction(async (tx) => {
    const d = await loadProposed(tx, id);
    const [after] = await tx.update(feedDiscoveries).set({ status: "rejected", decidedAt: now, decidedBy: opts.actor, decisionNote: opts.note.trim(), updatedAt: now }).where(eq(feedDiscoveries.id, d.id)).returning();
    await recordAction(tx, { actor: opts.actor, action: "update", entityType: "feed_discovery", entityId: d.id, before: d, after, reason: `Rejected: ${opts.note.trim()}` });
    return after;
  });
}

/** Waiting proposals with their organizer, grouped in the page by organizer. */
export async function proposedDiscoveries(db: DbExecutor) {
  return db
    .select({ d: feedDiscoveries, orgName: organizers.name, orgSlug: organizers.slug })
    .from(feedDiscoveries)
    .innerJoin(organizers, eq(organizers.id, feedDiscoveries.organizerId))
    .where(eq(feedDiscoveries.status, "proposed"))
    .orderBy(asc(organizers.name), asc(feedDiscoveries.createdAt));
}

export async function recentDecisions(db: DbExecutor, limit = 20) {
  const rows = await db
    .select({ d: feedDiscoveries, orgName: organizers.name, sourceSlug: sources.slug })
    .from(feedDiscoveries)
    .innerJoin(organizers, eq(organizers.id, feedDiscoveries.organizerId))
    .leftJoin(sources, eq(sources.id, feedDiscoveries.sourceId))
    .where(inArray(feedDiscoveries.status, ["approved", "rejected"]));
  return rows.sort((a, b) => (b.d.decidedAt?.getTime() ?? 0) - (a.d.decidedAt?.getTime() ?? 0)).slice(0, limit);
}
