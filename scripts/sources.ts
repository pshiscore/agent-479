/**
 * Turning sources on and off. Every change is logged with a reason (AGENTS.md rule 6).
 *
 *   npm run sources -- test-fetch <slug> [--enable]       untested sources only; dry run unless --enable
 *   npm run sources -- enable <slug> --reason "..."        re-enable a blocked or manual source (owner only)
 *   npm run sources -- disable <slug> --reason "..."       turn a source off
 *   npm run sources -- permission <slug> --reason "..."    written permission arrived: awaiting → untested
 *   npm run sources -- status                              every source, its state, and recent failures
 *
 * A block during a test fetch stops it (no retry): record it and ask the owner.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { humanActor } from "@/lib/actions/record";
import { getDb } from "@/lib/db/client";
import { sources } from "@/lib/db/schema";
import { FetchBlockedError, FetchNotPermittedError } from "@/lib/http/fetch";
import {
  disableManually,
  enableAfterTest,
  enableManually,
  NEEDS_ATTENTION_FAILURES,
  recordPermission,
} from "@/lib/sources/admin";
import { PoliteClient } from "@/lib/sources/http";
import { testFetch } from "@/lib/sources/test-fetch";
import { needsVenueSummary } from "@/lib/pipeline/maintenance";

const { values: args, positionals } = parseArgs({
  options: { enable: { type: "boolean", default: false }, reason: { type: "string" } },
  allowPositionals: true,
});
// Commands are run by or for the owner.
const OWNER = humanActor("owner");

async function main() {
  const [command, slug] = positionals;
  const db = getDb();
  try {
    switch (command) {
      case "test-fetch": {
        const [source] = await db.select().from(sources).where(eq(sources.slug, slug ?? ""));
        if (!source) throw new Error(`no source ${slug}`);
        let report;
        try {
          report = await testFetch(source, new PoliteClient());
        } catch (err) {
          if (err instanceof FetchBlockedError || err instanceof FetchNotPermittedError) {
            console.error(`STOPPED: ${err.message}`);
            process.exitCode = 2;
            return;
          }
          throw err;
        }
        console.log(JSON.stringify(report, null, 2));
        console.log(report.pass ? "\nPASS" : `\nFAIL: ${report.problems.join("; ")}`);
        if (args.enable) {
          await enableAfterTest(db, source.slug, report, OWNER);
          console.log(`${source.slug} enabled (logged)`);
        }
        return;
      }
      case "enable":
        await enableManually(db, slug ?? "", args.reason ?? "", OWNER);
        console.log(`${slug} enabled (logged)`);
        return;
      case "disable":
        await disableManually(db, slug ?? "", args.reason ?? "", OWNER);
        console.log(`${slug} disabled (logged)`);
        return;
      case "permission":
        await recordPermission(db, slug ?? "", args.reason ?? "", OWNER);
        console.log(`${slug} is now untested and may be test fetched (logged)`);
        return;
      case "status": {
        const rows = await db.select().from(sources).orderBy(sources.slug);
        const nv = await needsVenueSummary(db);
        console.log(`Records waiting for a venue (needs_venue): ${nv.total}`);
        console.table(
          rows.map((s) => ({
            slug: s.slug,
            state: s.enabled ? "enabled" : s.disabledReason,
            failures: s.consecutiveFailures,
            attention: s.enabled && s.consecutiveFailures >= NEEDS_ATTENTION_FAILURES ? "YES" : "",
            lastSuccess: s.lastSuccessAt?.toISOString() ?? "",
            lastError: s.lastError?.slice(0, 60) ?? "",
          })),
        );
        return;
      }
      default:
        throw new Error("usage: npm run sources -- <test-fetch|enable|disable|permission|status> [slug] [--reason ...]");
    }
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
