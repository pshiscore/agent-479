import { inCoverageArea } from "@/config/coverage";
import type { SeedVenue } from "./seed-file";
import { venueNameKeys } from "./normalize";
import { streetDifference } from "./street";

/**
 * Offline checks on the venue seed file. Errors block seeding; warnings go in
 * the report for the owner to judge.
 */

export type IssueLevel = "error" | "warning";
export interface VenueIssue {
  slug: string;
  level: IssueLevel;
  message: string;
}

/** Benton and Washington counties, out to Eureka Springs and Huntsville. */

export const NWA_BOUNDS = { minLat: 35.7, maxLat: 36.5, minLng: -94.62, maxLng: -93.45 } as const;

export const NWA_CITIES = new Set([
  "Bella Vista",
  "Bentonville",
  "Cave Springs",
  "Centerton",
  "Elkins",
  "Elm Springs",
  "Eureka Springs",
  "Farmington",
  "Fayetteville",
  "Garfield",
  "Gentry",
  "Goshen",
  "Gravette",
  "Greenland",
  "Highfill",
  "Huntsville",
  "Johnson",
  "Lincoln",
  "Lowell",
  "Pea Ridge",
  "Prairie Grove",
  "Rogers",
  "Siloam Springs",
  "Springdale",
  "Tontitown",
  "West Fork",
]);

/** Closer than this, two unrelated venues are probably the same place. */
export const NEAR_DUPLICATE_METERS = 75;
/** Provenance older than this gets re-checked before sign-off. */
export const STALE_PROVENANCE_DAYS = 180;
/**
 * Geocoder vs. seed distance: above warn goes in the report, above error
 * blocks sign-off. Parks (including trails) and campuses span hundreds of
 * acres, and their point is the middle while their address is an entrance,
 * so they get more room. Everything else errors above 1 km, whatever the
 * cause: a far-off match usually means the address itself is wrong.
 */
export const GEOCODE_LIMITS = {
  default: { warn: 250, error: 1_000 },
  large: { warn: 1_000, error: 3_000 },
} as const;
const LARGE_VENUE_TYPES = new Set<string>(["park", "campus"]);

export function geocodeLimits(venueType: string) {
  return LARGE_VENUE_TYPES.has(venueType) ? GEOCODE_LIMITS.large : GEOCODE_LIMITS.default;
}

/** Great-circle distance in meters. */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

const DAY_MS = 86_400_000;

export function checkVenues(venues: readonly SeedVenue[], today: Date): VenueIssue[] {
  const issues: VenueIssue[] = [];
  const add = (slug: string, level: IssueLevel, message: string) =>
    issues.push({ slug, level, message });
  const bySlug = new Map<string, SeedVenue>();

  for (const v of venues) {
    if (bySlug.has(v.slug)) add(v.slug, "error", "duplicate slug");
    bySlug.set(v.slug, v);
  }

  const parentOf = (v: SeedVenue) => (v.parent ? bySlug.get(v.parent) : undefined);
  // Areas contain venues by design, so they're never near-duplicates.
  const related = (a: SeedVenue, b: SeedVenue) =>
    a.venueType === "area" ||
    b.venueType === "area" ||
    a.parent === b.slug ||
    b.parent === a.slug ||
    (a.parent !== null && a.parent === b.parent);

  for (const v of venues) {
    const { lat, lng } = v;
    const b = NWA_BOUNDS;
    if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) {
      add(v.slug, "error", `location ${lat}, ${lng} is outside Northwest Arkansas`);
    }
    if (v.state !== "AR") add(v.slug, "error", `state is ${v.state}, expected AR`);
    if (!NWA_CITIES.has(v.city)) add(v.slug, "warning", `city "${v.city}" is not in the NWA city list`);
    // Coverage area: Benton and Washington counties (AGENTS.md, Data). Inactive venues are exempt.
    if (v.active !== false && !inCoverageArea(v.city)) {
      add(v.slug, "error", `"${v.city}" is outside the coverage area (Benton and Washington counties); deactivate it with a reason`);
    }

    if (v.parent) {
      if (!bySlug.has(v.parent)) {
        add(v.slug, "error", `parent "${v.parent}" is not in the file`);
      } else {
        // Walk up the chain; revisiting a slug means a cycle.
        const seen = new Set([v.slug]);
        for (let p = parentOf(v); p; p = parentOf(p)) {
          if (seen.has(p.slug)) {
            add(v.slug, "error", "parent chain loops back on itself");
            break;
          }
          seen.add(p.slug);
        }
      }
    }

    const provenances = Object.entries(v.verification).flatMap(([field, p]) =>
      (Array.isArray(p) ? p : p ? [p] : []).map((prov) => [field, prov] as const),
    );
    for (const [field, prov] of provenances) {
      const age = (today.getTime() - new Date(`${prov.checkedAt}T00:00:00Z`).getTime()) / DAY_MS;
      if (age < -1) add(v.slug, "error", `${field} provenance is dated in the future (${prov.checkedAt})`);
      else if (age > STALE_PROVENANCE_DAYS) {
        add(v.slug, "warning", `${field} provenance is ${Math.floor(age)} days old`);
      }
    }
  }

  // Name and alias collisions in the same city make the resolver ambiguous.
  const owners = new Map<string, string>();
  for (const v of venues) {
    for (const key of venueNameKeys(v)) {
      const cityKey = `${v.city.toLowerCase()}|${key}`;
      const owner = owners.get(cityKey);
      if (owner && owner !== v.slug) {
        add(v.slug, "error", `name or alias "${key}" also belongs to ${owner} in ${v.city}`);
      } else {
        owners.set(cityKey, v.slug);
      }
    }
  }

  for (let i = 0; i < venues.length; i++) {
    for (let j = i + 1; j < venues.length; j++) {
      const [a, b] = [venues[i], venues[j]];
      if (related(a, b)) continue;
      const d = distanceMeters(a, b);
      if (d < NEAR_DUPLICATE_METERS) {
        add(
          b.slug,
          "warning",
          `${Math.round(d)} m from ${a.slug}: same place? If one is inside the other, set parent`,
        );
      }
    }
  }

  return issues;
}

export interface GeocodeMatch {
  lat: number;
  lng: number;
  matchedAddress: string;
  zip?: string | null;
  // The request that produced this match, cited when a ZIP comes from it.
  url?: string;
}

/** Compares the seed location with an independent geocode of its address. */
export function checkGeocode(v: SeedVenue, match: GeocodeMatch | null): VenueIssue[] {
  if (!match) {
    return [{ slug: v.slug, level: "warning", message: "geocoder found no match for the address" }];
  }
  const issues: VenueIssue[] = [];
  // The Arvest pattern: a close match on a different street can hide a wrong address.
  const matchedStreet = match.matchedAddress.split(",")[0];
  const streetDiff = v.address ? streetDifference(v.address, matchedStreet) : null;
  if (streetDiff) {
    issues.push({
      slug: v.slug,
      level: "warning",
      message: `geocoder matched a different street (${streetDiff}): "${matchedStreet}" for "${v.address}"`,
    });
  }
  if (v.postalCode && match.zip && v.postalCode !== match.zip) {
    issues.push({
      slug: v.slug,
      level: "warning",
      message: `ZIP ${v.postalCode} disagrees with the geocoder's ${match.zip} (${match.matchedAddress})`,
    });
  }
  const d = Math.round(distanceMeters(v, match));
  const limits = geocodeLimits(v.venueType);
  const level = d > limits.error ? "error" : d > limits.warn ? "warning" : null;
  if (level) {
    issues.push({
      slug: v.slug,
      level,
      message: `location is ${d} m from the geocoded address (${match.matchedAddress})`,
    });
  }
  return issues;
}
