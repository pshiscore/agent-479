/**
 * Feed discovery (docs/product/organizers.md, step 6): for each verified
 * organizer with a website, finds its event feeds and saves each as a
 * proposal in /admin/discoveries (logged as agent:discovery). Approving one
 * is the owner's. One organizer at a time; requests go through PoliteClient
 * (robots.txt on every request, per-host pauses, a block stops the organizer).
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
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { agentActor } from "@/lib/actions/record";
import { getDb } from "@/lib/db/client";
import { organizers } from "@/lib/db/schema";
import { discoverOrganizer, knownFeedKeys } from "@/lib/discovery/discover";
import { saveFinds } from "@/lib/discovery/store";
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
      const orgs = (await db.select().from(organizers).where(and(eq(organizers.status, "verified"), isNotNull(organizers.website))).orderBy(asc(organizers.name))).filter((o) => !only || only.has(o.slug));
      const totals = { organizers: orgs.length, proposed: 0, refreshed: 0, blocked: 0, withFinds: 0 };
      for (const o of orgs) {
        const hint = o.verification.notes?.find((n) => n.note?.startsWith("Events link"))?.url ?? null;
        const r = await discoverOrganizer(http, { name: o.name, website: o.website!, eventsHint: hint }, known);
        const saved = await saveFinds(db, o.id, r.finds, { actor: agentActor("discovery"), runId: run.id });
        totals.proposed += saved.proposed;
        totals.refreshed += saved.refreshed;
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
