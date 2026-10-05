/**
 * The owner's seven New in Town leads (2026-10-04), saved as DRAFTS: from
 * research in the chat, NOT owner-verified, and none of the source URLs is
 * fetched. The owner checks each in the browser, records it as
 * owner-verified in /admin/places, confirms "open to the public", and
 * publishes. Idempotent: a place already present (same name and city) is
 * skipped. Each insert is logged.
 *
 * Usage: npm run places:seed-drafts   (production: MIGRATE_PRODUCTION=yes, reads .env.production.local)
 */
import * as dotenv from "dotenv";
dotenv.config({ path: process.env.MIGRATE_PRODUCTION === "yes" ? ".env.production.local" : ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { agentActor } from "@/lib/actions/record";
import { createPlace, type PlaceInput } from "@/lib/admin/places";
import { getDb } from "@/lib/db/client";
import { places } from "@/lib/db/schema";

const DRAFTS: PlaceInput[] = [
  {
    name: "Flyway Brewing", placeType: "brewery", kind: "new_location",
    address: "1410 SE 8th St Suite 1", city: "Bentonville", opened: "2026-08-10",
    sourceUrl: "https://www.nwahomepage.com/northwest-arkansas-news/little-rock-based-flyway-brewing-company-opens-at-walmart-home-office/",
    notes: "At the Walmart Home Office: confirm it's open to the public when verifying.",
  },
  {
    name: "Dempsey Bakery", placeType: "bakery_cafe", kind: "new_location",
    address: "481 S School Ave", city: "Fayetteville", opened: "2026-06-08",
    sourceUrl: "https://fayettevilleflyer.com/2026/06/10/dempsey-bakery-opens-fayetteville-location/",
  },
  {
    name: "Saltine", placeType: "bakery_cafe", kind: "new",
    address: "659 E Huntsville Rd", city: "Fayetteville", opened: "2026-08-18", openedQualifier: "grand opening",
    sourceUrl: "https://fayettevilleflyer.com/2026/08/14/new-bakery-cafe-opens-in-south-fayetteville/",
  },
  {
    name: "Dodo Coffee Co.", placeType: "coffee_shop", kind: "reopened",
    address: "W McMillan Dr at W Wedington Dr", addressKind: "intersection", city: "Fayetteville", opened: "2026-08-29",
    sourceUrl: "https://mynorthwest.com/local/cooper-kupp-dodo-coffee-arkansas/4271039",
    notes: "New flagship. Street number unconfirmed: owner to supply.",
  },
  {
    name: "Onyx at The Preserve", placeType: "cafe", kind: "new_location",
    address: "1101 Excellence Dr", city: "Bentonville", opened: "2026-06", openedQualifier: "soft opening",
    sourceUrl: "https://onyxcoffeelab.com/pages/locations",
    extraSourceUrls: ["https://sprudge.com/build-outs-of-coffee-onyx-at-the-preserve-in-bentonville-ar-1215178.html"],
    notes: "Cafe and restaurant.",
  },
  {
    name: "Bienvenue Restaurant", placeType: "restaurant", kind: "moved",
    address: "3300 S Market St Suite 100", city: "Rogers",
    sourceUrl: "https://talkbusiness.net/2026/09/bienvenue-restaurant-moves-to-pinnacle-hills",
    notes: "Moved from downtown Springdale. Opening date not stated (article dated September 2026): stays a draft until the owner supplies a stated date.",
  },
  {
    name: "Bentoville Food Theater", placeType: "restaurant", kind: "new",
    address: "100 NW 2nd St Suite 100", city: "Bentonville",
    notes: "Opening date not found: stays a draft until the owner supplies one. No source yet.",
  },
];

async function main() {
  const db = getDb();
  const actor = agentActor("research");
  try {
    for (const d of DRAFTS) {
      const [existing] = await db.select({ id: places.id }).from(places).where(and(eq(places.name, d.name), eq(places.city, d.city)));
      if (existing) {
        console.log(`skip (exists): ${d.name}`);
        continue;
      }
      const row = await createPlace(db, d, {
        actor,
        ownerVerified: false,
        sourceNote: "from research in the chat, 2026-10-04; not fetched",
        reason: "Draft from research in the chat (2026-10-04); not owner-verified; source not fetched",
      });
      console.log(`draft: ${row.name} (${row.slug})`);
    }
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
