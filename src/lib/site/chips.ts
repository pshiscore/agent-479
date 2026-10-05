import { filterQuery } from "./filters";
import type { Filters } from "./queries";

/**
 * URLs for the filter chips (docs/product/front-page.md, F). Every chip is a
 * link to a filtered URL, so it applies instantly and works without
 * JavaScript. Non-filter parameters (the date range: from, days) are kept.
 */

export type Keep = Record<string, string | undefined>;

const href = (base: string, f: Filters, keep: Keep) => `${base}${filterQuery(f, keep)}`;

export function withCity(base: string, f: Filters, city: string | undefined, keep: Keep = {}) {
  return href(base, { ...f, city }, keep);
}
export function withCategory(base: string, f: Filters, category: string | undefined, keep: Keep = {}) {
  return href(base, { ...f, category }, keep);
}
export function withVenueType(base: string, f: Filters, venueType: string | undefined, keep: Keep = {}) {
  return href(base, { ...f, venueType }, keep);
}
/** Adds the tag if absent, removes it if present. */
export function toggleTag(base: string, f: Filters, tag: string, keep: Keep = {}) {
  const tags = f.tags ?? [];
  return href(base, { ...f, tags: tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag] }, keep);
}
export function toggleRecurring(base: string, f: Filters, keep: Keep = {}) {
  return href(base, { ...f, showRecurring: !f.showRecurring }, keep);
}
/** Removes every filter; keeps the date range. */
export function clearAll(base: string, keep: Keep = {}) {
  return href(base, {}, keep);
}

/** How many filters are on (for the phone's "Filters (n)" button and "Clear all"). */
export function activeCount(f: Filters): number {
  return (f.city ? 1 : 0) + (f.category ? 1 : 0) + (f.venueType ? 1 : 0) + (f.tags?.length ?? 0) + (f.showRecurring ? 1 : 0);
}
