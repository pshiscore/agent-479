import { z } from "zod";
import { botFetch } from "@/lib/http/fetch";
import type { GeocodeMatch } from "./verify";

/**
 * Independent coordinate check for the venue seed: the US Census Bureau
 * geocoder (public, keyless). Only ever sent our own seed addresses; it never
 * fetches venue websites.
 */
export const CENSUS_GEOCODER_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

const responseSchema = z.object({
  result: z.object({
    addressMatches: z.array(
      z.object({
        matchedAddress: z.string(),
        coordinates: z.object({ x: z.number(), y: z.number() }),
        addressComponents: z.object({ zip: z.string().optional() }).optional(),
      }),
    ),
  }),
});

export async function censusGeocode(
  oneLineAddress: string,
  opts: { fetch?: typeof fetch; userAgent?: string } = {},
): Promise<GeocodeMatch | null> {
  const url = new URL(CENSUS_GEOCODER_URL);
  url.searchParams.set("address", oneLineAddress);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  // A refusal throws FetchBlockedError: the caller stops, it doesn't retry.
  const res = await botFetch(
    url,
    { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) },
    opts,
  );
  if (!res.ok) throw new Error(`Census geocoder returned HTTP ${res.status}`);

  const [first] = responseSchema.parse(await res.json()).result.addressMatches;
  if (!first) return null;
  return {
    lat: first.coordinates.y,
    lng: first.coordinates.x,
    matchedAddress: first.matchedAddress,
    zip: first.addressComponents?.zip ?? /\b(\d{5})$/.exec(first.matchedAddress)?.[1] ?? null,
    url: url.toString(),
  };
}
