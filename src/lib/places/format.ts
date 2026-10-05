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
