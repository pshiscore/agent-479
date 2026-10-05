import { describe, expect, it, vi } from "vitest";
import type { Generate } from "@/lib/pipeline/enrich/types";
import { addableFacts, describePlace, placeFacts, type PlaceFacts } from "./describe";

const base: PlaceFacts = { name: "Preview Bakery", type: "Bakery", kind: "New", address: "100 W Test Ave", city: "Fayetteville", when: "Opened Sept 20, 2026", stated: [] };

/** A fake model that answers each call in turn. */
function fake(...answers: { description: string | null; usedFacts: number[] }[]) {
  let i = 0;
  return vi.fn(async (req: { schema: { parse: (v: unknown) => unknown } }) => ({ data: req.schema.parse(answers[Math.min(i++, answers.length - 1)]), callId: `call-${i}`, model: "fake", costUsd: 0 })) as unknown as Generate;
}

describe("place descriptions", () => {
  it("makes no model call when nothing is stated beyond the name and type", async () => {
    const gen = fake({ description: "x".repeat(30), usedFacts: [0] });
    expect(await describePlace(gen, { ...base, stated: ["A bakery"] })).toMatchObject({ status: "none", attempts: 0 });
    expect(gen).not.toHaveBeenCalled();
  });

  it("keeps a description that uses a stated fact, and records which", async () => {
    const f = { ...base, stated: ["Serves breakfast and lunch"] };
    expect(addableFacts(f)).toEqual(["Serves breakfast and lunch"]);
    const r = await describePlace(fake({ description: "A new bakery serving breakfast and lunch.", usedFacts: [0] }), f);
    expect(r).toMatchObject({ status: "ok", usedFacts: ["Serves breakfast and lunch"], attempts: 1 });
  });

  it("returns none when the claimed fact isn't actually in the text", async () => {
    const r = await describePlace(fake({ description: "A new bakery that opened in Fayetteville this fall.", usedFacts: [0] }), { ...base, stated: ["Serves breakfast and lunch"] });
    expect(r.status).toBe("none");
  });

  it("regenerates once on praise or an invented name, then holds", async () => {
    const f = { ...base, stated: ["Serves breakfast and lunch"] };
    const gen = fake(
      { description: "The best new bakery in town, serving breakfast and lunch.", usedFacts: [0] },
      { description: "Chef Marco Rossi serves breakfast and lunch at this bakery.", usedFacts: [0] },
    );
    const r = await describePlace(gen, f);
    expect(r).toMatchObject({ status: "held", attempts: 2 });
    expect(gen).toHaveBeenCalledTimes(2);
  });

  it("uses only owner-verified sources' facts", () => {
    const f = placeFacts({
      name: "X", placeType: "cafe", kind: "new", address: "1 A St", addressKind: "street", city: "Rogers", status: "open",
      openedOn: "2026-09-01", openedPrecision: "day", openedQualifier: null, targetOn: null, targetPrecision: null, targetQualifier: null,
      sources: [
        { url: "https://a.example", verifiedBy: "owner", confirmed: "seen", facts: ["Has a drive-through"] },
        { url: "https://b.example", note: "lead", facts: ["Open late"] },
      ],
    });
    expect(f.stated).toEqual(["Has a drive-through"]);
    expect(f.type).toBe("Cafe");
  });
});
