import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { humanActor } from "@/lib/actions/record";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, linkPolicies, runs, sources, venueExternalIds, venues } from "@/lib/db/schema";
import { applyLinkPolicy, loadLinkPolicies } from "@/lib/links";
import { startRun } from "@/lib/runs";
import { seedLinkPolicies, seedSources } from "@/lib/sources/seed";
import { LINK_POLICY_SEEDS, type SourceSeed } from "@/lib/sources/seed-data";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const tag = randomUUID().slice(0, 8);
const actor = humanActor("seed-sources-test");

const seed = (over: Partial<SourceSeed> = {}): SourceSeed => ({
  slug: `test-source-${tag}`,
  name: "Test Source",
  kind: "ics",
  fetcher: "ics",
  baseUrl: "https://example.org/",
  config: { catIds: [1] },
  defaultVenueSlug: null,
  trustLevel: 3,
  fetchIntervalMinutes: 60,
  commercialUseOk: "unknown",
  termsNotes: "test",
  launch: true,
  ...over,
});

async function pgError(tx: DbTx, query: (tx: DbTx) => Promise<unknown>): Promise<string | undefined> {
  try {
    await tx.transaction(async (sp) => {
      await query(sp);
    });
    return undefined;
  } catch (err) {
    const cause = (err as { cause?: { constraint_name?: string; message?: string } }).cause;
    return cause?.constraint_name ?? cause?.message ?? String(err);
  }
}

describe("sources table", () => {
  it("can't enable a source with no fetcher", async () => {
    await inRollback(async (tx) => {
      const base = { slug: `s-${tag}`, name: "S", baseUrl: "https://example.org/", trustLevel: 3, fetchIntervalMinutes: 60, termsNotes: "t" };
      expect(await pgError(tx, (sp) => sp.insert(sources).values({ ...base, enabled: true }))).toBe(
        "sources_enabled_check",
      );
      expect(await pgError(tx, (sp) => sp.insert(sources).values({ ...base, trustLevel: 6 }))).toBe("sources_trust_check");
      expect(await pgError(tx, (sp) => sp.insert(sources).values({ ...base, baseUrl: "http://example.org/" }))).toBe(
        "sources_base_url_check",
      );
      const [s] = await tx.insert(sources).values(base).returning();
      expect(s).toMatchObject({ enabled: false, dedupMode: "shadow", commercialUseOk: "unknown" });
    });
  });

  it("is now the target of runs.source_id and venue_external_ids.source_id", async () => {
    await inRollback(async (tx) => {
      expect(await pgError(tx, (sp) => sp.insert(runs).values({ job: "fetch", sourceId: randomUUID() }))).toBe(
        "runs_source_id_sources_id_fk",
      );
      const [v] = await tx
        .insert(venues)
        .values({ slug: `v-${tag}`, name: "V", address: "1 A St", city: "Rogers", lat: 36.3, lng: -94.1, venueType: "other" })
        .returning();
      expect(
        await pgError(tx, (sp) =>
          sp.insert(venueExternalIds).values({ venueId: v.id, sourceId: randomUUID(), externalId: "x" }),
        ),
      ).toBe("venue_external_ids_source_id_sources_id_fk");
    });
  });
});

describe("link_policies table", () => {
  it("requires a homepage for homepage_only and a bare domain", async () => {
    await inRollback(async (tx) => {
      const ins = (v: Partial<typeof linkPolicies.$inferInsert>) => (sp: DbTx) =>
        sp.insert(linkPolicies).values({ domain: `t${tag}.example.org`, mode: "deep", reason: "t", ...v });
      expect(await pgError(tx, ins({ mode: "homepage_only" }))).toBe("link_policies_homepage_check");
      expect(await pgError(tx, ins({ domain: `www.t${tag}.example.org` }))).toBe("link_policies_domain_check");
      expect(await pgError(tx, ins({ domain: "https://x.org" }))).toBe("link_policies_domain_check");
      expect(await pgError(tx, ins({}))).toBeUndefined();
    });
  });
});

describe("seedSources", () => {
  it("inserts disabled, logs it, is idempotent, and never changes enabled", async () => {
    await inRollback(async (tx) => {
      const run = await startRun(tx, "seed");
      const opts = { runId: run.id, actor };
      expect(await seedSources(tx, [seed()], opts)).toEqual({ inserted: 1, updated: 0, unchanged: 0 });
      const [s] = await tx.select().from(sources).where(eq(sources.slug, `test-source-${tag}`));
      expect(s.enabled).toBe(false);

      expect(await seedSources(tx, [seed()], opts)).toEqual({ inserted: 0, updated: 0, unchanged: 1 });

      // Turned on elsewhere (step 9), then re-seeded with a changed interval.
      await tx.update(sources).set({ enabled: true }).where(eq(sources.id, s.id));
      expect(await seedSources(tx, [seed({ fetchIntervalMinutes: 120 })], opts)).toEqual({
        inserted: 0,
        updated: 1,
        unchanged: 0,
      });
      const [after] = await tx.select().from(sources).where(eq(sources.id, s.id));
      expect(after).toMatchObject({ enabled: true, fetchIntervalMinutes: 120 });

      const logged = await tx
        .select({ action: agentActions.action, reason: agentActions.reason })
        .from(agentActions)
        .where(and(eq(agentActions.runId, run.id), eq(agentActions.entityType, "source")));
      // One transaction shares one now(), so row order isn't guaranteed: compare as a set.
      expect(logged.map((l) => l.action).sort()).toEqual(["insert", "update"]);
      expect(logged.find((l) => l.action === "update")?.reason).toMatch(/fetchIntervalMinutes/);
    });
  });

  it("resolves default venues by slug and refuses unknown ones", async () => {
    await inRollback(async (tx) => {
      const run = await startRun(tx, "seed");
      const opts = { runId: run.id, actor };
      const [v] = await tx
        .insert(venues)
        .values({ slug: `lib-${tag}`, name: "Lib", address: "1 A St", city: "Rogers", lat: 36.3, lng: -94.1, venueType: "library" })
        .returning();
      await seedSources(tx, [seed({ defaultVenueSlug: `lib-${tag}` })], opts);
      const [s] = await tx.select().from(sources).where(eq(sources.slug, `test-source-${tag}`));
      expect(s.defaultVenueId).toBe(v.id);
      await expect(seedSources(tx, [seed({ slug: `other-${tag}`, defaultVenueSlug: "nope" })], opts)).rejects.toThrow(
        /not in the database: nope/,
      );
    });
  });
});

describe("seedLinkPolicies", () => {
  it("normalizes domains, so differently written duplicates can't be stored", async () => {
    await inRollback(async (tx) => {
      const run = await startRun(tx, "seed");
      const opts = { runId: run.id, actor };
      const policy = { mode: "homepage_only" as const, homepageUrl: `https://n${tag}.example.org/`, reason: "test" };
      await seedLinkPolicies(tx, [{ ...policy, domain: `n${tag}.example.org` }], opts);
      for (const variant of [`WWW.N${tag}.Example.ORG.`, `n${tag}.example.org:443`, `https://www.n${tag}.example.org/x`]) {
        expect(await seedLinkPolicies(tx, [{ ...policy, domain: variant }], opts)).toEqual({
          inserted: 0,
          updated: 0,
          unchanged: 1,
        });
      }
      const rows = await tx.select().from(linkPolicies).where(eq(linkPolicies.domain, `n${tag}.example.org`));
      expect(rows).toHaveLength(1);
      await expect(seedLinkPolicies(tx, [{ ...policy, domain: "not a domain" }], opts)).rejects.toThrow(/not a domain/);
    });
  });

  it("seeds the homepage-only policies that applyLinkPolicy then enforces", async () => {
    await inRollback(async (tx) => {
      const run = await startRun(tx, "seed");
      const opts = { runId: run.id, actor };
      // The real policies may already exist from the live seed; either way the end state is the same.
      const first = await seedLinkPolicies(tx, LINK_POLICY_SEEDS, opts);
      expect(first.inserted + first.unchanged + first.updated).toBe(2);
      expect(await seedLinkPolicies(tx, LINK_POLICY_SEEDS, opts)).toEqual({ inserted: 0, updated: 0, unchanged: 2 });

      const policies = await loadLinkPolicies(tx);
      expect(applyLinkPolicy("https://crystalbridges.org/calendar/some-event/", policies)).toBe(
        "https://crystalbridges.org/",
      );
      expect(applyLinkPolicy("https://www.themomentary.org/events/x", policies)).toBe("https://themomentary.org/");
    });
  });
});
