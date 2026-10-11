import { chicagoDate, formatDate } from "@/lib/time";

/**
 * How a place's facts read on the site (docs/product/front-page.md, H). Pure,
 * shared by admin and public pages.
 */

export const PLACE_TYPE_LABELS: Record<string, string> = {
  restaurant: "Restaurant",
  cafe: "Cafe",
  coffee_shop: "Coffee shop",
  bakery: "Bakery",
  bakery_cafe: "Bakery and cafe",
  bar: "Bar",
  brewery: "Brewery",
  food_truck: "Food truck",
};

export const PLACE_KIND_LABELS: Record<string, string> = {
  new: "New",
  new_location: "New location",
  moved: "Moved",
  reopened: "Reopened",
};

/** The New in Town category for each place type. Shops, Venues, and Outdoors come later. */
const CATEGORY_BY_TYPE = {
  restaurant: "restaurants",
  cafe: "restaurants",
  coffee_shop: "restaurants",
  bakery: "restaurants",
  bakery_cafe: "restaurants",
  bar: "restaurants",
  brewery: "restaurants",
  food_truck: "restaurants",
} as const;

export const categoryForType = (type: keyof typeof CATEGORY_BY_TYPE) => CATEGORY_BY_TYPE[type];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];

/** "Aug 10, 2026" or "June 2026", from a YYYY-MM-DD date and its precision. */
export function statedDate(on: string, precision: "day" | "month"): string {
  const [y, m, d] = on.split("-").map(Number);
  return precision === "month" ? `${MONTHS[m - 1]} ${y}` : `${SHORT[m - 1]} ${d}, ${y}`;
}

/** "Opened Aug 18, 2026 (grand opening)": the date as stated, with the source's own qualifier in brackets. */
export function openedLabel(p: { openedOn: string | null; openedPrecision: "day" | "month" | null; openedQualifier?: string | null }): string | null {
  if (!p.openedOn || !p.openedPrecision) return null;
  return `Opened ${statedDate(p.openedOn, p.openedPrecision)}${p.openedQualifier ? ` (${p.openedQualifier})` : ""}`;
}

/** "Opening in November 2026" or "Opening Nov 20, 2026". */
export function targetLabel(p: { targetOn: string | null; targetPrecision: "day" | "month" | null; targetQualifier?: string | null }): string | null {
  if (!p.targetOn || !p.targetPrecision) return null;
  const when = statedDate(p.targetOn, p.targetPrecision);
  return `Opening ${p.targetPrecision === "month" ? `in ${when}` : when}${p.targetQualifier ? ` (${p.targetQualifier})` : ""}`;
}

/** "Based at <location>" for food trucks; the address otherwise. */
export const addressLine = (p: { address: string; addressKind: string }) => (p.addressKind === "home_base" ? `Based at ${p.address}` : p.address);

export const PLACE_CATEGORY_LABELS: Record<string, string> = {
  restaurants: "Restaurants",
  shops: "Shops",
  venues: "Venues",
  outdoors: "Outdoors",
};

/** The order categories appear on /new. Empty ones are hidden. */
export const PLACE_CATEGORY_ORDER = ["restaurants", "shops", "venues", "outdoors"] as const;

/** How many months back New in Town lists reach, counted from the opening date. */
export const NEW_IN_TOWN_MONTHS = 6;

const chicagoDay = (d: Date) => formatDate(chicagoDate(d));

/**
 * The first day of the window: the 1st of the month 6 months back (Chicago),
 * so "opened since April 2026" holds for a month-precision date too.
 */
export function windowStart(now: Date, months = NEW_IN_TOWN_MONTHS): string {
  const [y, m] = chicagoDay(now).split("-").map(Number);
  const total = y * 12 + (m - 1) - months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

/** "April 2026" for a window start. */
export const windowLabel = (start: string) => statedDate(start, "month");

/** "Just opened": a stated day within the last 30 days. A month-only date never qualifies (it may be early in the month). */
export function justOpened(p: { openedOn: string | null; openedPrecision: "day" | "month" | null }, now: Date): boolean {
  if (!p.openedOn || p.openedPrecision !== "day") return false;
  const days = (Date.parse(chicagoDay(now)) - Date.parse(p.openedOn)) / 86_400_000;
  return days >= 0 && days <= 30;
}

/**
 * What Maps searches for: the name plus the address and city, so it resolves
 * to the business (for an intersection or a food truck's base too).
 */
export const mapsQuery = (p: { name: string; address: string; city: string }) => `${p.name}, ${p.address}, ${p.city}, AR`;

/** Google's documented Maps URLs (no API, no key): a search, and directions. */
export const googleMapsSearchUrl = (query: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
export const googleDirectionsUrl = (query: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
export const appleDirectionsUrl = (query: string) => `https://maps.apple.com/?daddr=${encodeURIComponent(query)}`;

/** schema.org types for place pages (LocalBusiness and its food types). */
const SCHEMA_TYPES: Record<string, string> = {
  restaurant: "Restaurant",
  cafe: "CafeOrCoffeeShop",
  coffee_shop: "CafeOrCoffeeShop",
  bakery: "Bakery",
  bakery_cafe: "Bakery",
  bar: "BarOrPub",
  brewery: "Brewery",
  food_truck: "FoodEstablishment",
};
export const schemaType = (placeType: string) => SCHEMA_TYPES[placeType] ?? "LocalBusiness";

/** A plain Yelp search for the business (owner, 2026-10-11): a link only; nothing from Yelp is fetched, shown, or stored. */
export const yelpSearchUrl = (p: { name: string; address: string; city: string }) =>
  `https://www.yelp.com/search?find_desc=${encodeURIComponent(p.name)}&find_loc=${encodeURIComponent(`${p.address}, ${p.city}, AR`)}`;
