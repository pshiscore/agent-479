import { describe, expect, it } from "vitest";
import { coverage } from "./report";

describe("coverage", () => {
  it("leaves outside-area items out of the total and reports live and potential coverage", () => {
    const c = coverage([
      { result: "live", missReason: null },
      { result: "live", missReason: null },
      { result: "review", missReason: null },
      { result: "shadow", missReason: null },
      { result: "missed", missReason: "no_source" },
      { result: "missed", missReason: null },
      { result: "missed", missReason: "outside_area" },
    ]);
    expect(c).toEqual({ total: 6, outside: 1, live: 2, review: 1, shadow: 1, missed: 2, unexplained: 1, livePct: 33.3, potentialPct: 66.7 });
  });

  it("has no percentages for an empty week", () => {
    expect(coverage([{ result: "missed", missReason: "outside_area" }])).toMatchObject({ total: 0, outside: 1, livePct: null, potentialPct: null });
  });
});
