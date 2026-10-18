/**
 * Maps active venues to their NWS forecast grids now (event weather, step 3).
 * The maintenance job does the monthly refresh; this runs the first pass, or
 * a re-check by hand. Every venue change is logged as agent:weather.
 *
 * Usage: MIGRATE_PRODUCTION=yes npm run weather:grids
 */
import * as dotenv from "dotenv";
const production = process.env.MIGRATE_PRODUCTION === "yes";
dotenv.config({ path: production ? ".env.production.local" : ".env.local", quiet: true, override: production });

import { agentActor } from "@/lib/actions/record";
import { getDb } from "@/lib/db/client";
import { withRun } from "@/lib/runs";
import { PoliteClient } from "@/lib/sources/http";
import { refreshVenueGrids } from "@/lib/weather/grid";

async function main() {
  const db = getDb();
  try {
    const stats = await withRun(db, "manual", (run) => refreshVenueGrids(db, { http: new PoliteClient({ timeoutMs: 20_000 }), actor: agentActor("weather"), runId: run.id }));
    console.log("weather grids:", stats);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
