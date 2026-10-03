import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { humanActor } from "@/lib/actions/record";
import { loadActiveTaxonomy } from "@/lib/categories";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, categories, tags } from "@/lib/db/schema";
import { startRun } from "@/lib/runs";
import { seedCategories, seedTags } from "@/lib/taxonomy/seed";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const tag = randomUUID().slice(0, 8);
const actor = humanActor("seed-taxonomy-test");

async function pgError(tx: DbTx, query: (tx: DbTx) => Promise<unknown>): Promise<string | undefined> {
  try {
    await tx.transaction(async (sp) => {
      await query(sp);
    });
    return undefined;
  } catch (err) {
    const cause = (err as { cause?: { constraint_name?: string; message?: string } }).cause;
    return cause?.constraint_name ?? cause?.message ?? String(err);
  }
}

describe("categories and tags tables", () => {
  it("reject duplicate names regardless of case, and bad slugs", async () => {
    await inRollback(async (tx) => {
      await tx.insert(categories).values({ slug: `c-${tag}`, name: `Cat ${tag}`, sort: 999 });
      expect(
        await pgError(tx, (sp) => sp.insert(categories).values({ slug: `c2-${tag}`, name: `CAT ${tag}`, sort: 998 })),
      ).toBe("categories_name_uniq");
      expect(await pgError(tx, (sp) => sp.insert(categories).values({ slug: "Bad Slug", name: `X ${tag}`, sort: 1 }))).toBe(
        "categories_slug_check",
      );
      await tx.insert(tags).values({ slug: `t-${tag}`, name: `Tag ${tag}` });
      expect(await pgError(tx, (sp) => sp.insert(tags).values({ slug: `t2-${tag}`, name: `tag ${tag}` }))).toBe(
        "tags_name_uniq",
      );
    });
  });
});

describe("seedCategories and seedTags", () => {
  it("insert, log, stay idempotent, and never re-activate a retired row", async () => {
    await inRollback(async (tx) => {
      const run = await startRun(tx, "seed");
      const opts = { runId: run.id, actor };
      const cat = { slug: `seed-${tag}`, name: `Seed ${tag}`, sort: 990 };

      expect(await seedCategories(tx, [cat], opts)).toEqual({ inserted: 1, updated: 0, unchanged: 0 });
      expect(await seedCategories(tx, [cat], opts)).toEqual({ inserted: 0, updated: 0, unchanged: 1 });

      // Retired by the owner, then re-seeded with a new sort.
      await tx.update(categories).set({ active: false }).where(eq(categories.slug, cat.slug));
      expect(await seedCategories(tx, [{ ...cat, sort: 991 }], opts)).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
      const [row] = await tx.select().from(categories).where(eq(categories.slug, cat.slug));
      expect(row).toMatchObject({ active: false, sort: 991 });

      expect(await seedTags(tx, [{ slug: `seedtag-${tag}`, name: `Seed Tag ${tag}` }], opts)).toEqual({
        inserted: 1,
        updated: 0,
        unchanged: 0,
      });
      const logged = await tx
        .select({ entityType: agentActions.entityType, action: agentActions.action })
        .from(agentActions)
        .where(eq(agentActions.runId, run.id));
      // One transaction shares one now(), so created_at can't order these: compare as a set.
      const key = (a: { entityType: string; action: string }) => `${a.entityType}:${a.action}`;
      expect(logged.map(key).sort()).toEqual(["category:insert", "category:update", "tag:insert"]);
    });
  });
});

describe("loadActiveTaxonomy", () => {
  it("returns active categories in sort order and active tags, skipping retired ones", async () => {
    await inRollback(async (tx) => {
      await tx.insert(categories).values([
        { slug: `late-${tag}`, name: `Late ${tag}`, sort: 9_999 },
        { slug: `gone-${tag}`, name: `Gone ${tag}`, sort: 9_998, active: false },
      ]);
      await tx.insert(tags).values({ slug: `old-${tag}`, name: `Old ${tag}`, active: false });

      const { categories: cats, tags: tagList } = await loadActiveTaxonomy(tx);
      const slugs = cats.map((c) => c.slug);
      expect(slugs.at(-1)).toBe(`late-${tag}`);
      expect(slugs).not.toContain(`gone-${tag}`);
      expect(tagList.map((t) => t.slug)).not.toContain(`old-${tag}`);
    });
  });
});
