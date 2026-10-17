import { eq, inArray } from "drizzle-orm";
import { countyOf, inCoverageArea } from "@/config/coverage";
import { recordAction } from "@/lib/actions/record";
import type { DbTx } from "@/lib/db/client";
import { type FieldProvenance, type OrganizerVerification, organizers, venues } from "@/lib/db/schema";
import { canonicalJson } from "@/lib/venues/seed-file";
import type { CheckFile, OrganizerCheck } from "./check";
import type { OrganizerSeed } from "./seed-data";

/**
 * Applies the registry seed and its check results (owner, 2026-10-16: the
 * agent verifies and logs; no sign-off). Upserts by slug, logging every
 * insert and change. An organizer is `verified` only when its own home page
 * named it; everything else stays a `candidate` with the reason in its notes.
 * A retired organizer stays retired.
 */

type Row = typeof organizers.$inferInsert;

const FIELDS = ["name", "aliases", "organizerType", "website", "city", "homeCounty", "homeState", "holdsEventsInArea", "channel", "status", "venueId", "notes", "verification"] as const;

const OUTCOME_NOTES: Record<OrganizerCheck["outcome"], string> = {
  confirmed: "",
  not_confirmed: "Not confirmed: the page at the address we had doesn't name the organizer.",
  blocked: "Not confirmed: the site refused our request (a block means stop; not retried).",
  robots_disallowed: "Not confirmed: robots.txt disallows the home page.",
  unreachable: "Not confirmed: the site didn't answer (not a block; checked again next time).",
  not_fetched: "Not fetched.",
};

const tryDetail = (r: OrganizerCheck) =>
  r.tried.map((t) => `${t.url}: ${t.result.replaceAll("_", " ")}${t.detail ? ` (${t.detail})` : ""}`).join("; ");

/** Pure: the row a seed entry and its check result produce. */
export function organizerRow(seed: OrganizerSeed, check: OrganizerCheck | undefined, checkedAt: string, venue: { id: string; website: string | null } | null): Row {
  const confirmed = check?.outcome === "confirmed" && check.website ? check : null;
  const at = (url?: string, note?: string): FieldProvenance => ({ ...(url ? { url } : {}), checkedAt, ...(note ? { note } : {}) });
  const verification: OrganizerVerification = {};
  const notes: string[] = [];
  if (seed.notes) notes.push(seed.notes);
  if (confirmed) {
    verification.name = at(confirmed.website!, "The organizer's home page names it.");
    verification.website = at(confirmed.website!, `Address from ${seed.urlFrom}; confirmed by the page.`);
    if (confirmed.eventsPage) verification.notes = [at(confirmed.eventsPage, "Events link on the home page (a hint for discovery; not checked).")];
  } else if (check) {
    const reason = check.outcome === "not_fetched" ? `Not fetched: ${check.note ?? seed.noFetch ?? "no address"}` : OUTCOME_NOTES[check.outcome];
    notes.push(reason);
    if (check.tried.length) verification.notes = [at(undefined, `Tried ${tryDetail(check)}`)];
  } else {
    notes.push("Not checked yet.");
  }
  // A never-fetched venue organizer keeps the website from our verified venue record.
  const website = confirmed ? confirmed.website : seed.noFetch && venue?.website ? venue.website : null;
  if (!confirmed && website) verification.website = at(website, "From our venue record (not fetched).");
  return {
    slug: seed.slug,
    name: seed.name,
    aliases: seed.aliases ?? [],
    organizerType: seed.type,
    website,
    city: seed.city,
    homeCounty: countyOf(seed.city),
    homeState: "AR",
    holdsEventsInArea: inCoverageArea(seed.city) ? "yes" : "unknown",
    channel: seed.channel ?? "unknown",
    status: confirmed ? "verified" : "candidate",
    lastCheckedAt: check && check.outcome !== "not_fetched" ? new Date(`${checkedAt}T12:00:00Z`) : null,
    venueId: venue?.id ?? null,
    notes: notes.join(" ") || null,
    verification,
  };
}

export async function seedOrganizers(tx: DbTx, seeds: readonly OrganizerSeed[], check: CheckFile | null, opts: { runId: string; actor: string }) {
  const slugs = [...new Set(seeds.map((s) => s.venueSlug).filter((s): s is string => !!s))];
  const vs = slugs.length ? await tx.select({ id: venues.id, slug: venues.slug, website: venues.website }).from(venues).where(inArray(venues.slug, slugs)) : [];
  const bySlug = new Map(vs.map((v) => [v.slug, v]));
  const missing = slugs.filter((s) => !bySlug.has(s));
  if (missing.length) throw new Error(`venues not in the database: ${missing.join(", ")}`);
  const checkedAt = check?.checkedAt ?? new Date().toISOString().slice(0, 10);

  const stats = { inserted: 0, updated: 0, unchanged: 0, verified: 0, candidates: 0 };
  for (const s of seeds) {
    const row = organizerRow(s, check?.results[s.slug], checkedAt, s.venueSlug ? bySlug.get(s.venueSlug)! : null);
    const [existing] = await tx.select().from(organizers).where(eq(organizers.slug, s.slug));
    if (existing?.status === "retired") row.status = "retired";
    if (row.status === "verified") stats.verified++;
    else stats.candidates++;
    const reason = row.status === "verified" ? `Registry: ${s.name} verified against its own site` : `Registry: ${s.name} added as a candidate (${row.notes ?? "not confirmed"})`;
    if (!existing) {
      const [created] = await tx.insert(organizers).values(row).returning();
      await recordAction(tx, { runId: opts.runId, actor: opts.actor, job: "seed", action: "insert", entityType: "organizer", entityId: created.id, after: created, reason: reason.slice(0, 500) });
      stats.inserted++;
      continue;
    }
    const changed = FIELDS.filter((k) => canonicalJson(existing[k] ?? null) !== canonicalJson(row[k] ?? null));
    if (changed.length === 0) {
      stats.unchanged++;
      continue;
    }
    const [after] = await tx.update(organizers).set({ ...row, updatedAt: new Date() }).where(eq(organizers.id, existing.id)).returning();
    await recordAction(tx, { runId: opts.runId, actor: opts.actor, job: "seed", action: "update", entityType: "organizer", entityId: existing.id, before: existing, after, reason: `Registry re-check (${changed.join(", ")}): ${reason}`.slice(0, 500) });
    stats.updated++;
  }
  return stats;
}
