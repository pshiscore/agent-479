import { and, desc, eq, like } from "drizzle-orm";
import { z } from "zod";
import { agentActor, recordAction } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { ADDRESS_KINDS, PLACE_KINDS, PLACE_TYPES, type PlaceSource, places, venues } from "@/lib/db/schema";
import { describePlace, placeFacts } from "@/lib/places/describe";
import { categoryForType } from "@/lib/places/format";
import type { Generate } from "@/lib/pipeline/enrich/types";
import { slugify } from "@/lib/slug";
import { namesMatchClosely } from "@/lib/venues/normalize";
import { sameStreetAddress } from "@/lib/venues/street";

/**
 * New in Town admin (docs/product/front-page.md, H): add, edit, confirm a
 * source, publish, hide, and link a venue. Every change is logged. Rules:
 * - Entries the owner adds are owner-verified.
 * - Publishing needs: open to the public, a stated opening date (open) or a
 *   stated target (opening soon), and an owner-verified source.
 * - Venue links are suggested, never automatic.
 */

export class PlaceError extends Error {}

type PlaceRow = typeof places.$inferSelect;
const today = (now = new Date()) => now.toISOString().slice(0, 10);
const https = z.string().trim().url().refine((u) => u.startsWith("https://") || u.startsWith("http://"), "must be a web address");
const optional = <T extends z.ZodType>(t: T) => z.preprocess((v) => (v === "" || v === null ? undefined : v), t.optional());

/** A date as the source states it: a day (YYYY-MM-DD) or a month (YYYY-MM, stored as the 1st). */
const statedDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}(-\d{2})?$/, "use YYYY-MM-DD or YYYY-MM")
  .transform((v) => (v.length === 7 ? { on: `${v}-01`, precision: "month" as const } : { on: v, precision: "day" as const }));

export const placeInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  placeType: z.enum(PLACE_TYPES),
  kind: z.enum(PLACE_KINDS),
  address: z.string().trim().min(3).max(200),
  addressKind: z.enum(ADDRESS_KINDS).default("street"),
  streetNumberUnconfirmed: z.boolean().default(false),
  city: z.string().trim().min(2).max(60),
  postalCode: optional(z.string().trim().regex(/^\d{5}$/)),
  opened: optional(statedDate),
  openedQualifier: optional(z.string().trim().max(40)),
  target: optional(statedDate),
  targetQualifier: optional(z.string().trim().max(40)),
  website: optional(https),
  sourceUrl: optional(https),
  extraSourceUrls: z.array(https).default([]),
  confirmed: optional(z.string().trim().min(3).max(500)),
  notes: optional(z.string().trim().max(1000)),
  openToPublic: z.boolean().nullable().default(null),
});
export type PlaceInput = z.input<typeof placeInputSchema>;

async function uniqueSlug(db: DbExecutor, name: string, city: string): Promise<string> {
  const base = slugify(`${name} ${city}`) || "place";
  const taken = new Set((await db.select({ slug: places.slug }).from(places).where(like(places.slug, `${base}%`))).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

function fields(v: z.output<typeof placeInputSchema>) {
  return {
    name: v.name,
    placeType: v.placeType,
    category: categoryForType(v.placeType),
    kind: v.kind,
    address: v.address,
    // Food trucks are listed only with a stated home base (the database checks it).
    addressKind: v.placeType === "food_truck" ? ("home_base" as const) : v.addressKind === "home_base" ? ("street" as const) : v.addressKind,
    streetNumberUnconfirmed: v.addressKind === "intersection" ? true : v.streetNumberUnconfirmed,
    city: v.city,
    postalCode: v.postalCode ?? null,
    openedOn: v.opened?.on ?? null,
    openedPrecision: v.opened?.precision ?? null,
    openedQualifier: v.opened ? (v.openedQualifier ?? null) : null,
    targetOn: v.target?.on ?? null,
    targetPrecision: v.target?.precision ?? null,
    targetQualifier: v.target ? (v.targetQualifier ?? null) : null,
    website: v.website ?? null,
    notes: v.notes ?? null,
    openToPublic: v.openToPublic,
  };
}

/**
 * Adds a place as a draft. With `ownerVerified`, its source is recorded as
 * the owner's browser check; otherwise (research leads) it's unverified.
 */
export async function createPlace(
  db: DbExecutor,
  input: PlaceInput,
  opts: { actor: string; ownerVerified: boolean; reason: string; sourceNote?: string; now?: Date },
) {
  const v = placeInputSchema.parse(input);
  const urls = [v.sourceUrl, ...v.extraSourceUrls].filter((u): u is string => Boolean(u));
  const sources: PlaceSource[] = urls.map((url) =>
    opts.ownerVerified
      ? { url, checkedAt: today(opts.now), verifiedBy: "owner", confirmed: v.confirmed ?? "Entered by the owner from this source" }
      : { url, note: opts.sourceNote ?? "lead" },
  );
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(places)
      .values({ ...fields(v), slug: await uniqueSlug(tx, v.name, v.city), status: "draft", sources })
      .returning();
    await recordAction(tx, { actor: opts.actor, action: "insert", entityType: "place", entityId: row.id, after: row, reason: opts.reason });
    return row;
  });
}

async function load(db: DbExecutor, id: string): Promise<PlaceRow> {
  const [p] = await db.select().from(places).where(eq(places.id, id));
  if (!p) throw new PlaceError("no such place");
  return p;
}

async function change(db: DbExecutor, before: PlaceRow, set: Partial<PlaceRow>, log: { actor: string; action: "update" | "publish"; reason: string }) {
  const [after] = await db.update(places).set({ ...set, updatedAt: new Date() }).where(eq(places.id, before.id)).returning();
  await recordAction(db, { actor: log.actor, action: log.action, entityType: "place", entityId: before.id, before, after, reason: log.reason });
  return after;
}

/** Edits a place's facts. A published place stays published only while it still qualifies (the database checks). */
export async function updatePlace(db: DbExecutor, id: string, input: PlaceInput, opts: { actor: string; reason: string }) {
  const v = placeInputSchema.parse(input);
  return db.transaction(async (tx) => {
    const before = await load(tx, id);
    const { notes, ...rest } = fields(v);
    return change(tx, before, { ...rest, notes }, { actor: opts.actor, action: "update", reason: opts.reason });
  });
}

/** Stated facts, one per line, in the owner's words: at most 6, each 3 to 200 characters. */
const statedFacts = z.array(z.string().trim().min(3).max(200)).max(6);
export const parseFacts = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

const factsKey = (sources: PlaceSource[]) => JSON.stringify(sources.filter((s) => s.verifiedBy === "owner").flatMap((s) => s.facts ?? []).sort());

/**
 * The owner checked a source in the browser: record it as owner-verified,
 * with what they saw and any other facts it states (for the description).
 * If the stated facts change, a description written from the old ones is
 * removed in the same logged update.
 */
export async function confirmSource(
  db: DbExecutor,
  id: string,
  opts: { actor: string; url: string; confirmed: string; openToPublic: boolean; facts?: string[]; now?: Date },
) {
  if (!opts.actor.startsWith("human:")) throw new PlaceError("only the owner verifies a source");
  const url = https.parse(opts.url);
  const confirmed = z.string().trim().min(3).max(500).parse(opts.confirmed);
  const facts = statedFacts.parse(opts.facts ?? []);
  return db.transaction(async (tx) => {
    const before = await load(tx, id);
    const others = before.sources.filter((s) => s.url !== url);
    const sources: PlaceSource[] = [...others, { url, checkedAt: today(opts.now), verifiedBy: "owner", confirmed, ...(facts.length ? { facts } : {}) }];
    const stale = before.description !== null && factsKey(sources) !== factsKey(before.sources);
    return change(tx, before, { sources, openToPublic: opts.openToPublic, ...(stale ? { description: null, descriptionGeneratedAt: null } : {}) }, {
      actor: opts.actor,
      action: "update",
      reason: `Owner verified ${url}: ${confirmed}${facts.length ? `; stated facts: ${facts.join("; ")}` : ""}${opts.openToPublic ? "; open to the public" : "; NOT confirmed open to the public"}${stale ? "; description removed (facts changed)" : ""}`,
    });
  });
}

/**
 * Writes the description from the stated facts, at the owner's request. The
 * write is an agent action (it carries the model and LLM call), with the
 * owner's request in the reason. Held drafts are logged and never stored.
 */
export async function writePlaceDescription(db: DbExecutor, id: string, opts: { requestedBy: string; generate: Generate; now?: Date }) {
  if (!opts.requestedBy.startsWith("human:")) throw new PlaceError("only the owner asks for a place description");
  const actor = agentActor("place-describe");
  const place = await load(db, id);
  const r = await describePlace(opts.generate, placeFacts(place));
  return db.transaction(async (tx) => {
    const before = await load(tx, id);
    if (r.status === "ok") {
      const [after] = await tx
        .update(places)
        .set({ description: r.description, descriptionGeneratedAt: opts.now ?? new Date(), updatedAt: new Date() })
        .where(eq(places.id, id))
        .returning();
      await recordAction(tx, {
        actor,
        action: "update",
        entityType: "place",
        entityId: id,
        before,
        after,
        reason: `Description written at ${opts.requestedBy}'s request from stated facts: ${r.usedFacts.join("; ")}`,
        model: r.model,
        llmCallId: r.callId,
      });
      return r;
    }
    if (r.status === "held") {
      await recordAction(tx, { actor, action: "hold", entityType: "place", entityId: id, reason: `Description held after ${r.attempts} drafts: ${r.problem}`, model: r.model, llmCallId: r.callId });
    }
    return r;
  });
}

/** The owner removes a description. */
export async function removePlaceDescription(db: DbExecutor, id: string, opts: { actor: string; reason: string }) {
  if (!opts.actor.startsWith("human:")) throw new PlaceError("only the owner removes a description");
  return db.transaction(async (tx) => {
    const before = await load(tx, id);
    if (!before.description) throw new PlaceError("no description to remove");
    return change(tx, before, { description: null, descriptionGeneratedAt: null }, { actor: opts.actor, action: "update", reason: `Description removed: ${opts.reason}` });
  });
}

/** What still stands between a place and publishing; empty when it can go live. */
export function publishBlockers(p: Pick<PlaceRow, "openToPublic" | "openedOn" | "targetOn" | "sources" | "status">): string[] {
  const out: string[] = [];
  if (p.openToPublic !== true) out.push("not confirmed open to the public");
  if (!p.openedOn && !p.targetOn) out.push("no stated opening date (or target date for opening soon)");
  if (!p.sources.some((s) => s.verifiedBy === "owner")) out.push("no owner-verified source");
  if (p.status === "open" || p.status === "opening_soon") out.push("already published");
  return out;
}

export async function publishPlace(db: DbExecutor, id: string, opts: { actor: string; note: string; now?: Date }) {
  if (!opts.actor.startsWith("human:")) throw new PlaceError("only the owner publishes places");
  return db.transaction(async (tx) => {
    const before = await load(tx, id);
    const blockers = publishBlockers(before);
    if (blockers.length) throw new PlaceError(`can't publish: ${blockers.join("; ")}`);
    const status = before.openedOn ? "open" : "opening_soon";
    return change(tx, before, { status, publishedAt: opts.now ?? new Date(), hiddenAt: null, hiddenReason: null }, {
      actor: opts.actor,
      action: "publish",
      reason: `Published as ${status === "open" ? "now open" : "opening soon"}: ${opts.note}`,
    });
  });
}

/** Takes a place off the site (or keeps a draft from ever showing), with a reason. */
export async function hidePlace(db: DbExecutor, id: string, opts: { actor: string; reason: string; now?: Date }) {
  const reason = z.string().trim().min(3).max(300).parse(opts.reason);
  return db.transaction(async (tx) => {
    const before = await load(tx, id);
    if (before.status === "hidden") throw new PlaceError("already hidden");
    return change(tx, before, { status: "hidden", hiddenAt: opts.now ?? new Date(), hiddenReason: reason }, { actor: opts.actor, action: "update", reason: `Hidden: ${reason}` });
  });
}

/** Venues that may be the same place: same street address or a close name, in the same city. Suggestions only. */
export async function suggestVenues(db: DbExecutor, p: Pick<PlaceRow, "name" | "address" | "city">) {
  const rows = await db.select().from(venues).where(and(eq(venues.active, true)));
  return rows
    .filter((v) => v.city.toLowerCase() === p.city.toLowerCase())
    .map((v) => ({
      venue: { id: v.id, slug: v.slug, name: v.name, address: v.address },
      byAddress: Boolean(v.address && sameStreetAddress(p.address, v.address)),
      byName: namesMatchClosely(p.name, v),
    }))
    .filter((m) => m.byAddress || m.byName);
}

export async function linkVenue(db: DbExecutor, id: string, venueId: string | null, opts: { actor: string; reason: string }) {
  if (!opts.actor.startsWith("human:")) throw new PlaceError("only the owner links a venue");
  return db.transaction(async (tx) => {
    const before = await load(tx, id);
    return change(tx, before, { venueId }, { actor: opts.actor, action: "update", reason: venueId ? `Linked to venue: ${opts.reason}` : `Venue link removed: ${opts.reason}` });
  });
}

export async function listPlaces(db: DbExecutor) {
  return db.select().from(places).orderBy(desc(places.updatedAt));
}

export async function placeById(db: DbExecutor, id: string) {
  const [p] = await db.select().from(places).where(eq(places.id, id));
  return p ?? null;
}
