import { asc, eq } from "drizzle-orm";
import type { DbExecutor } from "@/lib/db/client";
import { categories, tags } from "@/lib/db/schema";

export { COMMUNITY_SLUG } from "@/lib/taxonomy/seed-data";

export interface TaxonomyEntry {
  id: string;
  slug: string;
  name: string;
}

/**
 * The active categories (in display order) and tags (by name). The classifier
 * builds its allowed values from this at run time, and filters use the same
 * list, so a row added or retired in the database takes effect without a deploy.
 */
export async function loadActiveTaxonomy(
  db: DbExecutor,
): Promise<{ categories: TaxonomyEntry[]; tags: TaxonomyEntry[] }> {
  const cols = { id: categories.id, slug: categories.slug, name: categories.name };
  const [cats, tagRows] = await Promise.all([
    db.select(cols).from(categories).where(eq(categories.active, true)).orderBy(asc(categories.sort), asc(categories.slug)),
    db
      .select({ id: tags.id, slug: tags.slug, name: tags.name })
      .from(tags)
      .where(eq(tags.active, true))
      .orderBy(asc(tags.name)),
  ]);
  return { categories: cats, tags: tagRows };
}
