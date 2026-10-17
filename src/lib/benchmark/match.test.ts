import { describe, expect, it } from "vitest";
import { type Candidate, pickMatch } from "./match";

const ev = (title: string, status = "scheduled"): Candidate => ({ kind: "event", id: `e-${title}-${status}`, title, status });
const item = (title: string, over: Partial<Extract<Candidate, { kind: "proposal" }>> = {}): Candidate => ({
  kind: "proposal",
  id: `p-${title}-${over.origin ?? "owner_form"}-${over.status ?? "pending"}`,
  title,
  status: "pending",
  origin: "owner_form",
  flags: [],
  rejectKind: null,
  ...over,
});

describe("pickMatch", () => {
  it("prefers live over review over shadow", () => {
    const all = [item("Fall Festivities", { origin: "shadow" }), item("Fall Festivities"), ev("Fall Festivities")];
    expect(pickMatch("Fall Festivities", all)).toMatchObject({ result: "live", eventId: "e-Fall Festivities-scheduled", proposalId: null });
    expect(pickMatch("Fall Festivities", all.slice(0, 2))).toMatchObject({ result: "review", proposalId: "p-Fall Festivities-owner_form-pending" });
    expect(pickMatch("Fall Festivities", all.slice(0, 1))).toMatchObject({ result: "shadow", proposalId: "p-Fall Festivities-shadow-pending" });
  });

  it("matches a shorter roundup name against a longer title, but not one shared word", () => {
    expect(pickMatch("Fall Festivities", [ev("Fall Festivities at Pea Ridge City Park")])).toMatchObject({ result: "live" });
    expect(pickMatch("Harvest Market", [ev("Harvest Dance")])).toMatchObject({ result: "missed", suggestedReason: null });
  });

  it("an out-of-area hold is missed as outside the coverage area, so it leaves the total", () => {
    expect(pickMatch("Vintage Market Days", [item("Vintage Market Days", { origin: "shadow", flags: ["outside_coverage"] })])).toMatchObject({
      result: "missed",
      missReason: "outside_area",
      proposalId: null,
    });
  });

  it("suggests a reason from a rejected item or hidden event; the owner still picks", () => {
    expect(pickMatch("City Council Meeting", [item("City Council Meeting", { status: "rejected", rejectKind: "filtered" })])).toMatchObject({ result: "missed", missReason: null, suggestedReason: "filtered" });
    expect(pickMatch("Story Time", [ev("Story Time", "hidden")])).toMatchObject({ result: "missed", missReason: null, suggestedReason: "rejected" });
  });
});
