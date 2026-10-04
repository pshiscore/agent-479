import { describe, expect, it } from "vitest";
import { isVagueLocation, looksLikeProse, pageDescriptionText, parsePlaceMicrodata } from "./location-detail";

// Written for this test in the shape of a CivicPlus detail page; not source text.
const page = (place: string, description = "") => `
<html><body><script>var location = "x";</script>
<div itemprop="location" itemscope class="fr-view" itemtype="http://schema.org/Place">
  <div class="specificDetail"><div class="specificDetailHeader">Location:</div>
    <div class="specificDetailItem"><div itemprop="name"> ${place} </div></div></div>
  <div class="specificDetail"><div class="specificDetailHeader">Address:</div>
    <div class="specificDetailItem"><span itemprop="address" itemscope itemtype="http://schema.org/PostalAddress">
      <span itemprop="streetAddress">200 NE A St</span> <span itemprop="addressLocality">Bentonville</span>,
      <span itemprop="addressRegion">AR</span> <span itemprop="postalCode">72712</span></span></div></div>
</div>
<span itemprop="performer" itemtype="http://schema.org/Person"> </span>
<div itemprop="description" class="fr-view">${description}</div>
<ul itemprop="documents" class="documentsList"><li></li></ul>
</body></html>`;

const loc = (over: Partial<{ name: string | null; street: string | null; city: string | null; externalVenueId: string | null }>) => ({
  text: null, name: null, room: null, street: null, city: "Bentonville", externalVenueId: null, ...over,
});

describe("isVagueLocation", () => {
  it("is vague for a bare city or ZIP, a placeholder name, or prose", () => {
    expect(isVagueLocation(loc({}))).toBe(true);
    expect(isVagueLocation(loc({ name: "Event Location" }))).toBe(true);
    expect(isVagueLocation(loc({ name: "The City is pleased to offer shredding for personal papers. Watch for details." }))).toBe(true);
  });
  it("isn't vague with a street, a real name, or an external venue ID", () => {
    expect(isVagueLocation(loc({ street: "200 NE A St" }))).toBe(false);
    expect(isVagueLocation(loc({ name: "Bentonville Square" }))).toBe(false);
    expect(isVagueLocation(loc({ externalVenueId: "KovZ1" }))).toBe(false);
  });
  it("looksLikeProse spots sentences and long text", () => {
    expect(looksLikeProse("Lawrence Plaza")).toBe(false);
    expect(looksLikeProse("Offered by the city. Sign up soon")).toBe(true);
    expect(looksLikeProse("one two three four five six seven eight nine ten eleven")).toBe(true);
  });
});

describe("parsePlaceMicrodata", () => {
  it("reads the Place's name, street, and city", () => {
    expect(parsePlaceMicrodata(page("Lawrence Plaza"))).toEqual({ name: "Lawrence Plaza", street: "200 NE A St", city: "Bentonville" });
  });
  it("treats the placeholder name as no name", () => {
    expect(parsePlaceMicrodata(page("Event Location"))?.name).toBeNull();
  });
  it("returns null without a Place, and reads the description text separately", () => {
    expect(parsePlaceMicrodata("<html><body>nothing</body></html>")).toBeNull();
    expect(pageDescriptionText(page("Event Location", "<p>Meet at the <b>square</b>.</p>"))).toBe("Meet at the square.");
    expect(pageDescriptionText(page("Event Location"))).toBeNull();
  });
});
