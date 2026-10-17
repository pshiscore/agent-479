/**
 * Seeds the organizer registry from src/lib/organizers/seed-data.ts and the
 * check results in data/organizers.check.json (npm run organizers:check).
 * Idempotent: upserts by slug, logs every insert and change as the agent
 * (owner, 2026-10-16: the registry needs no sign-off), and never deletes.
 *
 * Usage: npm run db:seed:organizers   (needs the venues seeded first)
 */
import * as dotenv from "dotenv";
// MIGRATE_PRODUCTION=yes targets production (.env.production.local wins over the shell).
const production = process.env.MIGRATE_PRODUCTION === "yes";
dotenv.config({ path: production ? ".env.production.local" : ".env.local", quiet: true, override: production });

import { readFile } from "node:fs/promises";
import { agentActor } from "@/lib/actions/record";
import { getDb } from "@/lib/db/client";
import type { CheckFile } from "@/lib/organizers/check";
import { seedOrganizers } from "@/lib/organizers/seed";
import { ORGANIZER_SEEDS } from "@/lib/organizers/seed-data";
import { withRun } from "@/lib/runs";

async function main() {
  const check = JSON.parse(await readFile("data/organizers.check.json", "utf8")) as CheckFile;
  const db = getDb();
  try {
    const stats = await withRun(db, "seed", (run) => db.transaction((tx) => seedOrganizers(tx, ORGANIZER_SEEDS, check, { runId: run.id, actor: agentActor("registry") })));
    console.log("organizers seed:", stats);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
