/**
 * Owner exceptions to robots.txt (AGENTS.md, Fetching). Each is narrow: one
 * host, the exact endpoint families the owner named, and the decision behind
 * it. Not a general rule that documentation overrides robots.txt; any new case
 * needs its own owner decision, recorded here and in docs/sources-terms.md.
 */

export interface RobotsException {
  host: string;
  paths: readonly RegExp[];
  decision: string;
  evidence: string;
}

export const ROBOTS_EXCEPTIONS: readonly RobotsException[] = [
  {
    // robots.txt says "User-agent: * / Disallow: /"; NWS's published API documentation invites
    // programmatic access with an identifying User-Agent (owner, 2026-10-17).
    host: "api.weather.gov",
    paths: [
      /^\/points\/-?\d{1,2}(\.\d{1,4})?,-?\d{1,3}(\.\d{1,4})?$/,
      /^\/gridpoints\/[A-Z]{3}\/\d{1,3},\d{1,3}\/forecast\/hourly$/,
      /^\/stations\/[A-Z0-9]{3,5}\/observations\/latest$/,
      /^\/alerts\/active\?area=AR$/,
    ],
    decision: "Owner exception, 2026-10-17: the National Weather Service's API documentation is treated as the operator's written permission.",
    evidence: "https://www.weather.gov/documentation/services-web-api",
  },
];

/** Whether an owner exception covers this exact URL (host and path, with its query). */
export function robotsException(url: string | URL): RobotsException | null {
  const u = new URL(url);
  const target = u.pathname + u.search;
  return ROBOTS_EXCEPTIONS.find((e) => u.hostname === e.host && e.paths.some((p) => p.test(target))) ?? null;
}
