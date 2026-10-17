import { publicVenue } from "@/lib/site/queries";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "@/lib/db/client";
import { PLACE_CATEGORIES, places } from "@/lib/db/schema";
import { windowStart } from "./format";

/**
 * Public New in Town reads (docs/product/front-page.md, H). Only published
 * places (open or opening soon) ever leave here; drafts and hidden places
 * never do. Lists count from the stated opening date, never the date we
 * found the place.
 */

export type PublicPlace = typeof places.$inferSelect;
type Category = (typeof PLACE_CATEGORIES)[number];

const PUBLIC = inArray(places.status, ["open", "opening_soon"]);

/** Places opened within the window, newest opening first. */
export async function recentOpenings(db: DbExecutor, now: Date, opts: { category?: Category; limit?: number } = {}): Promise<PublicPlace[]> {
  const q = db
    .select()
    .from(places)
    .where(and(eq(places.status, "open"), gte(places.openedOn, windowStart(now)), opts.category ? eq(places.category, opts.category) : undefined))
    .orderBy(desc(places.openedOn), desc(places.publishedAt));
  return opts.limit ? q.limit(opts.limit) : q;
}

/** Places with a stated target date or month, soonest first. */
export async function openingSoon(db: DbExecutor, opts: { category?: Category } = {}): Promise<PublicPlace[]> {
  return db
    .select()
    .from(places)
    .where(and(eq(places.status, "opening_soon"), opts.category ? eq(places.category, opts.category) : undefined))
    .orderBy(places.targetOn, places.name);
}

/** A published place's page; null for drafts, hidden places, and unknown slugs. */
export async function placeBySlug(db: DbExecutor, slug: string): Promise<PublicPlace | null> {
  const [p] = await db
    .select()
    .from(places)
    .where(and(eq(places.slug, slug), PUBLIC));
  return p ?? null;
}

/** The venue a place is linked to (owner-confirmed), for a link to its events. */
export async function linkedVenueSlug(db: DbExecutor, venueId: string | null): Promise<string | null> {
  if (!venueId) return null;
  const [v] = (await db.execute(sql`select v.slug from venues v where v.id = ${venueId} and ${publicVenue("v")}`)) as unknown as { slug: string }[];
  return v?.slug ?? null;
}
