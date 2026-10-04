import { eq, inArray } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import type { DbTx } from "@/lib/db/client";
import { linkPolicies, sources, venues } from "@/lib/db/schema";
import { normalizeDomain } from "@/lib/links";
import { canonicalJson } from "@/lib/venues/seed-file";
import type { LinkPolicySeed, SourceSeed } from "./seed-data";

type NewSource = typeof sources.$inferInsert;
type NewLinkPolicy = typeof linkPolicies.$inferInsert;

/** Fields the seed owns. enabled, disabled_reason, and the fetch-health columns belong to the pipeline. */
const SOURCE_FIELDS = [
  "name",
  "kind",
  "fetcher",
  "baseUrl",
  "config",
  "defaultVenueId",
  "trustLevel",
  "fetchIntervalMinutes",
  "commercialUseOk",
  "termsNotes",
] as const;
const POLICY_FIELDS = ["mode", "homepageUrl", "reason"] as const;

interface SeedOpts {
  runId: string;
  actor: string;
}

const differs = <T extends object>(a: T, b: Partial<T>, keys: readonly (keyof T)[]) =>
  keys.filter((k) => canonicalJson(a[k] ?? null) !== canonicalJson(b[k] ?? null));

/**
 * Upserts sources by slug, logging every change. New sources start disabled
 * (untested, or awaiting_permission); an existing source's `enabled` and
 * `disabled_reason` are never changed here, because switching a source on or
 * off is its own explicit, logged action.
 */
export async function seedSources(tx: DbTx, seeds: readonly SourceSeed[], opts: SeedOpts) {
  const venueSlugs = [...new Set(seeds.map((s) => s.defaultVenueSlug).filter((s): s is string => !!s))];
  const venueRows = venueSlugs.length
    ? await tx.select({ id: venues.id, slug: venues.slug }).from(venues).where(inArray(venues.slug, venueSlugs))
    : [];
  const venueIds = new Map(venueRows.map((v) => [v.slug, v.id]));
  const missing = venueSlugs.filter((s) => !venueIds.has(s));
  if (missing.length) throw new Error(`default venues not in the database: ${missing.join(", ")}`);

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  for (const s of seeds) {
    const row: NewSource = {
      slug: s.slug,
      name: s.name,
      kind: s.kind,
      fetcher: s.fetcher,
      baseUrl: s.baseUrl,
      config: s.config,
      defaultVenueId: s.defaultVenueSlug ? venueIds.get(s.defaultVenueSlug) : null,
      trustLevel: s.trustLevel,
      fetchIntervalMinutes: s.fetchIntervalMinutes,
      commercialUseOk: s.commercialUseOk,
      termsNotes: s.termsNotes,
    };
    const [existing] = await tx.select().from(sources).where(eq(sources.slug, s.slug));
    if (!existing) {
      // New sources start off: launch sources untested, the rest awaiting permission.
      const [created] = await tx
        .insert(sources)
        .values({ ...row, enabled: false, disabledReason: s.launch ? "untested" : "awaiting_permission" })
        .returning();
      await recordAction(tx, {
        runId: opts.runId,
        actor: opts.actor,
        job: "seed",
        action: "insert",
        entityType: "source",
        entityId: created.id,
        after: created,
        reason: `Seed source ${s.slug} (disabled${s.launch ? "; enabled in step 9" : ""})`,
      });
      inserted++;
      continue;
    }
    const changed = differs(existing, row, SOURCE_FIELDS);
    if (changed.length === 0) {
      unchanged++;
      continue;
    }
    const [after] = await tx
      .update(sources)
      .set(Object.fromEntries(changed.map((k) => [k, row[k]])))
      .where(eq(sources.id, existing.id))
      .returning();
    await recordAction(tx, {
      runId: opts.runId,
      actor: opts.actor,
      job: "seed",
      action: "update",
      entityType: "source",
      entityId: existing.id,
      before: existing,
      after,
      reason: `Seed update for ${s.slug}: ${changed.join(", ")}`,
    });
    updated++;
  }
  return { inserted, updated, unchanged };
}

/** Upserts link policies by normalized domain, logging every change. Never deletes one. */
export async function seedLinkPolicies(tx: DbTx, seeds: readonly LinkPolicySeed[], opts: SeedOpts) {
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  for (const p of seeds) {
    const domain = normalizeDomain(p.domain);
    if (!domain) throw new Error(`not a domain: ${JSON.stringify(p.domain)}`);
    const row: NewLinkPolicy = { domain, mode: p.mode, homepageUrl: p.homepageUrl, reason: p.reason };
    const [existing] = await tx.select().from(linkPolicies).where(eq(linkPolicies.domain, domain));
    if (!existing) {
      const [created] = await tx.insert(linkPolicies).values(row).returning();
      await recordAction(tx, {
        runId: opts.runId,
        actor: opts.actor,
        job: "seed",
        action: "insert",
        entityType: "link_policy",
        entityId: created.id,
        after: created,
        reason: `Seed link policy ${domain}: ${p.mode}`,
      });
      inserted++;
      continue;
    }
    const changed = differs(existing, row, POLICY_FIELDS);
    if (changed.length === 0) {
      unchanged++;
      continue;
    }
    const [after] = await tx
      .update(linkPolicies)
      .set(Object.fromEntries(changed.map((k) => [k, row[k]])))
      .where(eq(linkPolicies.id, existing.id))
      .returning();
    await recordAction(tx, {
      runId: opts.runId,
      actor: opts.actor,
      job: "seed",
      action: "update",
      entityType: "link_policy",
      entityId: existing.id,
      before: existing,
      after,
      reason: `Seed update for link policy ${domain}: ${changed.join(", ")}`,
    });
    updated++;
  }
  return { inserted, updated, unchanged };
}
