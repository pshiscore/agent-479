import { eq, inArray } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import type { DbTx } from "@/lib/db/client";
import { type VenueVerification, venues } from "@/lib/db/schema";
import { canonicalJson, type SeedFile, type SeedVenue, venuesHash } from "./seed-file";
import { checkVenues } from "./verify";

type NewVenue = typeof venues.$inferInsert;

const COMPARED = [
  "name",
  "aliases",
  "venueType",
  "address",
  "city",
  "state",
  "postalCode",
  "lat",
  "lng",
  "website",
  "parentVenueId",
  "verification",
] as const;

export class SeedRefusedError extends Error {}

/** Parents before children, so every parent_venue_id resolves on insert. */
function parentsFirst(list: readonly SeedVenue[]): SeedVenue[] {
  const bySlug = new Map(list.map((v) => [v.slug, v]));
  const depth = (v: SeedVenue, seen = 0): number => {
    const p = v.parent ? bySlug.get(v.parent) : undefined;
    return p && seen < list.length ? 1 + depth(p, seen + 1) : 0;
  };
  return [...list].sort((a, b) => depth(a) - depth(b));
}

/**
 * Upserts the signed-off venues by slug, logging every insert and update.
 * Run it inside a transaction. Venues in the database but not in the file are
 * left alone and returned in `notInFile`: deactivating one is a separate,
 * explicit change.
 *
 * Refuses unless the file passes the offline checks and its `reviewed.sha256`
 * matches the current contents, so only what the owner reviewed is seeded.
 */
export async function seedVenues(
  tx: DbTx,
  file: SeedFile,
  opts: { runId: string; actor: string; today?: Date },
) {
  const errors = checkVenues(file.venues, opts.today ?? new Date()).filter((i) => i.level === "error");
  if (errors.length > 0) {
    throw new SeedRefusedError(
      `seed file has ${errors.length} error(s); run npm run venues:verify\n` +
        errors.map((e) => `  ${e.slug}: ${e.message}`).join("\n"),
    );
  }
  const hash = venuesHash(file.venues);
  if (!file.reviewed) {
    throw new SeedRefusedError("seed file has no sign-off; review the report and set `reviewed`");
  }
  if (file.reviewed.sha256 !== hash) {
    throw new SeedRefusedError(
      `seed file changed since sign-off (reviewed ${file.reviewed.sha256.slice(0, 12)}…, ` +
        `now ${hash.slice(0, 12)}…); re-run the report and sign off again`,
    );
  }

  const ids = new Map<string, string>();
  const slugs = file.venues.map((v) => v.slug);
  const existingRows = slugs.length
    ? await tx.select().from(venues).where(inArray(venues.slug, slugs))
    : [];
  const existingBySlug = new Map(existingRows.map((r) => [r.slug, r]));
  for (const r of existingRows) ids.set(r.slug, r.id);

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const v of parentsFirst(file.venues)) {
    const verification: VenueVerification = { ...v.verification, reviewed: file.reviewed };
    const row: NewVenue = {
      slug: v.slug,
      name: v.name,
      aliases: v.aliases,
      venueType: v.venueType,
      address: v.address,
      city: v.city,
      state: v.state,
      postalCode: v.postalCode,
      lat: v.lat,
      lng: v.lng,
      website: v.website,
      parentVenueId: v.parent ? ids.get(v.parent) : null,
      verification,
    };
    const existing = existingBySlug.get(v.slug);

    if (!existing) {
      const [created] = await tx.insert(venues).values(row).returning();
      ids.set(v.slug, created.id);
      await recordAction(tx, {
        runId: opts.runId,
        actor: opts.actor,
        job: "seed",
        action: "insert",
        entityType: "venue",
        entityId: created.id,
        after: created,
        reason: `Seed venue ${v.slug} (signed off by ${file.reviewed.by} on ${file.reviewed.at})`,
      });
      inserted++;
      continue;
    }

    const changes = Object.fromEntries(
      COMPARED.filter((k) => canonicalJson(existing[k] ?? null) !== canonicalJson(row[k] ?? null)).map(
        (k) => [k, row[k]],
      ),
    );
    if (Object.keys(changes).length === 0) {
      unchanged++;
      continue;
    }
    const [after] = await tx.update(venues).set(changes).where(eq(venues.id, existing.id)).returning();
    await recordAction(tx, {
      runId: opts.runId,
      actor: opts.actor,
      job: "seed",
      action: "update",
      entityType: "venue",
      entityId: existing.id,
      before: existing,
      after,
      reason: `Seed update for ${v.slug}: ${Object.keys(changes).join(", ")}`,
    });
    updated++;
  }

  const inDb = await tx.select({ slug: venues.slug }).from(venues);
  const fileSlugs = new Set(slugs);
  const notInFile = inDb.map((r) => r.slug).filter((s) => !fileSlugs.has(s));

  return { inserted, updated, unchanged, notInFile };
}
