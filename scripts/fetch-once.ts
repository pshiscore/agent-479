/**
 * Runs the fetch job once, exactly as /api/cron/fetch does: claims the job
 * lease, then fetches each due, enabled source. For manual runs until crons
 * are turned on (build step 23).
 *
 * Usage: npm run fetch:once
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { getDb } from "@/lib/db/client";
import { runFetchJob } from "@/lib/pipeline/fetch";

async function main() {
  const db = getDb();
  try {
    const result = await runFetchJob(db);
    if (!result) {
      console.log("Another fetch job holds the lease; nothing done.");
      return;
    }
    for (const o of result.outcomes) {
      console.log(o.ok ? `ok    ${o.slug}` : `FAIL  ${o.slug}${o.disabled ? " (disabled: blocked)" : ""}: ${o.error}`, o.stats ?? "");
    }
    if (result.outcomes.length === 0) console.log("No sources are due.");
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
