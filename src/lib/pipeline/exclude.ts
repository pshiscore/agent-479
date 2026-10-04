import type { Facts } from "./map";

/**
 * Records we don't list (plan section 5, rule 3). They're kept as raw records
 * with status "skipped" and the reason, so a wrong rule can be found and undone.
 */

// Public meetings: we list community events, not government business.
const GOVERNMENT_MEETING =
  /\b(city council|council (meeting|session)|planning commission|(board|commission|committee|authority) (meeting|session)|board of (adjustment|directors|zoning|trustees)|public hearing|work session|agenda (session|review)|zoning|quorum court)\b/i;
// City office closures are notices, not events ("Veterans Day - City Offices Closed").
const OFFICE_CLOSURE = /\b(offices? (are |will be )?closed|city hall (is |will be )?closed|closed for the holiday)\b/i;

const DAY_MS = 86_400_000;
const MAX_AHEAD_MS = 548 * DAY_MS; // 18 months

export function exclusionReason(facts: Facts, now: Date): string | null {
  if (OFFICE_CLOSURE.test(facts.title)) return "office_closure";
  if (GOVERNMENT_MEETING.test(facts.title)) return "government_meeting";
  const start = Date.parse(facts.startAt);
  const end = facts.endAt ? Date.parse(facts.endAt) : start;
  // Recurring events may have an old first date; series detection decides those.
  if (!facts.recurrence && end < now.getTime() - DAY_MS) return "past_event";
  if (start > now.getTime() + MAX_AHEAD_MS) return "out_of_window";
  return null;
}
