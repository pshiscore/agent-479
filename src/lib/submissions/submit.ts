import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { inCoverageArea } from "@/config/coverage";
import { recordAction } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { eventProposals, eventSubmissions, type ProposedEvent } from "@/lib/db/schema";
import { addDays, chicagoDate, chicagoToUtc, formatDate, parseDate } from "@/lib/time";
import { checkToken } from "./token";

/**
 * "Submit an event" (step 10; owner, 2026-10-16). A submission always goes to
 * review (origin "submission"); nothing publishes until the owner approves it
 * and picks the venue and category. We collect only the submitter's email,
 * kept apart and deleted 30 days after the owner decides (purge.ts).
 *
 * This is reachable from a public page, so it writes its review item itself
 * and imports nothing from the review or pipeline code: no public entry point
 * may reach the fetch staging table (tests/raw-records-isolation.test.ts).
 */

export const SUBMITTER = "human:submitter";
export const LIMITS = { perHour: 30, perEmailPerDay: 5 };

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "a time like 19:00");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date");

export const submissionSchema = z
  .object({
    title: z.string().trim().min(3, "the event's name").max(200),
    date: day,
    startTime: hhmm.or(z.literal("")),
    endDate: day.or(z.literal("")),
    endTime: hhmm.or(z.literal("")),
    place: z.string().trim().min(3, "where it happens").max(300),
    city: z.string().trim().min(2, "the city or town").max(80),
    eventUrl: z
      .string()
      .trim()
      .url("a web address that starts with https://")
      .refine((u) => u.startsWith("https://"), "a web address that starts with https://")
      .refine((u) => u.length <= 500, "a shorter web address"),
    free: z.enum(["yes", "no", "unknown"]),
    organizer: z.string().trim().max(200),
    email: z.string().trim().toLowerCase().email("your email, so we can ask about the event").max(254),
    note: z.string().trim().max(500),
  })
  .superRefine((s, ctx) => {
    if (s.endTime && !s.startTime) ctx.addIssue({ code: "custom", path: ["endTime"], message: "an end time needs a start time" });
    const end = s.endDate || s.date;
    if (end < s.date) ctx.addIssue({ code: "custom", path: ["endDate"], message: "the end date is before the start" });
    if (end === s.date && s.startTime && s.endTime && s.endTime <= s.startTime) ctx.addIssue({ code: "custom", path: ["endTime"], message: "the end is before the start" });
  });

export type SubmissionInput = z.input<typeof submissionSchema>;

export type SubmitResult =
  | { ok: true; proposalId: string | null }
  | { ok: false; error: string; fields?: Record<string, string> };

const wall = (d: string, t: string) => chicagoToUtc(parseDate(d), { hour: Number(t.slice(0, 2)), minute: Number(t.slice(3)) });

/** Pure: the review item's facts from a valid submission. */
export function submissionFacts(s: z.output<typeof submissionSchema>): ProposedEvent {
  const allDay = !s.startTime;
  const endDay = s.endDate || s.date;
  const startAt = allDay ? chicagoToUtc(parseDate(s.date)) : wall(s.date, s.startTime);
  // All-day ends are exclusive (the next midnight); a timed end is its own instant.
  const endAt = allDay
    ? endDay !== s.date ? chicagoToUtc(addDays(parseDate(endDay), 1)) : null
    : s.endTime ? wall(endDay, s.endTime) : null;
  return {
    title: s.title,
    startAt: startAt.toISOString(),
    endAt: endAt?.toISOString() ?? null,
    allDay,
    venueId: null,
    subSpace: null,
    categoryId: null,
    isFree: s.free === "yes" ? true : s.free === "no" ? false : null,
    priceMin: null,
    priceMax: null,
    ageMin: null,
    ageMax: null,
    registrationRequired: null,
    inSpanish: false,
    tagSlugs: [],
    ticketUrl: null,
    moreInfoUrl: s.eventUrl,
    dailyHours: [],
    parentEventId: null,
  };
}

/**
 * Validates, applies the anti-spam checks and rate limits, and creates the
 * review item plus the submitter row, logged (the email is never written to
 * the log). A filled hidden field gets a quiet "thanks" and stores nothing.
 */
export async function submitEvent(
  db: DbExecutor,
  raw: Record<string, string>,
  opts: { now?: Date } = {},
): Promise<SubmitResult> {
  const now = opts.now ?? new Date();
  if ((raw.website ?? "").trim() !== "") return { ok: true, proposalId: null };
  const token = checkToken(raw.token ?? "", now.getTime());
  if (token === "unavailable") return { ok: false, error: "Submissions aren't open yet. Please email us instead." };
  if (token === "too_fast") return { ok: false, error: "That was quick! Please check the details and send again." };
  if (token !== "ok") return { ok: false, error: "This form expired. Please reload the page and send again." };

  const parsed = submissionSchema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) fields[String(i.path[0])] ??= i.message;
    return { ok: false, error: "Please check the highlighted fields.", fields };
  }
  const s = parsed.data;
  const today = formatDate(chicagoDate(now));
  if ((s.endDate || s.date) < today) return { ok: false, error: "That event has already happened.", fields: { date: "a date that hasn't passed" } };
  if (s.date > formatDate(addDays(chicagoDate(now), 400))) return { ok: false, error: "We list events up to a year ahead.", fields: { date: "a date within the next year" } };

  const [{ hour }] = await db.select({ hour: sql<number>`count(*)::int` }).from(eventSubmissions).where(gte(eventSubmissions.createdAt, new Date(now.getTime() - 3_600_000)));
  if (hour >= LIMITS.perHour) return { ok: false, error: "We're getting a lot of submissions right now. Please try again in an hour." };
  const [{ mine }] = await db
    .select({ mine: sql<number>`count(*)::int` })
    .from(eventSubmissions)
    .where(and(eq(eventSubmissions.email, s.email), gte(eventSubmissions.createdAt, new Date(now.getTime() - 86_400_000))));
  if (mine >= LIMITS.perEmailPerDay) return { ok: false, error: "You've sent several events today. We'll be in touch; please send more tomorrow." };

  return db.transaction(async (tx) => {
    const reasons = ["submitted" as const, ...(inCoverageArea(s.city) ? [] : ["outside_coverage_area" as const])];
    const [proposal] = await tx
      .insert(eventProposals)
      .values({ origin: "submission", reasons, facts: submissionFacts(s), sources: [{ url: s.eventUrl, note: `Submitted through the form ${today}; not yet checked.` }] })
      .returning();
    await recordAction(tx, { actor: SUBMITTER, action: "insert", entityType: "event_proposal", entityId: proposal.id, after: proposal, reason: `In review: ${reasons.join(", ")}` });
    const [row] = await tx
      .insert(eventSubmissions)
      // Same clock as the rate limits above.
      .values({ proposalId: proposal.id, email: s.email, placeText: `${s.place}, ${s.city}`, organizerName: s.organizer || null, note: s.note || null, createdAt: now })
      .returning();
    await recordAction(tx, { actor: SUBMITTER, action: "insert", entityType: "event_submission", entityId: row.id, after: redacted(row), reason: `Submission for review: ${s.title}` });
    return { ok: true as const, proposalId: proposal.id };
  });
}

/** A submission row for the log: never the email or the note. */
export const redacted = (r: typeof eventSubmissions.$inferSelect) => ({ ...r, email: r.email ? "[email]" : null, note: r.note ? "[note]" : null });
