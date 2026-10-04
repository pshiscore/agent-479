/**
 * Ticketmaster venue coverage report, and approved links.
 *
 *   npm run tm:venues                       writes data/ticketmaster-venues.md
 *   npm run tm:venues -- --link <tmVenueId>=<venueSlug> --reason "..."
 *                                           links one Ticketmaster venue after the owner approves (logged)
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { humanActor } from "@/lib/actions/record";
import { getDb } from "@/lib/db/client";
import { coverageReport, linkTicketmasterVenue, ticketmasterCoverage } from "@/lib/sources/ticketmaster-venues";

const OUT = "data/ticketmaster-venues.md";
const { values: args } = parseArgs({
  options: { link: { type: "string", multiple: true }, reason: { type: "string" } },
});

async function main() {
  const db = getDb();
  try {
    const { sourceId, matches } = await ticketmasterCoverage(db);
    if (args.link?.length) {
      const reason = args.reason?.trim();
      if (!reason || reason.length < 10) throw new Error('--reason "..." (10+ characters) is required to link venues');
      for (const pair of args.link) {
        const [tmVenueId, venueSlug] = pair.split("=");
        if (!tmVenueId || !venueSlug) throw new Error(`bad --link ${pair}; use <tmVenueId>=<venueSlug>`);
        await linkTicketmasterVenue(db, { sourceId, tmVenueId, venueSlug, actor: humanActor("owner"), reason });
        console.log(`linked ${tmVenueId} → ${venueSlug}`);
      }
      return;
    }
    await writeFile(OUT, coverageReport(matches, new Date()));
    console.log(`${matches.length} Ticketmaster venues. Report: ${OUT}`);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
