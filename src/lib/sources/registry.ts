import { icsFetcher } from "./fetchers/ics";
import { ticketmasterFetcher } from "./fetchers/ticketmaster";
import type { Fetcher } from "./types";

/** sources.fetcher → code. */
const FETCHERS: Record<string, Fetcher> = {
  [icsFetcher.name]: icsFetcher,
  [ticketmasterFetcher.name]: ticketmasterFetcher,
};

export function fetcherFor(name: string | null): Fetcher | null {
  return (name && FETCHERS[name]) || null;
}
