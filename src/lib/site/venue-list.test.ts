import { describe, expect, it } from "vitest";
import { groupOf } from "@/config/venue-groups";
import { filterVenues, parseVenueFilters, venueHref, type VenueListItem } from "./venue-list";

const v = (slug: string, city: string, type: string, upcoming: number): VenueListItem => ({ slug, name: slug, city: { slug: city.toLowerCase(), name: city }, type, group: groupOf(type)!, upcoming, lat: 36.3, lng: -94.1 });
const ALL = [v("Zoo Park", "Rogers", "park", 0), v("art hall", "Bentonville", "museum", 4), v("Band Barn", "Rogers", "music_venue", 9), v("Arena", "Fayetteville", "arena", 4)];

describe("venue list filters", () => {
  it("sorts by most upcoming events by default (ties A–Z, case-insensitive), or A–Z", () => {
    expect(filterVenues(ALL, {}).map((x) => x.slug)).toEqual(["Band Barn", "Arena", "art hall", "Zoo Park"]);
    expect(filterVenues(ALL, { sort: "az" }).map((x) => x.slug)).toEqual(["Arena", "art hall", "Band Barn", "Zoo Park"]);
  });

  it("filters by city, type group, and upcoming events", () => {
    expect(filterVenues(ALL, { city: "rogers" }).map((x) => x.slug)).toEqual(["Band Barn", "Zoo Park"]);
    expect(filterVenues(ALL, { type: "music-bars" }).map((x) => x.slug)).toEqual(["Band Barn"]);
    expect(filterVenues(ALL, { upcoming: true, city: "rogers" }).map((x) => x.slug)).toEqual(["Band Barn"]);
  });

  it("keeps state in the URL and ignores unknown values", () => {
    const f = parseVenueFilters({ city: "rogers", type: "parks-trails", upcoming: "1", sort: "az" });
    expect(venueHref(f)).toBe("/venues?city=rogers&type=parks-trails&upcoming=1&sort=az");
    expect(venueHref(f, { city: undefined, upcoming: false })).toBe("/venues?type=parks-trails&sort=az");
    // Old links: ?sort=upcoming is now the default order.
    expect(parseVenueFilters({ sort: "upcoming" }).sort).toBeUndefined();
    expect(parseVenueFilters({ sort: "random", upcoming: "yes" })).toEqual({ city: undefined, type: undefined, upcoming: undefined, sort: undefined });
    expect(venueHref({})).toBe("/venues");
  });
});
