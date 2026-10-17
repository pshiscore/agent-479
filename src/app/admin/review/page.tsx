import Link from "next/link";
import { inArray, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin/auth";
import { getDb } from "@/lib/db/client";
import { categories, events, type ProposedEvent, venues } from "@/lib/db/schema";
import { likelyMatches, pendingProposals, recentDecisions, webSearchUrl } from "@/lib/review/proposals";
import { formatInChicago } from "@/lib/time";
import { eventsDuring, festivalOptions } from "@/lib/review/options";
import { BySource } from "./by-source";
import { addProposalSourceAction, approveProposalAction, mergeProposalAction, rejectProposalAction, setParentAction } from "../actions";
import { button, Diff, input, Notice, when } from "../ui";

/** The review queue (AGENTS.md, "Festivals and the review queue"). Nothing here is public until approved. */

const REASON_LABELS: Record<string, string> = {
  owner_draft: "Saved by you for review",
  new_festival: "New festival, not in the registry",
  lead_only: "Dates only from a lead",
  aggregator_only: "Dates only from an aggregator calendar",
  sources_conflict: "Sources conflict",
  venue_unresolved: "Venue unresolved",
  unclear_schedule: "Dates or schedule unclear",
  first_time_organizer: "First-time organizer",
  outside_coverage_area: "Outside coverage area",
};

const range = (f: Pick<ProposedEvent, "startAt" | "endAt" | "allDay">) => {
  const o: Intl.DateTimeFormatOptions = f.allDay ? { weekday: "short", month: "short", day: "numeric" } : { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  const start = formatInChicago(new Date(f.startAt), o);
  return f.endAt ? `${start} to ${formatInChicago(new Date(f.endAt), o)}` : start;
};

export default async function ReviewPage({ searchParams }: PageProps<"/admin/review">) {
  await requireAdmin();
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const tabs = (active: "items" | "sources") => (
    <nav className="flex gap-4 text-sm">
      <Link href="/admin/review" className={active === "items" ? "font-semibold" : "text-zinc-500 underline"}>
        One by one
      </Link>
      <Link href="/admin/review?view=sources" className={active === "sources" ? "font-semibold" : "text-zinc-500 underline"}>
        By source
      </Link>
    </nav>
  );
  if (one(q.view) === "sources") {
    return (
      <div className="grid gap-6">
        <Notice msg={one(q.msg)} error={one(q.error)} />
        <div>
          <h1 className="text-lg font-semibold">Review by source</h1>
          <p className="text-zinc-500">Sources in shadow: fetched and processed, nothing publishes until you approve items or promote the source.</p>
        </div>
        {tabs("sources")}
        <BySource
          db={getDb()}
          preview={one(q.preview) && one(q.phrase) ? { sourceId: one(q.preview)!, phrase: one(q.phrase)! } : undefined}
          skipped={one(q.skipped)?.includes(":") ? { sourceId: one(q.skipped)!.split(":")[0], filterId: one(q.skipped)!.split(":")[1] } : undefined}
        />
      </div>
    );
  }
  const db = getDb();
  const [pending, decided, festivals] = await Promise.all([pendingProposals(db), recentDecisions(db, 15), festivalOptions(db)]);
  const [{ n: allPending }] = (await db.execute(sql`select count(*)::int n from event_proposals where status = 'pending'`)) as unknown as { n: number }[];
  const shadowWaiting = allPending - pending.length;
  const festivalId = one(q.festival);
  const festival = festivals.find((f) => f.id === festivalId) ?? null;
  const during = festival ? await eventsDuring(db, festival.id) : [];

  const venueIds = pending.map((p) => p.facts.venueId).filter((v): v is string => Boolean(v));
  const categoryIds = pending.map((p) => p.facts.categoryId).filter((v): v is string => Boolean(v));
  const [vs, cs] = await Promise.all([
    venueIds.length ? db.select({ id: venues.id, name: venues.name, city: venues.city }).from(venues).where(inArray(venues.id, venueIds)) : [],
    categoryIds.length ? db.select({ id: categories.id, name: categories.name }).from(categories).where(inArray(categories.id, categoryIds)) : [],
  ]);
  const venueById = new Map(vs.map((v) => [v.id, v]));
  const categoryById = new Map(cs.map((c) => [c.id, c.name]));
  // One at a time: a burst of queries larger than the pool can stall Supabase's pooler (src/lib/db/client.ts).
  const matches = new Map<string, Awaited<ReturnType<typeof likelyMatches>>>();
  for (const p of pending) matches.set(p.id, await likelyMatches(db, p.facts));
  const matchIds = [...new Set([...matches.values()].flat().map((m) => m.id))];
  const matchRows = matchIds.length ? await db.select().from(events).where(inArray(events.id, matchIds)) : [];
  const eventById = new Map(matchRows.map((e) => [e.id, e]));
  const compare = (f: ProposedEvent, venueName: string | undefined) => ({
    title: f.title,
    when: range(f),
    venue: venueName ?? "—",
    free: f.isFree ? "free" : "—",
    moreInfo: f.moreInfoUrl,
  });

  return (
    <div className="grid gap-8">
      <Notice msg={one(q.msg)} error={one(q.error)} />
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Review</h1>
          <p className="text-zinc-500">
            {pending.length} waiting. Nothing here is public until you approve it.
            {shadowWaiting > 0 ? ` ${shadowWaiting} more from shadow sources are reviewed by source.` : ""}
          </p>
          {tabs("items")}
        </div>
        <Link href="/admin/review/new" className={button}>
          Add event
        </Link>
      </div>

      {pending.length === 0 && <p className="text-zinc-500">Nothing to review.</p>}
      {pending.map((p) => {
        const venue = p.facts.venueId ? venueById.get(p.facts.venueId) : undefined;
        const ownerChecked = p.sources.some((s) => s.verifiedBy === "owner");
        const cands = matches.get(p.id) ?? [];
        return (
          <article key={p.id} className="grid gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
            <div>
              <h2 className="text-base font-semibold">{p.facts.title}</h2>
              <p>
                {range(p.facts)} · {venue ? `${venue.name}, ${venue.city}` : <strong>no venue yet</strong>}
                {p.facts.subSpace ? ` (${p.facts.subSpace})` : ""} · {p.facts.categoryId ? categoryById.get(p.facts.categoryId) : <strong>no category yet</strong>}
                {p.facts.isFree ? " · free" : ""}
              </p>
              <p className="text-zinc-500">
                Why it&apos;s here: {p.reasons.map((r) => REASON_LABELS[r] ?? r).join("; ")} · from {p.origin.replace("_", " ")} · {when(p.createdAt)}
              </p>
            </div>

            <div>
              <p className="font-semibold">Sources</p>
              <ul className="grid gap-1">
                {p.sources.map((s) => (
                  <li key={s.url}>
                    <a className="underline" href={s.url} target="_blank" rel="noreferrer">
                      {s.url}
                    </a>{" "}
                    {s.verifiedBy === "owner" ? (
                      <span className="text-green-700 dark:text-green-400">
                        checked by you {s.checkedAt}
                        {s.confirmed ? `: ${s.confirmed}` : ""}
                      </span>
                    ) : (
                      <span className="text-zinc-500">{s.fetchedAt ? `fetched ${s.fetchedAt}` : "not checked"}{s.note ? ` (${s.note})` : ""}</span>
                    )}
                  </li>
                ))}
              </ul>
              {!ownerChecked && (
                <p className="mt-1">
                  <a className="underline" href={webSearchUrl(p.facts.title, venue?.city ?? null)} target="_blank" rel="noreferrer">
                    Search the web
                  </a>{" "}
                  <span className="text-zinc-500">(opens a search in your browser; nothing is fetched)</span>
                </p>
              )}
              <form action={addProposalSourceAction} className="mt-2 flex flex-wrap gap-2">
                <input type="hidden" name="id" value={p.id} />
                <input name="url" type="url" required placeholder="Official page I checked" className={`${input} min-w-64 flex-1`} />
                <input name="confirmed" required minLength={3} placeholder="What it says (dates, place)" className={`${input} min-w-64 flex-1`} />
                <button className="rounded border border-zinc-400 px-3 py-1">Record as checked</button>
              </form>
            </div>

            {cands.length > 0 && (
              <div>
                <p className="font-semibold">Possibly already listed</p>
                {cands.map((m) => {
                  const e = eventById.get(m.id);
                  if (!e) return null;
                  return (
                    <div key={m.id} className="mt-2">
                      <p>
                        {e.primarySourceUrl ? (
                          <a className="underline" href={e.primarySourceUrl} target="_blank" rel="noreferrer">
                            {e.title}
                          </a>
                        ) : (
                          e.title
                        )}{" "}
                        <span className="text-zinc-500">
                          ({when(e.startAt)}, {e.status}; title similarity {Math.min(1, m.score).toFixed(2)}{e.venueId === p.facts.venueId ? ", same venue" : ""})
                        </span>
                      </p>
                      <Diff
                        before={compare({ ...p.facts, title: e.title, startAt: e.startAt.toISOString(), endAt: e.endAt?.toISOString() ?? null, allDay: e.allDay, isFree: e.isFree, moreInfoUrl: e.primarySourceUrl ?? "—" }, e.venueId === p.facts.venueId ? venue?.name : "another venue")}
                        after={compare(p.facts, venue?.name)}
                      />
                      <form action={mergeProposalAction} className="mt-1 flex flex-wrap gap-2">
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="eventId" value={e.id} />
                        <input name="note" placeholder="Note (optional)" className={`${input} min-w-48`} />
                        <button className="rounded border border-zinc-400 px-3 py-1">Merge into this event</button>
                      </form>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap items-start gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <form action={approveProposalAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="id" value={p.id} />
                <input name="note" placeholder="Note (optional)" className={`${input} min-w-48`} />
                <button className={button}>Approve</button>
              </form>
              <Link href={`/admin/review/${p.id}`} className="rounded border border-zinc-400 px-3 py-1">
                Edit and approve
              </Link>
              <form action={rejectProposalAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="id" value={p.id} />
                <select name="kind" defaultValue="other" className={input} aria-label="Reason kind">
                  <option value="wrong_date">Wrong date</option>
                  <option value="wrong_venue">Wrong venue</option>
                  <option value="not_public">Not public</option>
                  <option value="duplicate">Duplicate</option>
                  <option value="outside_area">Outside area</option>
                  <option value="other">Other</option>
                </select>
                <input name="reason" required minLength={3} placeholder="Why reject?" className={`${input} min-w-48`} />
                <button className="rounded border border-zinc-400 px-3 py-1">Reject</button>
              </form>
            </div>
          </article>
        );
      })}

      <section id="festival-parts" className="grid gap-2 rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-base font-semibold">Festival parts</h2>
        <p className="text-zinc-500">Link events already listed (say, a parade from the city calendar) to the festival they belong to.</p>
        <form method="get" className="flex flex-wrap gap-2">
          <select name="festival" defaultValue={festival?.id ?? ""} className={input}>
            <option value="">Choose a festival</option>
            {festivals.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title} ({f.firstDay} to {f.lastDay})
              </option>
            ))}
          </select>
          <button className="rounded border border-zinc-400 px-3 py-1">Show events during it</button>
        </form>
        {festival && (
          <ul className="grid gap-1">
            {during.length === 0 && <li className="text-zinc-500">No other events during {festival.title}.</li>}
            {during.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3">
                <span>
                  {when(c.start_at)} · {c.title} · {c.venue}
                  {c.parent_event_id === festival.id ? <strong className="text-green-700 dark:text-green-400"> (part of it)</strong> : c.parent_event_id ? <span className="text-zinc-500"> (part of another festival)</span> : null}
                </span>
                <form action={setParentAction}>
                  <input type="hidden" name="childId" value={c.id} />
                  <input type="hidden" name="festivalId" value={festival.id} />
                  {c.parent_event_id === festival.id ? (
                    <button name="unlink" value="1" className="text-sm underline">
                      Unlink
                    </button>
                  ) : (
                    <button className="rounded border border-zinc-400 px-2 py-0.5 text-sm">Make part of {festival.title}</button>
                  )}
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {decided.length > 0 && (
        <section>
          <h2 className="mb-2 text-base font-semibold">Recently decided</h2>
          <ul className="grid gap-1">
            {decided.map((p) => (
              <li key={p.id}>
                <strong>{p.status}</strong> {when(p.decidedAt)}: {p.facts.title}
                {p.decisionNote ? <span className="text-zinc-500"> ({p.decisionNote})</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
