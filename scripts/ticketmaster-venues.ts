/**
 * Ticketmaster venue coverage, proposals, and approved links. Links are only
 * ever written with the owner's approval, and every one is logged.
 *
 *   npm run tm:venues                                   writes data/ticketmaster-venues.md
 *   npm run tm:venues -- --link <tmVenueId>=<venueSlug> --reason "..."
 *   npm run tm:venues -- --propose                      log proposals for close, named matches (never links)
 *   npm run tm:venues -- --proposals                    list pending proposals
 *   npm run tm:venues -- --approve <proposalId> --reason "..."
 *   npm run tm:venues -- --reject <proposalId> --reason "..."
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { and, eq } from "drizzle-orm";
import { humanActor } from "@/lib/actions/record";
import { getDb } from "@/lib/db/client";
import { agentActions } from "@/lib/db/schema";
import {
  approveLinkProposal,
  coverageReport,
  linkTicketmasterVenue,
  proposeTicketmasterLinks,
  rejectLinkProposal,
  ticketmasterCoverage,
} from "@/lib/sources/ticketmaster-venues";

const OUT = "data/ticketmaster-venues.md";
const OWNER = humanActor("owner");
const { values: args } = parseArgs({
  options: {
    link: { type: "string", multiple: true },
    reason: { type: "string" },
    propose: { type: "boolean", default: false },
    proposals: { type: "boolean", default: false },
    approve: { type: "string" },
    reject: { type: "string" },
  },
});

function reason(): string {
  const r = args.reason?.trim();
  if (!r || r.length < 10) throw new Error('--reason "..." (10+ characters) is required');
  return r;
}

async function main() {
  const db = getDb();
  try {
    if (args.approve) {
      await approveLinkProposal(db, args.approve, OWNER, reason());
      console.log(`approved and linked (logged): ${args.approve}`);
      return;
    }
    if (args.reject) {
      await rejectLinkProposal(db, args.reject, OWNER, reason());
      console.log(`rejected (logged): ${args.reject}`);
      return;
    }
    if (args.propose) {
      console.log(await proposeTicketmasterLinks(db, { actor: OWNER }));
      return;
    }
    if (args.proposals) {
      const rows = await db
        .select({ id: agentActions.id, after: agentActions.after, reason: agentActions.reason })
        .from(agentActions)
        .where(and(eq(agentActions.action, "propose_link"), eq(agentActions.approvalStatus, "pending")));
      console.table(rows.map((r) => ({ id: r.id, ...(r.after as object), reason: r.reason })));
      return;
    }
    const { sourceId, matches } = await ticketmasterCoverage(db);
    if (args.link?.length) {
      const why = reason();
      for (const pair of args.link) {
        const [tmVenueId, venueSlug] = pair.split("=");
        if (!tmVenueId || !venueSlug) throw new Error(`bad --link ${pair}; use <tmVenueId>=<venueSlug>`);
        await linkTicketmasterVenue(db, { sourceId, tmVenueId, venueSlug, actor: OWNER, reason: why });
        console.log(`linked ${tmVenueId} → ${venueSlug} (logged)`);
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
