import { describe, expect, it } from "vitest";
import { computeThresholds, type LabeledScore } from "./thresholds";

const cur = { tMerge: 0.85, tLlm: 0.5 };
const diff = (score: number, over: Partial<LabeledScore> = {}): LabeledScore => ({ label: "different", score, startDiffMinutes: 0, ticketmasterIdMatch: false, ...over });
const same = (score: number): LabeledScore => ({ label: "same", score, startDiffMinutes: 0, ticketmasterIdMatch: false });

describe("computeThresholds", () => {
  it("keeps the current values without labels", () => {
    expect(computeThresholds([], cur)).toMatchObject({ tMerge: 0.85, tLlm: 0.5, warnings: [] });
  });
  it("raises T_merge above the highest auto-mergeable 'different' pair, plus the margin", () => {
    expect(computeThresholds([diff(0.704), diff(0.9)], cur).tMerge).toBe(0.93);
    // Different pairs that couldn't auto-merge anyway don't count.
    expect(computeThresholds([diff(1, { startDiffMinutes: 60 }), diff(1, { subSpaceDiffers: true })], cur).tMerge).toBe(0.85);
  });
  it("lowers T_llm to the lowest 'same' pair, never raises it", () => {
    expect(computeThresholds([same(0.42), same(0.9)], cur).tLlm).toBe(0.42);
    expect(computeThresholds([same(0.7)], cur).tLlm).toBe(0.5);
  });
  it("warns when a 'different' pair has a perfect title score", () => {
    expect(computeThresholds([diff(1)], cur).warnings).toHaveLength(1);
  });
});
