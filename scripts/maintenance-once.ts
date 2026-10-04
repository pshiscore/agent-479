/**
 * Runs the maintenance job once, exactly as /api/cron/maintenance does.
 * Usage: npm run maintenance:once
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { getDb } from "@/lib/db/client";
import { runMaintenanceJob } from "@/lib/pipeline/maintenance";

async function main() {
  const db = getDb();
  try {
    const result = await runMaintenanceJob(db);
    console.log(result ?? "Another maintenance job holds the lease; nothing done.");
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
