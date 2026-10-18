/**
 * Seeds venues from data/venues.seed.json. Refuses unless the file passes
 * the offline checks and its `reviewed.sha256` matches the current contents
 * (see npm run venues:verify). Idempotent: matches on slug, logs every
 * insert and update through recordAction, and never deletes.
 *
 * Usage: npm run venues:seed
 */
import * as dotenv from "dotenv";
// MIGRATE_PRODUCTION=yes targets production (.env.production.local wins over the shell).
const production = process.env.MIGRATE_PRODUCTION === "yes";
dotenv.config({ path: production ? ".env.production.local" : ".env.local", quiet: true, override: production });

import { humanActor } from "@/lib/actions/record";
import { getDb } from "@/lib/db/client";
import { withRun } from "@/lib/runs";
import { readSeedFile } from "@/lib/venues/seed-file";
import { SeedRefusedError, seedVenues } from "@/lib/venues/seed";

const FILE = "data/venues.seed.json";

async function main() {
  const file = await readSeedFile(FILE);
  const db = getDb();
  try {
    const { notInFile, ...stats } = await withRun(db, "seed", (run) =>
      db.transaction((tx) => seedVenues(tx, file, { runId: run.id, actor: humanActor("seed-venues") })),
    );
    console.log("venues seed:", stats);
    if (notInFile.length > 0) {
      console.log(`In the database but not in ${FILE} (left unchanged): ${notInFile.join(", ")}`);
    }
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err instanceof SeedRefusedError ? `Refused: ${err.message}` : err);
  process.exit(1);
});
