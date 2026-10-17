import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { agentActor } from "@/lib/actions/record";
import { getDb } from "@/lib/db/client";
import { agentActions, organizers } from "@/lib/db/schema";
import type { CheckFile } from "@/lib/organizers/check";
import { seedOrganizers } from "@/lib/organizers/seed";
import type { OrganizerSeed } from "@/lib/organizers/seed-data";
import { startRun } from "@/lib/runs";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const SEEDS: OrganizerSeed[] = [
  { slug: "test-brewery", name: "Test Brewery", type: "business", city: "Rogers", urls: ["https://brewery.example/"], urlFrom: "test" },
  { slug: "test-library", name: "Test Library", type: "library", city: "Gravette", urls: ["https://library.example/"], urlFrom: "test" },
];
const CHECK: CheckFile = {
  checkedAt: "2026-10-17",
  results: {
    "test-brewery": { outcome: "confirmed", website: "https://brewery.example/", eventsPage: "https://brewery.example/events", tried: [{ url: "https://brewery.example/", result: "confirmed" }] },
    "test-library": { outcome: "blocked", website: null, eventsPage: null, tried: [{ url: "https://library.example/", result: "blocked", detail: "HTTP 403" }] },
  },
};

describe("seedOrganizers", () => {
  it("inserts verified and candidate organizers, logged as the agent; re-running changes nothing; retired stays retired", async () => {
    await inRollback(async (tx) => {
      const run = await startRun(tx, "seed");
      const opts = { runId: run.id, actor: agentActor("registry") };
      expect(await seedOrganizers(tx, SEEDS, CHECK, opts)).toMatchObject({ inserted: 2, verified: 1, candidates: 1 });
      const rows = await tx.select().from(organizers).where(inArray(organizers.slug, ["test-brewery", "test-library"]));
      const brewery = rows.find((r) => r.slug === "test-brewery")!;
      const library = rows.find((r) => r.slug === "test-library")!;
      expect(brewery).toMatchObject({ status: "verified", website: "https://brewery.example/", homeCounty: "Benton", holdsEventsInArea: "yes" });
      expect(library).toMatchObject({ status: "candidate", website: null });
      expect(library.notes).toMatch(/refused our request/);
      const logged = await tx.select().from(agentActions).where(and(eq(agentActions.entityType, "organizer"), inArray(agentActions.entityId, [brewery.id, library.id])));
      expect(logged.map((a) => a.actor)).toEqual(["agent:registry", "agent:registry"]);

      expect(await seedOrganizers(tx, SEEDS, CHECK, opts)).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });

      await tx.update(organizers).set({ status: "retired" }).where(eq(organizers.id, brewery.id));
      await seedOrganizers(tx, SEEDS, CHECK, opts);
      const [after] = await tx.select().from(organizers).where(eq(organizers.id, brewery.id));
      expect(after.status).toBe("retired");
    });
  });
});
