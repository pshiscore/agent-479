import type { Filters } from "./queries";

/**
 * Filters as URL parameters (docs/product/front-page.md, F: every filtered
 * view is a URL): ?city=bentonville&category=music&tags=free,family-friendly
 * &venue_type=library&recurring=1. Values are slugs; anything else is dropped.
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VENUE_TYPE = /^[a-z_]+$/;
type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseFilters(p: Params): Filters {
  const slug = (v: string | string[] | undefined) => {
    const s = one(v)?.trim().toLowerCase();
    return s && SLUG.test(s) ? s : undefined;
  };
  const tagValues = (Array.isArray(p.tags) ? p.tags : (p.tags ?? "").split(","))
    .flatMap((t) => t.split(","))
    .map((t) => t.trim().toLowerCase())
    .filter((t) => SLUG.test(t));
  const vt = one(p.venue_type)?.trim();
  return {
    city: slug(p.city),
    category: slug(p.category),
    tags: [...new Set(tagValues)].slice(0, 6),
    venueType: vt && VENUE_TYPE.test(vt) ? vt : undefined,
    showRecurring: one(p.recurring) === "1",
  };
}

export function filterQuery(f: Filters, extra: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  if (f.city) q.set("city", f.city);
  if (f.category) q.set("category", f.category);
  if (f.tags?.length) q.set("tags", f.tags.join(","));
  if (f.venueType) q.set("venue_type", f.venueType);
  if (f.showRecurring) q.set("recurring", "1");
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function hasFilters(f: Filters): boolean {
  return Boolean(f.city || f.category || f.tags?.length || f.venueType || f.showRecurring);
}
