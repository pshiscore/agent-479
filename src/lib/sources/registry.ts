import { icsFetcher } from "./fetchers/ics";
import type { Fetcher } from "./types";

/** sources.fetcher → code. Ticketmaster joins in build step 10. */
const FETCHERS: Record<string, Fetcher> = {
  [icsFetcher.name]: icsFetcher,
};

export function fetcherFor(name: string | null): Fetcher | null {
  return (name && FETCHERS[name]) || null;
}
