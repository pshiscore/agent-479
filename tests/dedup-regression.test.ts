import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEDUP_THRESHOLDS } from "@/config/dedup";
import { preDecide, scorePair } from "@/lib/pipeline/dedup/score";

/**
 * Plan section 6, rule 7: the owner's labeled pairs, with frozen facts, run
 * through the pure score-and-decide code on every test run. It fails if a
 * "different" pair would auto-merge, or if a "same" pair scores below T_llm
 * (so the engine would never even ask). Export: npm run dedup:export-labels.
 */

interface Side { title: string; startAt: string; ticketUrl: string | null; sourceUrl: string | null; subSpace: string | null; source: string }
const { pairs } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "fixtures/dedup/labels.json"), "utf8")) as {
  pairs: { label: "same" | "different"; a: Side; b: Side }[];
};

const side = (s: Side) => ({ title: s.title, startAt: new Date(s.startAt), ticketUrl: s.ticketUrl, sourceUrl: s.sourceUrl, subSpace: s.subSpace });
const thresholds = { merge: DEDUP_THRESHOLDS.tMerge, llm: DEDUP_THRESHOLDS.tLlm };
const name = (p: (typeof pairs)[number]) => `${p.label}: "${p.a.title}" (${p.a.source}) / "${p.b.title}" (${p.b.source})`;

describe("dedup regression set", () => {
  it("has a labels file (empty until the owner labels pairs)", () => {
    expect(Array.isArray(pairs)).toBe(true);
  });

  it.each(pairs.filter((p) => p.label === "different").map((p) => [name(p), p] as const))("never auto-merges %s", (_n, p) => {
    expect(preDecide(scorePair(side(p.a), side(p.b)), thresholds)).not.toBe("auto_merge");
  });

  it.each(pairs.filter((p) => p.label === "same").map((p) => [name(p), p] as const))("never dismisses %s without asking", (_n, p) => {
    const s = scorePair(side(p.a), side(p.b));
    expect(s.score >= thresholds.llm || s.ticketmasterIdMatch).toBe(true);
  });
});
