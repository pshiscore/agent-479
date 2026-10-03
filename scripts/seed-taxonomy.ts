/**
 * Seeds categories and tags from src/lib/taxonomy/seed-data.ts.
 * Idempotent: matches on slug, logs every insert and update through
 * recordAction, and never deletes. Re-seeding never changes `active`.
 *
 * Usage: npm run db:seed:taxonomy
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { humanActor } from "@/lib/actions/record";
import { getDb } from "@/lib/db/client";
import { withRun } from "@/lib/runs";
import { seedCategories, seedTags } from "@/lib/taxonomy/seed";
import { CATEGORY_SEEDS, TAG_SEEDS } from "@/lib/taxonomy/seed-data";

async function main() {
  const db = getDb();
  const actor = humanActor("seed-taxonomy");
  try {
    const stats = await withRun(db, "seed", (run) =>
      db.transaction(async (tx) => ({
        categories: await seedCategories(tx, CATEGORY_SEEDS, { runId: run.id, actor }),
        tags: await seedTags(tx, TAG_SEEDS, { runId: run.id, actor }),
      })),
    );
    console.log("categories seed:", stats.categories);
    console.log("tags seed:", stats.tags);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
