/**
 * Feed discovery by hand (docs/product/organizers.md, step 6). The daily
 * maintenance job does this monthly (step 8); run this to look now. For each
 * verified organizer with a website (or only --only slugs), finds its event
 * feeds and saves each as a proposal in /admin/discoveries, logged as
 * agent:discovery, and records the look on the organizer. Organizers blocked
 * for discovery are skipped. Requests go through PoliteClient (robots.txt on
 * every request, per-host pauses, a block stops the organizer).
 *
 * Usage: npm run discover:feeds [-- --only slug1,slug2]
 * Writes a run summary to data/discovery.last-run.json (addresses only).
 */
import * as dotenv from "dotenv";
// MIGRATE_PRODUCTION=yes targets production (.env.production.local wins over the shell).
const production = process.env.MIGRATE_PRODUCTION === "yes";
dotenv.config({ path: production ? ".env.production.local" : ".env.local", quiet: true, override: production });

import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { agentActor } from "@/lib/actions/record";
import { getDb } from "@/lib/db/client";
import { organizers } from "@/lib/db/schema";
import { knownFeedKeys } from "@/lib/discovery/discover";
import { discoverAndSave } from "@/lib/discovery/rediscover";
import { withRun } from "@/lib/runs";
import { PoliteClient } from "@/lib/sources/http";

const { values: args } = parseArgs({ options: { only: { type: "string" } } });

async function main() {
  const db = getDb();
  const only = args.only ? new Set(args.only.split(",")) : null;
  const http = new PoliteClient({ timeoutMs: 20_000, maxBytes: 5 * 1024 * 1024 });
  const summary: Record<string, unknown> = {};
  try {
    const stats = await withRun(db, "manual", async (run) => {
      const known = await knownFeedKeys(db);
      const orgs = (
        await db
          .select()
          .from(organizers)
          .where(and(eq(organizers.status, "verified"), isNotNull(organizers.website), isNull(organizers.discoveryBlocked)))
          .orderBy(asc(organizers.name))
      ).filter((o) => !only || only.has(o.slug));
      const totals = { organizers: orgs.length, proposed: 0, refreshed: 0, gone: 0, blocked: 0, withFinds: 0 };
      for (const o of orgs) {
        const { result: r, saved } = await discoverAndSave(db, o, http, known, { actor: agentActor("discovery"), runId: run.id });
        totals.proposed += saved.proposed;
        totals.refreshed += saved.refreshed;
        totals.gone += saved.gone;
        if (r.blocked) totals.blocked++;
        if (r.finds.length) totals.withFinds++;
        summary[o.slug] = { finds: r.finds.map((f) => ({ url: f.url, label: f.label, kind: f.kind, platform: f.platform, robots: f.robotsResult, samples: f.sampleEvents.length, termsFlags: f.termsFlags })), skipped: r.skipped, googleCalendars: r.googleCalendars, blocked: r.blocked, errors: r.errors };
        console.log(`${o.slug}: ${r.finds.length} found${r.skipped.length ? `, ${r.skipped.length} skipped` : ""}${r.googleCalendars.length ? `, ${r.googleCalendars.length} Google Calendar` : ""}${r.blocked ? `, BLOCKED: ${r.blocked}` : ""}${r.errors.length ? ` (${r.errors.join("; ")})` : ""}`);
      }
      return totals;
    });
    await writeFile("data/discovery.last-run.json", `${JSON.stringify({ ranAt: new Date().toISOString(), stats, organizers: summary }, null, 2)}\n`);
    console.log("discovery:", stats);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
