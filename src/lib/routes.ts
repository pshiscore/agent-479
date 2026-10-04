/**
 * URL namespaces (docs/product/front-page.md, section F). Entity pages live
 * under their own prefix, and nothing user- or data-named ever sits at the
 * root. Every top-level segment the site uses is listed here; a test fails if
 * the app gains a root route that isn't, or if any seeded slug equals one.
 */

export const ENTITY_PREFIXES = { city: "city", venue: "venue", category: "category", event: "events" } as const;

export const RESERVED_ROOT_SEGMENTS = [
  // Entity namespaces.
  ...Object.values(ENTITY_PREFIXES),
  // System and future product paths.
  "admin",
  "api",
  "bot",
  "robots.txt",
  "sitemap.xml",
  "favicon.ico",
  "icon.svg",
  "apple-icon.png",
  "_next",
  ".well-known",
  "search",
  "upcoming",
  "this-weekend",
  "venues",
  "lists",
  "new",
  "feeds",
  "tags",
  "series",
  "about",
  "digest",
] as const;

const RESERVED = new Set<string>(RESERVED_ROOT_SEGMENTS);

export function isReservedRootSegment(segment: string): boolean {
  return RESERVED.has(segment.toLowerCase());
}

export const cityPath = (slug: string) => `/${ENTITY_PREFIXES.city}/${slug}`;
export const venuePath = (slug: string) => `/${ENTITY_PREFIXES.venue}/${slug}`;
export const categoryPath = (slug: string) => `/${ENTITY_PREFIXES.category}/${slug}`;
export const eventPath = (slug: string) => `/${ENTITY_PREFIXES.event}/${slug}`;
