/**
 * Exports the owner's dedup labels, with each pair's frozen facts, to
 * tests/fixtures/dedup/labels.json (committed): the regression set that
 * tests/dedup-regression.test.ts runs on every test run. Facts only (titles,
 * times, places, sources, links), never source text. Read-only.
 *
 * Usage: npm run dedup:export-labels
 *   (labels live in production: MIGRATE_PRODUCTION=yes reads .env.production.local)
 */
import * as dotenv from "dotenv";
dotenv.config({ path: process.env.MIGRATE_PRODUCTION === "yes" ? ".env.production.local" : ".env.local", quiet: true });

import { writeFileSync } from "node:fs";
import { labeledPairs } from "@/lib/admin/dedup-review";
import { getDb } from "@/lib/db/client";

const OUT = "tests/fixtures/dedup/labels.json";

async function main() {
  const db = getDb();
  try {
    const labels = await labeledPairs(db);
    const pairs = labels
      .map((l) => ({ label: l.label, note: l.note, labeledAt: l.labeledAt.toISOString().slice(0, 10), a: l.factsA, b: l.factsB }))
      .sort((x, y) => `${(x.a as { title: string }).title}${(x.b as { title: string }).title}`.localeCompare(`${(y.a as { title: string }).title}${(y.b as { title: string }).title}`));
    writeFileSync(OUT, `${JSON.stringify({ exportedAt: new Date().toISOString().slice(0, 10), pairs }, null, 2)}\n`);
    console.log(`${pairs.length} labels (${pairs.filter((p) => p.label === "same").length} same) → ${OUT}`);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
