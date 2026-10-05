import { and, asc, desc, eq, gte, inArray, like, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { recordAction } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import {
  categories,
  eventProposals,
  type ProposalSource,
  type ProposedEvent,
  PROPOSAL_ORIGINS,
  REVIEW_REASONS,
  eventDays,
  eventSources,
  events,
  eventTags,
  sources,
  tags,
  venues,
} from "@/lib/db/schema";
import { priceText } from "@/lib/pipeline/enrich";
import { CODE_SET_TAGS } from "@/lib/pipeline/enrich/classify";
import { tokenSetRatio, trigramSimilarity } from "@/lib/pipeline/dedup/score";
import { slugify } from "@/lib/slug";
import { chicagoDate, chicagoToUtc, formatDate, parseDate } from "@/lib/time";
import { isTicketingUrl } from "@/lib/ticketing";
import { normalizeVenueName } from "@/lib/venues/normalize";

/**
 * The review queue (AGENTS.md, "Festivals and the review queue"). Fail
 * closed: a proposal is never public; only the owner's approval writes the
 * event. Approving, editing and approving, rejecting, merging, and adding a
 * checked source are owner actions, each logged with before and after.
 *
 * Events the owner approves come from the "owner" source: a source row that is
 * never fetched (disabled, reason manual), so every event still has a
 * primary source and its proposal id as the external id.
 */

export class ReviewError extends Error {}

type Proposal = typeof eventProposals.$inferSelect;
type Reason = (typeof REVIEW_REASONS)[number];

export const OWNER_SOURCE_SLUG = "owner";
const DAY = 86_400_000;
const today = (now = new Date()) => now.toISOString().slice(0, 10);
const url = z
  .string()
  .trim()
  .url()
  .refine((u) => /^https?:\/\//.test(u), "must be a web address");
const iso = z.iso.datetime({ offset: true });
const chicagoDay = (d: Date) => formatDate(chicagoDate(d));
const wall = (day: string, hm: string | null) => (hm ? chicagoToUtc(parseDate(day), { hour: Number(hm.slice(0, 2)), minute: Number(hm.slice(3)) }) : null);

/** The facts an approved event needs. A proposal may lack venue or category until the owner fills them in. */
export const proposedEventSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    startAt: iso,
    endAt: iso.nullable(),
    allDay: z.boolean(),
    venueId: z.uuid().nullable(),
    subSpace: z.string().trim().min(1).max(120).nullable(),
    categoryId: z.uuid().nullable(),
    isFree: z.boolean().nullable(),
    priceMin: z.number().min(0).max(100_000).nullable(),
    priceMax: z.number().min(0).max(100_000).nullable(),
    ageMin: z.number().int().min(0).max(120).nullable(),
    ageMax: z.number().int().min(0).max(120).nullable(),
    registrationRequired: z.boolean().nullable(),
    inSpanish: z.boolean(),
    tagSlugs: z.array(z.string().regex(/^[a-z0-9-]+$/)).max(10),
    ticketUrl: url.nullable(),
    moreInfoUrl: url,
    dailyHours: z
      .array(
        z.object({
          day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          opens: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
          closes: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
        }),
      )
      .max(60)
      .default([]),
  })
  .superRefine((f, ctx) => {
    if (f.endAt && Date.parse(f.endAt) < Date.parse(f.startAt)) ctx.addIssue({ code: "custom", path: ["endAt"], message: "the end is before the start" });
    if (f.ageMin !== null && f.ageMax !== null && f.ageMax < f.ageMin) ctx.addIssue({ code: "custom", path: ["ageMax"], message: "age range is backwards" });
    if (f.priceMin !== null && f.priceMax !== null && f.priceMax < f.priceMin) ctx.addIssue({ code: "custom", path: ["priceMax"], message: "price range is backwards" });
    if (f.isFree && (f.priceMin ?? 0) > 0) ctx.addIssue({ code: "custom", path: ["isFree"], message: "free, but with a price" });
    const first = chicagoDay(new Date(f.startAt));
    const last = f.endAt ? chicagoDay(new Date(f.endAt)) : first;
    const seen = new Set<string>();
    for (const h of f.dailyHours) {
      if (seen.has(h.day)) ctx.addIssue({ code: "custom", path: ["dailyHours"], message: `${h.day} is listed twice` });
      seen.add(h.day);
      if (h.day < first || h.day > last) ctx.addIssue({ code: "custom", path: ["dailyHours"], message: `${h.day} is outside the event's dates (${first} to ${last})` });
      if (h.opens && h.closes && h.closes <= h.opens) ctx.addIssue({ code: "custom", path: ["dailyHours"], message: `${h.day} closes before it opens` });
    }
    for (const t of f.tagSlugs) if (CODE_SET_TAGS.has(t)) ctx.addIssue({ code: "custom", path: ["tagSlugs"], message: `"${t}" is set from the facts, not picked` });
  });

const sourceSchema = z.object({
  url,
  fetchedAt: z.string().optional(),
  checkedAt: z.string().optional(),
  verifiedBy: z.literal("owner").optional(),
  confirmed: z.string().trim().min(3).max(500).optional(),
  sourceId: z.uuid().optional(),
  note: z.string().max(300).optional(),
});

const ownerOnly = (actor: string, what: string) => {
  if (!actor.startsWith("human:")) throw new ReviewError(`only the owner can ${what}`);
};

/** The never-fetched source behind owner-approved events, created (and logged) on first use. */
export async function ownerSourceId(db: DbExecutor, actor: string): Promise<string> {
  const [found] = await db.select({ id: sources.id }).from(sources).where(eq(sources.slug, OWNER_SOURCE_SLUG));
  if (found) return found.id;
  const [row] = await db
    .insert(sources)
    .values({
      slug: OWNER_SOURCE_SLUG,
      name: "Added by the owner",
      kind: null,
      fetcher: null,
      baseUrl: "https://479.guide/",
      trustLevel: 5,
      enabled: false,
      disabledReason: "manual",
      fetchIntervalMinutes: 1440,
      termsNotes: "Events the owner adds or approves in /admin/review, each from a page they checked. Never fetched.",
    })
    .returning();
  await recordAction(db, { actor, action: "insert", entityType: "source", entityId: row.id, after: row, reason: "Source for owner-approved events (never fetched)" });
  return row.id;
}

/** Events that may be the same: within a day and a half of the start, with a similar title. Best first. */
export async function likelyMatches(db: DbExecutor, f: Pick<ProposedEvent, "title" | "startAt" | "venueId">, limit = 3) {
  const start = Date.parse(f.startAt);
  const near = await db
    .select({ id: events.id, title: events.title, startAt: events.startAt, venueId: events.venueId, slug: events.slug })
    .from(events)
    .where(and(gte(events.startAt, new Date(start - 1.5 * DAY)), lte(events.startAt, new Date(start + 1.5 * DAY)), inArray(events.status, ["scheduled", "postponed", "cancelled"])));
  return near
    .map((e) => ({ ...e, score: Math.max(tokenSetRatio(f.title, e.title), trigramSimilarity(f.title, e.title)) + (f.venueId && e.venueId === f.venueId ? 0.1 : 0) }))
    .filter((e) => e.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function createProposal(
  db: DbExecutor,
  input: { facts: ProposedEvent; sources: ProposalSource[]; origin: (typeof PROPOSAL_ORIGINS)[number]; reasons: Reason[] },
  opts: { actor: string; runId?: string | null },
): Promise<Proposal> {
  const facts = proposedEventSchema.parse(input.facts);
  const srcs = z.array(sourceSchema).min(1, "a proposal needs at least one source").parse(input.sources);
  const reasons = z.array(z.enum(REVIEW_REASONS)).min(1, "say why it's in review").parse([...new Set(input.reasons)]);
  return db.transaction(async (tx) => {
    const [match] = await likelyMatches(tx, facts, 1);
    const [row] = await tx
      .insert(eventProposals)
      .values({ origin: input.origin, reasons, facts, sources: srcs, matchEventId: match?.id ?? null, runId: opts.runId ?? null })
      .returning();
    await recordAction(tx, { actor: opts.actor, runId: opts.runId, action: "insert", entityType: "event_proposal", entityId: row.id, after: row, reason: `In review: ${reasons.join(", ")}` });
    return row;
  });
}

async function loadPending(db: DbExecutor, id: string): Promise<Proposal> {
  const [p] = await db.select().from(eventProposals).where(eq(eventProposals.id, id)).for("update");
  if (!p) throw new ReviewError("no such proposal");
  if (p.status !== "pending") throw new ReviewError(`already ${p.status}`);
  return p;
}

async function decide(db: DbExecutor, before: Proposal, set: Partial<Proposal>, log: { actor: string; reason: string }) {
  const [after] = await db
    .update(eventProposals)
    .set({ ...set, decidedAt: new Date(), decidedBy: log.actor, updatedAt: new Date() })
    .where(eq(eventProposals.id, before.id))
    .returning();
  await recordAction(db, { actor: log.actor, action: "update", entityType: "event_proposal", entityId: before.id, before, after, reason: log.reason });
  return after;
}

/** Tag ids for an event: the owner's picks plus the ones code owns, from the facts. */
async function tagIdsFor(db: DbExecutor, f: ProposedEvent): Promise<string[]> {
  const slugs = new Set(f.tagSlugs);
  const adultsOnly = (f.ageMin ?? 0) >= 21;
  if (f.isFree) slugs.add("free");
  if (adultsOnly) {
    slugs.add("21-plus");
    slugs.delete("family-friendly");
  }
  if (f.registrationRequired) slugs.add("registration-required");
  if (isTicketingUrl(f.ticketUrl)) slugs.add("ticketed");
  if (f.inSpanish) slugs.add("en-espanol");
  if (slugs.size === 0) return [];
  const rows = await db.select({ id: tags.id, slug: tags.slug }).from(tags).where(and(inArray(tags.slug, [...slugs]), eq(tags.active, true)));
  return rows.map((r) => r.id).sort();
}

async function uniqueEventSlug(db: DbExecutor, title: string, startAt: string): Promise<string> {
  const base = `${slugify(title)}-${startAt.slice(0, 10)}`;
  const taken = new Set((await db.select({ slug: events.slug }).from(events).where(like(events.slug, `${base}%`))).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * Approves a proposal, optionally with the owner's edits: writes the event
 * (with tags and its owner source row), logged as an insert, and marks the
 * proposal approved, logged with before and after.
 */
export async function approveProposal(db: DbExecutor, id: string, opts: { actor: string; note?: string; edits?: Partial<ProposedEvent>; now?: Date }) {
  ownerOnly(opts.actor, "approve an event");
  return db.transaction(async (tx) => {
    const before = await loadPending(tx, id);
    const f = proposedEventSchema.parse({ ...before.facts, ...(opts.edits ?? {}) });
    if (!f.venueId) throw new ReviewError("choose a venue first (a new venue goes through the venue process)");
    if (!f.categoryId) throw new ReviewError("choose a category first");
    const [venue] = await tx.select().from(venues).where(and(eq(venues.id, f.venueId), eq(venues.active, true)));
    if (!venue) throw new ReviewError("that venue is inactive or unknown");
    const [category] = await tx.select().from(categories).where(and(eq(categories.id, f.categoryId), eq(categories.active, true)));
    if (!category) throw new ReviewError("that category is retired or unknown");

    const now = opts.now ?? new Date();
    const sourceId = await ownerSourceId(tx, opts.actor);
    const [event] = await tx
      .insert(events)
      .values({
        slug: await uniqueEventSlug(tx, f.title, f.startAt),
        title: f.title,
        normalizedTitle: normalizeVenueName(f.title),
        startAt: new Date(f.startAt),
        endAt: f.endAt ? new Date(f.endAt) : null,
        allDay: f.allDay,
        venueId: f.venueId,
        subSpace: f.subSpace,
        categoryId: f.categoryId,
        isFree: f.isFree,
        freeBasis: f.isFree ? "stated" : null,
        ageMin: f.ageMin,
        ageMax: f.ageMax,
        registrationRequired: f.registrationRequired,
        priceMin: f.priceMin,
        priceMax: f.priceMax,
        priceText: priceText(f.priceMin, f.priceMax, f.isFree),
        primarySourceUrl: f.moreInfoUrl,
        ticketUrl: f.ticketUrl,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning();
    const tagIds = await tagIdsFor(tx, f);
    if (tagIds.length) await tx.insert(eventTags).values(tagIds.map((tagId) => ({ eventId: event.id, tagId })));
    const days = f.dailyHours.length
      ? await tx
          .insert(eventDays)
          .values(f.dailyHours.map((h) => ({ eventId: event.id, day: h.day, opensAt: wall(h.day, h.opens), closesAt: wall(h.day, h.closes) })))
          .returning()
      : [];
    await tx.insert(eventSources).values({ eventId: event.id, sourceId, externalId: `proposal:${id}`, sourceUrl: f.moreInfoUrl, ticketUrl: f.ticketUrl, isPrimary: true, firstSeenAt: now, lastSeenAt: now });
    const edited = opts.edits && Object.keys(opts.edits).length > 0;
    await recordAction(tx, {
      actor: opts.actor,
      action: "insert",
      entityType: "event",
      entityId: event.id,
      after: { ...event, tagIds, days, _meta: { proposalId: id, sources: before.sources } },
      reason: `Approved from review${edited ? " with edits" : ""}: ${opts.note || "no note"}`,
    });
    const proposal = await decide(tx, before, { status: "approved", eventId: event.id, facts: f, decisionNote: opts.note || null }, {
      actor: opts.actor,
      reason: `Approved${edited ? ` with edits to ${Object.keys(opts.edits!).join(", ")}` : ""}: ${opts.note || "no note"}`,
    });
    return { event, proposal };
  });
}

export async function rejectProposal(db: DbExecutor, id: string, opts: { actor: string; reason: string }) {
  ownerOnly(opts.actor, "reject a proposal");
  const reason = z.string().trim().min(3, "give a reason").max(500).parse(opts.reason);
  return db.transaction(async (tx) => decide(tx, await loadPending(tx, id), { status: "rejected", decisionNote: reason }, { actor: opts.actor, reason: `Rejected: ${reason}` }));
}

/**
 * Merges a proposal into an existing event: the proposal's official page
 * becomes another source of that event. The event's fields don't change.
 */
export async function mergeProposal(db: DbExecutor, id: string, eventId: string, opts: { actor: string; note?: string }) {
  ownerOnly(opts.actor, "merge a proposal");
  return db.transaction(async (tx) => {
    const before = await loadPending(tx, id);
    const [target] = await tx.select().from(events).where(and(eq(events.id, eventId), ne(events.status, "merged")));
    if (!target) throw new ReviewError("no such event (or it was merged away)");
    const sourceId = await ownerSourceId(tx, opts.actor);
    const now = new Date();
    const [link] = await tx
      .insert(eventSources)
      .values({ eventId, sourceId, externalId: `proposal:${id}`, sourceUrl: before.facts.moreInfoUrl, ticketUrl: before.facts.ticketUrl, isPrimary: false, firstSeenAt: now, lastSeenAt: now })
      .returning();
    await recordAction(tx, { actor: opts.actor, action: "insert", entityType: "event_source", entityId: link.id, after: link, reason: `Merged review item into "${target.title}": ${opts.note || "no note"}` });
    const proposal = await decide(tx, before, { status: "merged", eventId, decisionNote: opts.note || null }, { actor: opts.actor, reason: `Merged into event ${target.slug}: ${opts.note || "no note"}` });
    return { event: target, proposal };
  });
}

/** The owner found the official page (e.g. through "Search the web"): record it as owner-verified. */
export async function addCheckedSource(db: DbExecutor, id: string, opts: { actor: string; url: string; confirmed: string; now?: Date }) {
  ownerOnly(opts.actor, "verify a source");
  const src = sourceSchema.parse({ url: opts.url, confirmed: opts.confirmed, verifiedBy: "owner", checkedAt: today(opts.now) });
  return db.transaction(async (tx) => {
    const before = await loadPending(tx, id);
    const sourcesAfter = [...before.sources.filter((s) => s.url !== src.url), src];
    const [after] = await tx.update(eventProposals).set({ sources: sourcesAfter, updatedAt: new Date() }).where(eq(eventProposals.id, id)).returning();
    await recordAction(tx, { actor: opts.actor, action: "update", entityType: "event_proposal", entityId: id, before, after, reason: `Owner verified ${src.url}: ${src.confirmed}` });
    return after;
  });
}

export async function pendingProposals(db: DbExecutor) {
  return db.select().from(eventProposals).where(eq(eventProposals.status, "pending")).orderBy(asc(eventProposals.createdAt));
}

export async function recentDecisions(db: DbExecutor, limit = 20) {
  return db.select().from(eventProposals).where(ne(eventProposals.status, "pending")).orderBy(desc(eventProposals.decidedAt)).limit(limit);
}

export async function proposalById(db: DbExecutor, id: string) {
  const [p] = await db.select().from(eventProposals).where(eq(eventProposals.id, id));
  return p ?? null;
}

/** "Search the web": an ordinary search link for the owner's browser. Nothing is fetched. */
export const webSearchUrl = (title: string, city: string | null) => `https://www.google.com/search?q=${encodeURIComponent([title, city].filter(Boolean).join(" "))}`;
