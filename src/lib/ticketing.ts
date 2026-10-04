import { isWithinDomain } from "@/lib/http/domain";

/**
 * Ticketing providers: a link on one of these domains is a ticket purchase
 * link, which makes "Ticketed" a stated fact (owner, 2026-10-04). It says
 * nothing about price. A venue's own site doesn't count, since its link may
 * be just an info page. Add a provider here when a new source uses one.
 */
export const TICKETING_DOMAINS = [
  "ticketmaster.com",
  "livenation.com",
  "universe.com",
  "ticketweb.com",
  "axs.com",
  "etix.com",
  "eventbrite.com",
  "seetickets.us",
  "dice.fm",
  "tixr.com",
  "showclix.com",
  "ticketleap.com",
  "brownpapertickets.com",
  "prekindle.com",
] as const;

export function isTicketingUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === "https:" && TICKETING_DOMAINS.some((d) => isWithinDomain(u.hostname, d));
}
