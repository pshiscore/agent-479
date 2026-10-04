/**
 * Runs the process job by hand, as /api/cron/process does. With --all, keeps
 * running batches until nothing is pending (or the LLM budget stops it).
 * With --no-llm, the resolver skips the LLM pick (those records wait in needs_venue).
 * With --reprocess, records not yet turned into events go back to pending
 * first (after a mapper or resolver fix); the reset is its own run in runs.
 *
 * --enrich N enriches up to N mapped records per batch (default 20);
 * --no-enrich maps and resolves only. With --reenrich, records already turned
 * into events go back to mapped first (after a prompt or tag change), so each
 * event is rewritten by the enrich stage, logged row by row; the reset is its
 * own run in runs.
 *
 * Usage: npm run process:once [-- --all] [-- --no-llm] [-- --reprocess] [-- --reenrich] [-- --enrich N | --no-enrich]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { parseArgs } from "node:util";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { rawRecords } from "@/lib/db/schema";
import { runProcessJob } from "@/lib/pipeline/process";
import { withRun } from "@/lib/runs";

const { values: args } = parseArgs({
  options: {
    all: { type: "boolean", default: false },
    "no-llm": { type: "boolean", default: false },
    reprocess: { type: "boolean", default: false },
    reenrich: { type: "boolean", default: false },
    enrich: { type: "string" },
    "no-enrich": { type: "boolean", default: false },
  },
});

async function main() {
  const db = getDb();
  try {
    if (args.reprocess) {
      const reset = await withRun(db, "manual", async () => {
        const rows = await db
          .update(rawRecords)
          .set({ status: "pending" })
          .where(and(inArray(rawRecords.status, ["mapped", "needs_venue", "skipped", "failed"]), isNull(rawRecords.eventId)))
          .returning({ id: rawRecords.id });
        return { reprocessReset: rows.length };
      });
      console.log(reset);
    }
    if (args.reenrich) {
      const reset = await withRun(db, "manual", async () => {
        const rows = await db
          .update(rawRecords)
          .set({ status: "mapped" })
          .where(and(eq(rawRecords.status, "extracted"), isNotNull(rawRecords.eventId), isNotNull(rawRecords.venueId)))
          .returning({ id: rawRecords.id });
        return { reenrichReset: rows.length };
      });
      console.log(reset);
    }
    for (let i = 0; i < 100; i++) {
      const enrichBatchSize = args["no-enrich"] ? 0 : args.enrich ? Number(args.enrich) : undefined;
      const stats = await runProcessJob(db, { llmPick: args["no-llm"] ? null : undefined, enrichBatchSize });
      if (!stats) {
        console.log("Another process job holds the lease; nothing done.");
        return;
      }
      console.log(stats);
      const done = stats.remaining === 0 && (args["no-enrich"] || stats.toEnrichLeft === 0);
      if (!args.all || done || stats.stoppedForBudget || (stats.batch === 0 && args["no-enrich"])) return;
    }
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
