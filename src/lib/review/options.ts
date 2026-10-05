import { asc, eq } from "drizzle-orm";
import type { DbExecutor } from "@/lib/db/client";
import { categories, tags, venues } from "@/lib/db/schema";
import { CODE_SET_TAGS } from "@/lib/pipeline/enrich/classify";

/** Choices for the event forms: active venues (all inside the coverage area), active categories, and the tags the owner may pick. */
export async function eventFormOptions(db: DbExecutor) {
  const [v, c, t] = await Promise.all([
    db.select({ id: venues.id, name: venues.name, city: venues.city }).from(venues).where(eq(venues.active, true)).orderBy(asc(venues.city), asc(venues.name)),
    db.select({ id: categories.id, name: categories.name, slug: categories.slug }).from(categories).where(eq(categories.active, true)).orderBy(asc(categories.sort)),
    db.select({ slug: tags.slug, name: tags.name }).from(tags).where(eq(tags.active, true)).orderBy(asc(tags.name)),
  ]);
  return { venues: v, categories: c, tags: t.filter((x) => !CODE_SET_TAGS.has(x.slug)) };
}
export type EventFormOptions = Awaited<ReturnType<typeof eventFormOptions>>;
