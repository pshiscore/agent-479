/**
 * The coverage area: Benton and Washington counties (owner, 2026-10-05;
 * AGENTS.md, Data). Incorporated places and census-designated places from
 * Wikipedia's county pages, read 2026-10-05:
 * https://en.wikipedia.org/wiki/Benton_County,_Arkansas
 * https://en.wikipedia.org/wiki/Washington_County,_Arkansas
 * Elm Springs and Springdale span both counties. A city name is a proxy for
 * the county: some mailing addresses name a town in another county (the
 * War Eagle Fair lists Hindsville, in Madison County), so a venue's county
 * is confirmed from its location when it's verified.
 */

export const COVERAGE_COUNTIES = ["Benton", "Washington"] as const;

const BENTON = [
  // Cities
  "Bella Vista", "Bentonville", "Bethel Heights", "Cave Springs", "Centerton", "Decatur", "Elm Springs", "Gentry", "Gravette",
  "Little Flock", "Lowell", "Pea Ridge", "Rogers", "Siloam Springs", "Springdale", "Sulphur Springs",
  // Towns
  "Avoca", "Garfield", "Gateway", "Highfill", "Springtown",
  // Census-designated places
  "Cherokee City", "Lost Bridge Village", "Maysville", "Prairie Creek",
];

const WASHINGTON = [
  // Cities
  "Elkins", "Elm Springs", "Farmington", "Fayetteville", "Goshen", "Greenland", "Johnson", "Lincoln", "Prairie Grove",
  "Springdale", "Tontitown", "West Fork", "Winslow",
  // Census-designated places
  "Canehill", "Cincinnati", "Evansville", "Morrow",
];

/** Every place in the area, by name, for forms (Elm Springs and Springdale appear once). */
export const COVERAGE_PLACE_NAMES: readonly string[] = [...new Set([...BENTON, ...WASHINGTON])].sort();

export const COVERAGE_PLACES: ReadonlySet<string> = new Set([...BENTON, ...WASHINGTON].map((c) => c.toLowerCase()));

/** Whether a city or town is inside the coverage area. */
export const inCoverageArea = (city: string | null | undefined) => Boolean(city && COVERAGE_PLACES.has(city.trim().toLowerCase()));

/** The county a place is in, or null when it spans both (Springdale, Elm Springs) or is outside the area. */
export function countyOf(city: string | null | undefined): (typeof COVERAGE_COUNTIES)[number] | null {
  const c = city?.trim().toLowerCase();
  if (!c) return null;
  const benton = BENTON.some((b) => b.toLowerCase() === c);
  const washington = WASHINGTON.some((w) => w.toLowerCase() === c);
  return benton && !washington ? "Benton" : washington && !benton ? "Washington" : null;
}
