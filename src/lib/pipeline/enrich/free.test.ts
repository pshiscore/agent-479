import { describe, expect, it } from "vitest";
import { decideFree } from "./free";

const NOTE = "Programs are free unless the event lists a fee.";
const f = (min: number | null = null) => ({ title: "Story Time", price: { min, max: min, currency: null } });
const ex = (over: Record<string, unknown> = {}) => ({ isFree: null, priceMin: null, priceMax: null, ...over });

describe("decideFree", () => {
  it("is free on the listing's own word, whatever the source says", () => {
    expect(decideFree(f(), ex({ isFree: true }), "Free!", null)).toEqual({ isFree: true, basis: "stated" });
  });

  it("is not free with a structured or stated price", () => {
    expect(decideFree(f(25), ex({ isFree: true }), null, NOTE)).toEqual({ isFree: false, basis: null });
    expect(decideFree(f(), ex({ priceMin: 5 }), "Tickets $5.", NOTE)).toEqual({ isFree: false, basis: null });
  });

  it("uses the source default only when the listing never mentions a fee, cost, or ticket", () => {
    expect(decideFree(f(), ex(), "Stories and songs for preschoolers.", NOTE)).toEqual({ isFree: true, basis: "source_default" });
    for (const text of ["A $10 materials fee applies.", "Cost covers supplies.", "Tickets at the door.", "Admission required."]) {
      expect(decideFree(f(), ex(), text, NOTE)).toEqual({ isFree: null, basis: null });
    }
  });

  it("stays unknown without a statement or a source default", () => {
    expect(decideFree(f(), ex(), "Stories and songs.", null)).toEqual({ isFree: null, basis: null });
    expect(decideFree(f(), null, null, null)).toEqual({ isFree: null, basis: null });
  });
});
