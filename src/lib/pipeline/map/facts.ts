import { z } from "zod";

/**
 * The facts a mapper produces from one raw record: who, what, where, when,
 * price, and links (AGENTS.md rule 4). Times are UTC instants. Validated
 * before anything downstream sees them.
 */

const https = z.url({ protocol: /^https$/ });

export const factsSchema = z.strictObject({
  title: z.string().trim().min(1).max(300),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime().nullable(),
  // For all-day events, startAt is Chicago midnight and endAt (if any) the exclusive end.
  allDay: z.boolean(),
  // The date is known but the time isn't: show no time.
  timeTba: z.boolean(),
  status: z.enum(["scheduled", "cancelled", "postponed"]),
  sourceUrl: https.nullable(),
  ticketUrl: https.nullable(),
  location: z.strictObject({
    // As the source wrote it, HTML stripped.
    text: z.string().nullable(),
    name: z.string().nullable(),
    room: z.string().nullable(),
    street: z.string().nullable(),
    city: z.string().nullable(),
    externalVenueId: z.string().nullable(),
  }),
  price: z.strictObject({
    min: z.number().nonnegative().nullable(),
    max: z.number().nonnegative().nullable(),
    currency: z.string().nullable(),
  }),
  performers: z.array(z.string()),
  // The source's own categories: hints for our classifier only.
  sourceCategories: z.array(z.string()),
  legalAgeEnforced: z.boolean().nullable(),
  // ICS recurrence, expanded by series detection (build step 14).
  recurrence: z.strictObject({ rrule: z.string(), exdates: z.array(z.string()) }).nullable(),
  // True when the source gave no time zone and Chicago was assumed.
  timezoneAssumed: z.boolean(),
});

export type Facts = z.infer<typeof factsSchema>;

/** The record can't be mapped (bad data): it fails, with this message. */
export class MapError extends Error {}

/** The record is fine but isn't an event we list: it's skipped, with this reason. */
export class SkipRecord extends Error {
  constructor(readonly reason: string, detail?: string) {
    super(detail ?? reason);
  }
}
