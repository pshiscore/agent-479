import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { mondayOf } from "@/lib/benchmark/parse";
import type { Coverage } from "@/lib/benchmark/report";
import { openTasks, weekItems, weekSummaries } from "@/lib/benchmark/service";
import { getDb } from "@/lib/db/client";
import { MISS_REASONS } from "@/lib/db/schema";
import { eventPath } from "@/lib/routes";
import { chicagoDate, formatDate, formatInChicago } from "@/lib/time";
import { addBenchmarkLinesAction, recheckWeekAction, setMissReasonAction, setTaskStatusAction, wrongMatchAction } from "../actions";
import { button, input, Notice } from "../ui";

/**
 * The coverage benchmark (docs/product/organizers.md): the owner types a
 * roundup's events, one per line; each is matched against our events and the
 * review queue. Only what the owner types is stored.
 */

const REASON_LABELS: Record<(typeof MISS_REASONS)[number], string> = {
  no_source: "No source yet (opens a registry task)",
  social_only: "Organizer is social-media only",
  not_in_feed: "Source exists, event not in its feed",
  filtered: "Skipped by a filter rule",
  rejected: "Rejected or hidden",
  wrong_details: "We have it with a wrong date, time, or venue",
  outside_area: "Outside coverage area",
  permission_pending: "Permission pending",
  source_not_enabled: "Source proposed or paused",
  other: "Other",
};

const RESULT_STYLES = {
  live: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  review: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  shadow: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  missed: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
} as const;
const RESULT_LABELS = { live: "Live", review: "In review", shadow: "In shadow", missed: "Missed" } as const;

const pct = (n: number | null) => (n === null ? "—" : `${n}%`);
// Noon UTC is the same calendar day in Chicago.
const day = (d: string) => formatInChicago(new Date(`${d}T12:00:00Z`), { weekday: "short", month: "short", day: "numeric" });
const weekName = (d: string) => `Week of ${formatInChicago(new Date(`${d}T12:00:00Z`), { month: "short", day: "numeric", year: "numeric" })}`;

function Bar({ value, className }: { value: number | null; className: string }) {
  return (
    <div className="h-2 w-24 rounded bg-zinc-100 dark:bg-zinc-800" aria-hidden>
      <div className={`h-2 rounded ${className}`} style={{ width: `${value ?? 0}%` }} />
    </div>
  );
}

function CoverageLine({ c }: { c: Coverage }) {
  return (
    <p>
      <strong>Live coverage {pct(c.livePct)}</strong> ({c.live} of {c.total}) · <strong>potential {pct(c.potentialPct)}</strong> (live {c.live}, in review {c.review}, in shadow {c.shadow}) · missed {c.missed}
      {c.unexplained ? ` (${c.unexplained} without a reason)` : ""} · outside coverage area {c.outside} (not counted)
    </p>
  );
}

export default async function BenchmarkPage({ searchParams }: PageProps<"/admin/benchmark">) {
  await requireAdmin();
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const db = getDb();
  const weeks = await weekSummaries(db);
  const tasks = await openTasks(db);
  const selected = weeks.find((w) => w.id === one(q.week)) ?? weeks[0] ?? null;
  const items = selected ? await weekItems(db, selected.id) : [];
  const thisWeek = mondayOf(formatDate(chicagoDate(new Date())));
  const trend = weeks.slice(0, 12);

  return (
    <div className="grid gap-8">
      <Notice msg={one(q.msg)} error={one(q.error)} />
      <div>
        <h1 className="text-lg font-semibold">Coverage benchmark</h1>
        <p className="text-zinc-500">
          Type the events from a roundup, one per line (name and date in any order). Each is matched by title within a day either side of its date; a
          multi-day event matches when the date falls inside it. Only what you type is stored.
        </p>
      </div>

      <form action={addBenchmarkLinesAction} className="grid gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex flex-wrap gap-4">
          <label className="grid gap-1">
            <span>Week starting (Monday)</span>
            <input type="date" name="weekStart" defaultValue={selected?.weekStart && one(q.week) ? selected.weekStart : thisWeek} className={input} required />
          </label>
          <label className="grid flex-1 gap-1">
            <span>What you compared against (optional)</span>
            <input name="label" defaultValue={one(q.week) ? (selected?.label ?? "") : ""} placeholder="e.g. Flyer weekend list" className={input} maxLength={120} />
          </label>
        </div>
        <label className="grid gap-1">
          <span>Events, one per line</span>
          <textarea name="lines" rows={8} required className={`${input} font-mono`} placeholder={"Fall Festivities, Oct 16\nSat Oct 17 - Harvest Market\n10/18 Pea Ridge 5K\nStory Time, Wednesday"} />
        </label>
        <div>
          <button className={button}>Match</button>
        </div>
      </form>

      {trend.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-base font-semibold">Weekly trend</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="py-1 pr-3">Week</th>
                  <th className="py-1 pr-3">Items</th>
                  <th className="py-1 pr-3">Live coverage</th>
                  <th className="py-1 pr-3">Potential (live, review, shadow)</th>
                  <th className="py-1 pr-3">Outside area</th>
                  <th className="py-1">No reason yet</th>
                </tr>
              </thead>
              <tbody>
                {trend.map((w) => (
                  <tr key={w.id} className={`border-t border-zinc-100 dark:border-zinc-800 ${w.id === selected?.id ? "font-semibold" : ""}`}>
                    <td className="whitespace-nowrap py-1 pr-3">
                      <Link href={`/admin/benchmark?week=${w.id}`} className="underline">
                        {weekName(w.weekStart)}
                      </Link>
                      {w.label ? <span className="text-zinc-500"> · {w.label}</span> : null}
                    </td>
                    <td className="py-1 pr-3">{w.coverage.total}</td>
                    <td className="py-1 pr-3">
                      <div className="flex items-center gap-2">
                        <Bar value={w.coverage.livePct} className="bg-green-600" />
                        {pct(w.coverage.livePct)}
                      </div>
                    </td>
                    <td className="py-1 pr-3">
                      <div className="flex items-center gap-2">
                        <Bar value={w.coverage.potentialPct} className="bg-sky-600" />
                        {pct(w.coverage.potentialPct)}
                      </div>
                    </td>
                    <td className="py-1 pr-3">{w.coverage.outside}</td>
                    <td className="py-1">{w.coverage.unexplained}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {selected && (
        <section className="grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">
              {weekName(selected.weekStart)}
              {selected.label ? <span className="font-normal text-zinc-500"> · {selected.label}</span> : null}
            </h2>
            <form action={recheckWeekAction}>
              <input type="hidden" name="weekId" value={selected.id} />
              <button className="underline">Re-check matches</button>
            </form>
          </div>
          <CoverageLine c={selected.coverage} />
          <ul className="grid divide-y divide-zinc-100 dark:divide-zinc-800">
            {items.map((i) => (
              <li key={i.id} className="grid gap-2 py-3 sm:grid-cols-[7rem_1fr]">
                <span className="text-zinc-500">{day(i.eventDate)}</span>
                <div className="grid gap-1.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-semibold">{i.name}</span>
                    <span className={`rounded px-1.5 py-0.5 text-xs ${RESULT_STYLES[i.result]}`}>{RESULT_LABELS[i.result]}</span>
                    {i.matchOverridden && <span className="text-xs text-zinc-500">you marked the match wrong</span>}
                  </div>
                  {i.result === "live" && i.eventSlug && (
                    <p>
                      Matched{" "}
                      <Link href={eventPath(i.eventSlug)} className="underline">
                        {i.eventTitle}
                      </Link>
                    </p>
                  )}
                  {(i.result === "review" || i.result === "shadow") && i.matchedProposalId && (
                    <p>
                      Matched{" "}
                      <Link href={`/admin/review/${i.matchedProposalId}`} className="underline">
                        {i.proposalTitle}
                      </Link>
                    </p>
                  )}
                  {i.result !== "missed" && (
                    <form action={wrongMatchAction}>
                      <input type="hidden" name="itemId" value={i.id} />
                      <input type="hidden" name="week" value={selected.id} />
                      <button className="text-xs text-zinc-500 underline">Wrong match</button>
                    </form>
                  )}
                  {i.result === "missed" && (
                    <>
                      {i.note && <p className="text-zinc-500">{i.note}</p>}
                      <form action={setMissReasonAction} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="itemId" value={i.id} />
                        <input type="hidden" name="week" value={selected.id} />
                        <select name="reason" defaultValue={i.missReason ?? i.suggestedReason ?? ""} className={`${input} max-w-full`} required>
                          <option value="" disabled>
                            Why was it missed?
                          </option>
                          {MISS_REASONS.map((r) => (
                            <option key={r} value={r}>
                              {REASON_LABELS[r]}
                              {!i.missReason && i.suggestedReason === r ? " (suggested)" : ""}
                            </option>
                          ))}
                        </select>
                        <input name="note" placeholder="Note (optional): organizer, where you saw it" className={`${input} w-full min-w-0 sm:w-auto sm:flex-1`} maxLength={300} />
                        <button className={button}>{i.missReason ? "Change" : "Save"}</button>
                      </form>
                      {i.taskStatus && (
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          <span>
                            Registry task: <strong>{i.taskStatus}</strong>
                          </span>
                          {i.taskStatus === "open" &&
                            (["done", "dropped"] as const).map((s) => (
                              <form key={s} action={setTaskStatusAction}>
                                <input type="hidden" name="itemId" value={i.id} />
                                <input type="hidden" name="week" value={selected.id} />
                                <input type="hidden" name="status" value={s} />
                                <button className="underline">Mark {s}</button>
                              </form>
                            ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-2">
        <h2 className="text-base font-semibold">Open registry tasks</h2>
        {tasks.length === 0 ? (
          <p className="text-zinc-500">None. A miss marked &ldquo;No source yet&rdquo; opens one: find the organizer and how they publish events.</p>
        ) : (
          <ul className="grid gap-2">
            {tasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-3">
                <Link href={`/admin/benchmark?week=${t.weekId}`} className="font-semibold underline">
                  {t.name}
                </Link>
                <span className="text-zinc-500">{day(t.eventDate)}</span>
                {t.note && <span className="text-zinc-500">{t.note}</span>}
                {(["done", "dropped"] as const).map((s) => (
                  <form key={s} action={setTaskStatusAction}>
                    <input type="hidden" name="itemId" value={t.id} />
                    <input type="hidden" name="status" value={s} />
                    <button className="text-xs underline">Mark {s}</button>
                  </form>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
