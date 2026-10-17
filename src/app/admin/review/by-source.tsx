import { inArray } from "drizzle-orm";
import type { DbExecutor } from "@/lib/db/client";
import { venues } from "@/lib/db/schema";
import { sourceFilters } from "@/lib/pipeline/exclude";
import { filterSkipsThisWeek, filterSuggestions, previewFilter, promotionCheck, sourceSample, sourceStats, sourcesForReview } from "@/lib/review/by-source";
import { formatInChicago } from "@/lib/time";
import Link from "next/link";
import { addSourceFilterAction, approveProposalAction, bulkDecideAction, editSourceFilterAction, removeSourceFilterAction, setPublishStateAction } from "../actions";
import { button, input, when } from "../ui";

/**
 * Review by source (owner, 2026-10-16): for each shadow source, its state,
 * counts, a 10-item sample, filter rules and suggestions, bulk decisions, and
 * whether it's ready to promote. Flagged items stay in the one-by-one list.
 */

const FLAG_LABELS: Record<string, string> = {
  conflict: "possible duplicate",
  outside_coverage: "outside coverage area",
  community_fallback: "category unsure",
  description_held: "description held",
};

export async function BySource({ db, preview, skipped }: { db: DbExecutor; preview?: { sourceId: string; phrase: string }; skipped?: { sourceId: string; filterId: string } }) {
  const list = await sourcesForReview(db);
  if (list.length === 0) return <p className="text-zinc-500">No sources in shadow. New sources enter shadow when their test fetch passes.</p>;
  const now = new Date();
  const cards = [];
  // One source at a time (no query bursts; src/lib/db/client.ts).
  for (const s of list) {
    const stats = await sourceStats(db, s.id);
    const sample = await sourceSample(db, s.id);
    const suggestions = await filterSuggestions(db, s);
    const skips = await filterSkipsThisWeek(db, s.id, now);
    const previewItems = preview?.sourceId === s.id ? await previewFilter(db, s.id, preview.phrase) : null;
    cards.push({ s, stats, sample, suggestions, skips, previewItems, check: promotionCheck(stats, s.publishStateSince, now) });
  }
  const venueIds = [...new Set(cards.flatMap((c) => c.sample.map((p) => p.facts.venueId).filter((v): v is string => Boolean(v))))];
  const vs = venueIds.length ? await db.select({ id: venues.id, name: venues.name, city: venues.city }).from(venues).where(inArray(venues.id, venueIds)) : [];
  const venueName = new Map(vs.map((v) => [v.id, `${v.name}, ${v.city}`]));

  return (
    <div className="grid gap-6">
      {cards.map(({ s, stats, sample, suggestions, skips, previewItems, check }) => (
        <article key={s.id} className="grid gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">
              {s.name} <span className="font-mono text-xs text-zinc-500">{s.slug}</span>
            </h2>
            <span>
              <strong>{s.publishState}</strong> since {when(s.publishStateSince)}
            </span>
          </div>
          <p>
            {stats.updates > 0 ? `${stats.updates} update(s) to published events waiting · ` : ""}
            {stats.heldOutside > 0 ? `${stats.heldOutside} held outside the coverage area · ` : ""}
            {stats.pending} waiting ({stats.flagged} flagged for one-by-one review, {stats.conflicts} possible duplicates) · {stats.approved} approved · {stats.rejected} rejected
            {Object.keys(stats.rejectedByKind).length ? ` (${Object.entries(stats.rejectedByKind).map(([k, n]) => `${n} ${k.replace("_", " ")}`).join(", ")})` : ""} · {stats.filteredSkips} skipped by filters
          </p>

          {s.publishState === "shadow" && (
            <div className={`rounded p-2 ${check.ready ? "bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200" : "bg-zinc-50 dark:bg-zinc-900"}`}>
              <p>
                <strong>{check.ready ? "Ready to promote:" : "Not ready yet:"}</strong> {check.notes.join("; ")}.
              </p>
              <form action={setPublishStateAction} className="mt-2 flex flex-wrap gap-2">
                <input type="hidden" name="slug" value={s.slug} />
                <input name="note" placeholder="Note (optional)" className={`${input} min-w-48`} />
                <button name="to" value="live" className={check.ready ? button : "rounded border border-zinc-400 px-3 py-1"}>
                  Promote to live
                </button>
                <button name="to" value="paused" className="rounded border border-zinc-400 px-3 py-1">
                  Pause
                </button>
              </form>
            </div>
          )}

          <div>
            <p className="font-semibold">Sample (soonest {sample.length})</p>
            <ul className="grid gap-1">
              {sample.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {formatInChicago(new Date(p.facts.startAt), { month: "short", day: "numeric", ...(p.facts.allDay ? {} : { hour: "numeric", minute: "2-digit" }) })} · {p.facts.title} ·{" "}
                    {p.facts.venueId ? venueName.get(p.facts.venueId) : "no venue"}
                  </span>
                  {p.flags.map((f) => (
                    <span key={f} className="rounded bg-amber-100 px-1.5 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                      {FLAG_LABELS[f] ?? f}
                    </span>
                  ))}
                  {p.flags.length === 0 && (
                    <form action={approveProposalAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className="text-xs underline">Approve this one</button>
                    </form>
                  )}
                </li>
              ))}
              {sample.length === 0 && <li className="text-zinc-500">Nothing waiting.</li>}
            </ul>
          </div>

          <div>
            <p className="font-semibold">Filter rules</p>
            {sourceFilters(s.config).length === 0 && <p className="text-zinc-500">None yet.</p>}
            <ul className="grid gap-2">
              {sourceFilters(s.config).map((f) => {
                const week = skips.get(f.id) ?? [];
                const open = skipped?.sourceId === s.id && skipped.filterId === f.id;
                return (
                  <li key={f.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>
                        Skip titles containing &quot;{f.contains}&quot; <span className="text-zinc-500">(approved {f.approvedAt.slice(0, 10)})</span> · skipped {week.length} this week
                        {week.length > 0 && (
                          <>
                            {" "}
                            <Link className="underline" href={`/admin/review?view=sources&skipped=${s.id}:${f.id}`}>
                              see them
                            </Link>
                          </>
                        )}
                      </span>
                      <form action={editSourceFilterAction} className="flex gap-1">
                        <input type="hidden" name="sourceId" value={s.id} />
                        <input type="hidden" name="filterId" value={f.id} />
                        <input name="phrase" required minLength={3} defaultValue={f.contains} className={`${input} w-40 text-xs`} />
                        <button className="text-xs underline">Save</button>
                      </form>
                      <form action={removeSourceFilterAction}>
                        <input type="hidden" name="sourceId" value={s.id} />
                        <input type="hidden" name="filterId" value={f.id} />
                        <button className="text-xs underline">Remove (restores what it skipped)</button>
                      </form>
                    </div>
                    {open && (
                      <ul className="ml-4 list-disc text-zinc-600 dark:text-zinc-400">
                        {week.map((w, i) => (
                          <li key={i}>
                            {w.startAt?.slice(0, 10)} · {w.title}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            {previewItems && preview && (
              <div className="mt-2 rounded border border-zinc-300 p-2 dark:border-zinc-700">
                <p>
                  <strong>
                    &quot;{preview.phrase}&quot; would catch {previewItems.length} waiting item{previewItems.length === 1 ? "" : "s"}
                  </strong>{" "}
                  (and skip matching events from now on):
                </p>
                <ul className="ml-4 list-disc">
                  {previewItems.map((p) => (
                    <li key={p.id}>
                      {p.facts.startAt.slice(0, 10)} · {p.facts.title}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex gap-2">
                  <form action={addSourceFilterAction}>
                    <input type="hidden" name="sourceId" value={s.id} />
                    <input type="hidden" name="phrase" value={preview.phrase} />
                    <button className={button}>Approve this rule</button>
                  </form>
                  <Link href="/admin/review?view=sources" className="rounded border border-zinc-400 px-3 py-1">
                    Cancel
                  </Link>
                </div>
              </div>
            )}
            {suggestions.length > 0 && (
              <div className="mt-2">
                <p className="text-zinc-500">Suggested (common phrases in waiting titles):</p>
                <ul className="grid gap-1">
                  {suggestions.map((g) => (
                    <li key={g.phrase} className="flex flex-wrap items-center gap-2">
                      <span>
                        &quot;{g.phrase}&quot; · {g.count} items, e.g. {g.examples.join("; ")}
                      </span>
                      <Link className="rounded border border-zinc-400 px-2 py-0.5 text-xs" href={`/admin/review?view=sources&preview=${s.id}&phrase=${encodeURIComponent(g.phrase)}`}>
                        Preview this rule
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <form method="get" action="/admin/review" className="mt-2 flex flex-wrap gap-2">
              <input type="hidden" name="view" value="sources" />
              <input type="hidden" name="preview" value={s.id} />
              <input name="phrase" required minLength={3} placeholder='Skip titles containing… (e.g. "adult league")' className={`${input} min-w-64`} />
              <button className="rounded border border-zinc-400 px-3 py-1">Preview rule</button>
            </form>
          </div>

          <form action={bulkDecideAction} className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <input type="hidden" name="sourceId" value={s.id} />
            <span className="font-semibold">Bulk:</span>
            <input name="phrase" required minLength={2} placeholder="Titles containing…" className={`${input} min-w-48`} />
            <input name="note" placeholder="Note (optional)" className={`${input} min-w-40`} />
            <button name="decision" value="approve" className={button}>
              Approve all matching
            </button>
            <button name="decision" value="reject" className="rounded border border-zinc-400 px-3 py-1">
              Reject all matching
            </button>
            <span className="text-xs text-zinc-500">Flagged items are never bulk-approved.</span>
          </form>
        </article>
      ))}
    </div>
  );
}
