import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { Deadline } from "@/lib/cron-budget";
import { getDb } from "@/lib/db/client";
import { rawRecords, sources } from "@/lib/db/schema";
import { runMaintenanceJob } from "@/lib/pipeline/maintenance";
import { runProcessJob } from "@/lib/pipeline/process";
import { startRun } from "@/lib/runs";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const spent = () => new Deadline(0);

describe("cron time budget", () => {
  it("process: out of time, it starts nothing, leaves records pending, and records why", async () => {
    await inRollback(async (tx) => {
      const [src] = await tx.select().from(sources).limit(1);
      const run = await startRun(tx, "fetch", { sourceId: src.id });
      const [rec] = await tx.insert(rawRecords).values({ sourceId: src.id, runId: run.id, externalId: `budget-${Date.now()}`, contentHash: "h", payload: { x: 1 }, fetchedAt: new Date(0) }).returning();
      const stats = await runProcessJob(tx, { deadline: spent(), llmPick: null });
      expect(stats).toMatchObject({ stoppedForTime: true });
      expect(stats!.phasesSkipped).toEqual(expect.arrayContaining(["records", "series", "feature", "venue proposals"]));
      const [after] = await tx.select().from(rawRecords).where(eq(rawRecords.id, rec.id));
      expect(after.status).toBe("pending");
    });
  });

  it("maintenance: out of time, the remaining steps wait for the next daily run", async () => {
    await inRollback(async (tx) => {
      const stats = await runMaintenanceJob(tx, { deadline: spent() });
      expect(stats).toMatchObject({ stoppedForTime: true, descriptionsPurged: 0, sourcesDemoted: 0 });
      expect(stats!.stepsSkipped).toHaveLength(7);
      expect(stats!.stepsSkipped).toContain("rediscovery");
    });
  });
});
