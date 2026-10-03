import { eq } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import type { DbTx } from "@/lib/db/client";
import { categories, tags } from "@/lib/db/schema";
import { canonicalJson } from "@/lib/venues/seed-file";
import type { CategorySeed, TagSeed } from "./seed-data";

interface SeedOpts {
  runId: string;
  actor: string;
}
type Stats = { inserted: number; updated: number; unchanged: number };

const changedFields = <K extends string>(existing: Record<K, unknown>, seed: Record<K, unknown>, keys: readonly K[]) =>
  keys.filter((k) => canonicalJson(existing[k]) !== canonicalJson(seed[k]));

/**
 * Upserts categories by slug, logging every change. New rows start active; an
 * existing row's `active` is never changed here (retiring one is its own
 * explicit, logged action). Never deletes.
 */
export async function seedCategories(tx: DbTx, seeds: readonly CategorySeed[], opts: SeedOpts): Promise<Stats> {
  const stats: Stats = { inserted: 0, updated: 0, unchanged: 0 };
  for (const s of seeds) {
    const [existing] = await tx.select().from(categories).where(eq(categories.slug, s.slug));
    if (!existing) {
      const [created] = await tx.insert(categories).values(s).returning();
      await recordAction(tx, {
        ...opts,
        job: "seed",
        action: "insert",
        entityType: "category",
        entityId: created.id,
        after: created,
        reason: `Seed category ${s.slug}`,
      });
      stats.inserted++;
      continue;
    }
    const changed = changedFields(existing, s, ["name", "sort"]);
    if (changed.length === 0) {
      stats.unchanged++;
      continue;
    }
    const [after] = await tx
      .update(categories)
      .set({ name: s.name, sort: s.sort })
      .where(eq(categories.id, existing.id))
      .returning();
    await recordAction(tx, {
      ...opts,
      job: "seed",
      action: "update",
      entityType: "category",
      entityId: existing.id,
      before: existing,
      after,
      reason: `Seed update for category ${s.slug}: ${changed.join(", ")}`,
    });
    stats.updated++;
  }
  return stats;
}

/** Upserts tags by slug, with the same rules as seedCategories. */
export async function seedTags(tx: DbTx, seeds: readonly TagSeed[], opts: SeedOpts): Promise<Stats> {
  const stats: Stats = { inserted: 0, updated: 0, unchanged: 0 };
  for (const s of seeds) {
    const [existing] = await tx.select().from(tags).where(eq(tags.slug, s.slug));
    if (!existing) {
      const [created] = await tx.insert(tags).values(s).returning();
      await recordAction(tx, {
        ...opts,
        job: "seed",
        action: "insert",
        entityType: "tag",
        entityId: created.id,
        after: created,
        reason: `Seed tag ${s.slug}`,
      });
      stats.inserted++;
      continue;
    }
    if (changedFields(existing, s, ["name"]).length === 0) {
      stats.unchanged++;
      continue;
    }
    const [after] = await tx.update(tags).set({ name: s.name }).where(eq(tags.id, existing.id)).returning();
    await recordAction(tx, {
      ...opts,
      job: "seed",
      action: "update",
      entityType: "tag",
      entityId: existing.id,
      before: existing,
      after,
      reason: `Seed update for tag ${s.slug}: name`,
    });
    stats.updated++;
  }
  return stats;
}
