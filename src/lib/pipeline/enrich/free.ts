import type { Facts } from "../map";
import type { Extraction } from "./extract";

/**
 * Whether an event is free, and on what basis (AGENTS.md: "Free" only when
 * stated). In order:
 *   1. Structured prices (Ticketmaster) mean it isn't free.
 *   2. The event's own listing says free → stated. A stated price → not free.
 *   3. The source publishes a default ("Programs are free unless the event
 *      lists a fee") and the listing never mentions a fee, cost, or ticket
 *      price → source_default.
 *   4. Otherwise unknown (not tagged Free).
 */

// A fee, cost, or ticket price mentioned anywhere in the listing.
const MENTIONS_FEE = /\$\s?\d|\b(fees?|costs?|tickets?|admission|charges?|tuition|per person|registration fee|paid)\b/i;

export type FreeDecision = { isFree: boolean | null; basis: "stated" | "source_default" | null };

export function decideFree(
  facts: Pick<Facts, "title" | "price">,
  extraction: Pick<Extraction, "isFree" | "priceMin" | "priceMax"> | null,
  description: string | null,
  sourceDefaultPriceNote: string | null,
): FreeDecision {
  if (facts.price.min !== null || facts.price.max !== null) return { isFree: false, basis: null };
  if (extraction?.isFree === true) return { isFree: true, basis: "stated" };
  const priced = (extraction?.priceMin ?? 0) > 0 || (extraction?.priceMax ?? 0) > 0 || extraction?.isFree === false;
  if (priced) return { isFree: false, basis: null };
  if (sourceDefaultPriceNote && !MENTIONS_FEE.test(`${facts.title}\n${description ?? ""}`)) {
    return { isFree: true, basis: "source_default" };
  }
  return { isFree: null, basis: null };
}
