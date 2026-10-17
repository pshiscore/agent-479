import { and, asc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import type { Deadline } from "@/lib/cron-budget";
import type { DbExecutor } from "@/lib/db/client";
import { organizers } from "@/lib/db/schema";
import type { PoliteClient } from "@/lib/sources/http";
import { chicagoDate, chicagoToUtc } from "@/lib/time";
import { discoverOrganizer, knownFeedKeys } from "./discover";
import { saveFinds } from "./store";

/**
 * Monthly re-discovery (step 8; docs/product/organizers.md). Every verified
 * organizer with a website is due once per Chicago calendar month: from the
 * 1st, the daily maintenance job works through the due ones in its leftover
 * time budget until none are left, then nothing until next month (the
 * first-of-month guard). New feeds become proposals, waiting proposals not
 * found again are marked gone, the owner's rejections stand; all logged.
 * A block marks the organizer `discovery_blocked`: no later run retries it
 * until the owner clears it.
 */

type Organizer = typeof organizers.$inferSelect;

/** Midnight on the 1st of the current Chicago month, as an instant. */
export function monthStart(now: Date): Date {
  const d = chicagoDate(now);
  return chicagoToUtc({ year: d.year, month: d.month, day: 1 });
}

export async function dueForDiscovery(db: DbExecutor, now: Date): Promise<Organizer[]> {
  return db
    .select()
    .from(organizers)
    .where(
      and(
        eq(organizers.status, "verified"),
        isNotNull(organizers.website),
        isNull(organizers.discoveryBlocked),
        or(isNull(organizers.discoveryCheckedAt), lt(organizers.discoveryCheckedAt, monthStart(now))),
      ),
    )
    .orderBy(sql`${organizers.discoveryCheckedAt} asc nulls first`, asc(organizers.name));
}

const eventsHint = (o: Organizer) => o.verification.notes?.find((n) => n.note?.startsWith("Events link"))?.url ?? null;

/** Discovers one organizer, saves what it found, and records the look (or the block) on the organizer, logged. */
export async function discoverAndSave(
  db: DbExecutor,
  org: Organizer,
  http: PoliteClient,
  known: ReadonlySet<string>,
  opts: { actor: string; runId: string | null; now?: Date; deadline?: Deadline },
) {
  const now = opts.now ?? new Date();
  const r = await discoverOrganizer(http, { name: org.name, website: org.website!, eventsHint: eventsHint(org) }, known, now, opts.deadline);
  const saved = r.blocked ? { proposed: 0, refreshed: 0, gone: 0 } : await saveFinds(db, org.id, r.finds, { actor: opts.actor, runId: opts.runId, now, complete: !r.incomplete });
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(organizers).where(eq(organizers.id, org.id));
    const [after] = await tx
      .update(organizers)
      // A look cut short for time isn't a check: the organizer stays due for the next run.
      .set({ ...(r.incomplete ? {} : { discoveryCheckedAt: now }), ...(r.blocked ? { discoveryBlocked: r.blocked } : {}), updatedAt: now })
      .where(eq(organizers.id, org.id))
      .returning();
    await recordAction(tx, {
      actor: opts.actor,
      runId: opts.runId,
      action: "update",
      entityType: "organizer",
      entityId: org.id,
      before,
      after,
      reason: r.blocked
        ? `Discovery blocked; not retried until the owner clears it: ${r.blocked}`.slice(0, 500)
        : `Discovery${r.incomplete ? " (stopped for time; continues next run)" : ""}: ${r.finds.length} usable feed(s); ${saved.proposed} new, ${saved.gone} gone${r.errors.length ? `; ${r.errors.length} page(s) didn't answer` : ""}`,
    });
  });
  return { result: r, saved };
}

/** The maintenance step: due organizers, one at a time, until the deadline. */
export async function rediscoverDue(db: DbExecutor, opts: { deadline: Deadline; http: PoliteClient; actor: string; runId: string | null; now?: Date }) {
  const now = opts.now ?? new Date();
  const due = await dueForDiscovery(db, now);
  const stats = { due: due.length, checked: 0, proposed: 0, gone: 0, blocked: 0, remaining: 0 };
  if (due.length === 0) return stats;
  const known = await knownFeedKeys(db);
  for (const org of due) {
    if (opts.deadline.passed) break;
    const { result, saved } = await discoverAndSave(db, org, opts.http, known, { actor: opts.actor, runId: opts.runId, now, deadline: opts.deadline });
    if (!result.incomplete) stats.checked++;
    stats.proposed += saved.proposed;
    stats.gone += saved.gone;
    if (result.blocked) {
      stats.blocked++;
      stats.checked--;
    }
  }
  stats.remaining = due.length - stats.checked - stats.blocked;
  return stats;
}
