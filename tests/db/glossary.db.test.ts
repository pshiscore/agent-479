import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { agentActor, humanActor } from "@/lib/actions/record";
import { decideProposal } from "@/lib/admin/proposals";
import { getDb } from "@/lib/db/client";
import { agentActions } from "@/lib/db/schema";
import { proposeGlossaryEntries } from "@/lib/pipeline/enrich/glossary-proposals";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

describe("proposeGlossaryEntries", () => {
  it("logs one pending proposal per new expansion, never repeats it, and not after a rejection", async () => {
    await inRollback(async (tx) => {
      const c = [{ acronym: "TOEFLX", expansion: "Test of English as a Foreign Language X" }];
      const ctx = { actor: agentActor("process"), eventTitle: "TOEFLX Prep" };
      expect(await proposeGlossaryEntries(tx, c, ctx)).toBe(1);
      expect(await proposeGlossaryEntries(tx, c, ctx)).toBe(0);
      const [p] = await tx.select().from(agentActions).where(and(eq(agentActions.action, "propose_glossary"), eq(agentActions.dedupeKey, "glossary:TOEFLX:test of english as a foreign language x")));
      expect(p).toMatchObject({ approvalStatus: "pending", entityType: "glossary" });
      const r = await decideProposal(tx, p.id, "rejected", { actor: humanActor("owner"), note: "not needed" });
      expect(r.proposal.approvalStatus).toBe("rejected");
      expect(await proposeGlossaryEntries(tx, c, ctx)).toBe(0);
    });
  });
});
