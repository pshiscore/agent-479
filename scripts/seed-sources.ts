/**
 * Seeds sources and link_policies from src/lib/sources/seed-data.ts.
 * Idempotent: matches sources on slug and policies on domain, logs every
 * insert and update through recordAction, and never deletes. New sources start
 * disabled, and re-seeding never changes whether a source is enabled.
 *
 * Usage: npm run db:seed:sources   (needs the venues seeded first)
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { humanActor } from "@/lib/actions/record";
import { getDb } from "@/lib/db/client";
import { withRun } from "@/lib/runs";
import { seedLinkPolicies, seedSources } from "@/lib/sources/seed";
import { LINK_POLICY_SEEDS, SOURCE_SEEDS } from "@/lib/sources/seed-data";

async function main() {
  const db = getDb();
  const actor = humanActor("seed-sources");
  try {
    const stats = await withRun(db, "seed", (run) =>
      db.transaction(async (tx) => ({
        sources: await seedSources(tx, SOURCE_SEEDS, { runId: run.id, actor }),
        linkPolicies: await seedLinkPolicies(tx, LINK_POLICY_SEEDS, { runId: run.id, actor }),
      })),
    );
    console.log("sources seed:", stats.sources);
    console.log("link_policies seed:", stats.linkPolicies);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
