/**
 * Google Places (owner, 2026-10-06; AGENTS.md, Content rules). We store only
 * the owner-confirmed place ID; ratings and reviews render live in Google's
 * own Place Details element, in the visitor's browser, after a tap.
 */

/** Google place IDs: letters, digits, "_" and "-" (e.g. "ChIJ…"). Also checked by the database. */
export const GOOGLE_PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;
export const isGooglePlaceId = (id: string) => GOOGLE_PLACE_ID.test(id);

/**
 * The widget is on only when the switch is "true" (ignoring case, spaces, line
 * breaks, and quotes, which a dashboard textbox can add) and a browser key exists.
 */
export const googleWidgetEnabled = (env: Record<string, string | undefined> = process.env) =>
  (env.GOOGLE_PLACES_WIDGET ?? "").trim().replace(/^["']|["']$/g, "").toLowerCase() === "true" && Boolean(env.NEXT_PUBLIC_GOOGLE_MAPS_KEY?.trim());

/** The browser key (restricted to 479.guide and localhost, and to three APIs). Public by design. */
export const googleBrowserKey = () => process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? null;

/** Google's documented Maps URL for one place, so the owner can see which business an ID is. */
export const mapsPlaceUrl = (query: string, placeId: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}&query_place_id=${encodeURIComponent(placeId)}`;
