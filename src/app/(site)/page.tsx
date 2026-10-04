import Link from "next/link";
import { connection } from "next/server";
import { LISTS, WEEKEND_LIMITS } from "@/config/front-page";
import { getDb } from "@/lib/db/client";
import { currentFeatureEventId } from "@/lib/pipeline/feature";
import { venuePath } from "@/lib/routes";
import { byDay, type EventItem, eventById, filterOptions, foldRecurring, listEvents, weekendVariety } from "@/lib/site/queries";
import { weekendWindow } from "@/lib/time";
import { SectionTitle } from "./_components/chrome";
import { Actions, Chips, DayTimeline, Place } from "./_components/events";
import { FilterBar } from "./_components/filter-bar";
import { agesLine, isoDay, longWhen, shortDate, timeOf } from "./_components/format";

/** The front page (docs/product/front-page.md, layout A2, sections B). */

const DAY = 86_400_000;

function Feature({ e }: { e: EventItem }) {
  return (
    <section aria-label="Featured" className="rounded-xl bg-brand p-5 text-brand-ink">
      <p className="text-sm font-semibold">{longWhen(e)}</p>
      <h2 className="mt-1 font-display text-4xl font-extrabold leading-none">{e.title}</h2>
      <div className="mt-3 [&_a]:text-brand-ink">
        <Place e={e} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-xs font-semibold">
        <span className="rounded border border-white/60 px-2 py-0.5">{e.category.name}</span>
        {e.tags.slice(0, 3).map((t) => (
          <span key={t.slug} className="rounded border border-white/60 px-2 py-0.5">
            {t.name}
          </span>
        ))}
      </div>
      <div className="mt-4 [&_a]:border-white [&_a]:text-brand-ink [&_a:hover]:bg-white/10">
        <Actions e={e} />
      </div>
    </section>
  );
}

function shelf(items: EventItem[]) {
  // One card per series (or per title), soonest first: weekly programs show once, with their next date.
  const seen = new Set<string>();
  const cards: EventItem[] = [];
  for (const e of items) {
    const key = e.series?.id ?? e.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push(e);
  }
  return cards;
}

export default async function Home() {
  await connection();
  const db = getDb();
  const now = new Date();
  const all = await listEvents(db, { from: now, to: new Date(now.getTime() + 180 * DAY) });
  const options = await filterOptions(db);

  // This weekend: the current one while anything in it is still ahead, else the coming one.
  let weekend = weekendWindow(now);
  if (!all.some((e) => e.startAt < weekend.endUtc)) weekend = weekendWindow(weekend.endUtc);
  const from = new Date(Math.max(now.getTime(), weekend.startUtc.getTime()));
  const weekendAll = all.filter((e) => e.startAt >= from && e.startAt < weekend.endUtc);
  const { events: weekendEvents, series: weekendSeries } = foldRecurring(weekendAll, false);
  const { shown, hidden } = weekendVariety(weekendEvents, WEEKEND_LIMITS);

  // Feature: the current choice from the process job, if it's still upcoming and visible.
  const featureId = await currentFeatureEventId(db);
  const feature = featureId ? await eventById(db, featureId, now) : null;

  // Lists: counts of upcoming events per rule.
  const lists = LISTS.map((l) => {
    const until = l.days ? now.getTime() + l.days * DAY : Infinity;
    const n = all.filter((e) => e.startAt.getTime() < until && e.tags.some((t) => t.slug === l.tag)).length;
    return { ...l, n, href: `/upcoming?tags=${l.tag}&recurring=1${l.days ? `&days=${l.days}` : "&days=31"}` };
  }).filter((l) => l.n > 0);

  // At the library this week.
  const weekAhead = all.filter((e) => e.venue.type === "library" && e.startAt.getTime() < now.getTime() + 7 * DAY);
  const libraryCards = shelf(weekAhead).slice(0, 4);
  const libraries = [...new Map(weekAhead.map((e) => [e.venue.slug, e.venue])).values()];

  // Further out: one-offs after this weekend, away from the library shelf, each title once.
  const furtherTitles = new Set<string>();
  const further = all
    .filter((e) => e.startAt >= weekend.endUtc && e.series?.kind !== "recurring" && e.venue.type !== "library")
    .filter((e) => {
      const key = `${e.title.toLowerCase()}|${e.venue.slug}`;
      if (furtherTitles.has(key)) return false;
      furtherTitles.add(key);
      return true;
    })
    .slice(0, 6);

  return (
    <>
      <FilterBar action="/upcoming" filters={{}} options={options} />
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="this-weekend">
          {/* On phones the feature leads the page; on wide screens it sits in the right column. */}
          {feature && (
            <div className="mb-8 lg:hidden">
              <Feature e={feature} />
            </div>
          )}
          <SectionTitle id="this-weekend">This weekend</SectionTitle>
          <p className="mt-2 text-sm text-muted">
            {shortDate(weekend.startUtc)} to {shortDate(new Date(weekend.endUtc.getTime() - DAY))}
          </p>
          {shown.length === 0 && <p className="mt-6 text-muted">Nothing listed for this weekend yet.</p>}
          {byDay(shown).map((d) => (
            <DayTimeline key={d.day} date={d.date} items={d.items} />
          ))}
          <p className="mt-4 text-sm">
            <Link href={`/upcoming?from=${weekend.periodStart}&days=3${weekendSeries.length ? "&recurring=1" : ""}`} className="font-semibold underline underline-offset-4">
              See everything this weekend
            </Link>
            {hidden + weekendSeries.length > 0 ? (
              <span className="text-muted">
                {" "}
                ({hidden > 0 ? `${hidden} more` : ""}
                {hidden > 0 && weekendSeries.length > 0 ? ", " : ""}
                {weekendSeries.length > 0 ? `${weekendSeries.length} weekly programs` : ""})
              </span>
            ) : null}
          </p>
        </section>

        <aside className="grid content-start gap-8">
          {feature && (
            <div className="hidden lg:block">
              <Feature e={feature} />
            </div>
          )}
          {lists.length > 0 && (
            <section aria-labelledby="lists">
              <h2 id="lists" className="scroll-mt-6 font-display text-2xl font-extrabold text-brand">
                Lists
              </h2>
              <ul className="mt-2 divide-y divide-line border-y border-line">
                {lists.map((l) => (
                  <li key={l.slug}>
                    <Link href={l.href} className="flex items-baseline justify-between gap-3 py-3 hover:text-accent">
                      <span>
                        <span className="font-bold">{l.name}</span>
                        <span className="block text-xs text-muted">{l.blurb}</span>
                      </span>
                      <span className="shrink-0 text-sm text-muted">{l.n} events</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {/* What's new (section H) appears here once openings are collected; it hides while empty. */}
        </aside>
      </div>

      {libraryCards.length > 0 && (
        <section aria-labelledby="library" className="mx-auto w-full max-w-6xl px-4">
          <div className="rounded-xl bg-tint p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <SectionTitle id="library" tone="accent">
                  At the library this week
                </SectionTitle>
                <p className="mt-2 text-sm">
                  {weekAhead.length} programs at{" "}
                  {libraries.map((v, i) => (
                    <span key={v.slug}>
                      {i > 0 ? " and " : ""}
                      <Link href={venuePath(v.slug)} className="underline underline-offset-2">
                        {v.name}
                      </Link>
                    </span>
                  ))}{" "}
                  in the next 7 days. Weekly programs show once, with their next date.
                </p>
              </div>
              <Link href={`/upcoming?venue_type=library&days=7&recurring=1&from=${isoDay(now)}`} className="rounded-md border border-foreground/70 bg-background px-3 py-1.5 text-sm font-semibold">
                Show all {weekAhead.length}
              </Link>
            </div>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {libraryCards.map((e) => {
                const detail = [agesLine(e), ...e.tags.filter((t) => ["en-espanol", "registration-required", "free"].includes(t.slug)).map((t) => t.name)].filter(Boolean).join(" · ");
                return (
                  <li key={e.id} className="rounded-lg bg-background p-4">
                    <p className="text-xs font-semibold text-muted">
                      {e.series ? `${e.series.label}, next ${shortDate(e.startAt)}` : `${shortDate(e.startAt)}, ${timeOf(e)}`}
                    </p>
                    <p className="mt-1 font-bold leading-snug">{e.title}</p>
                    <p className="mt-1 text-sm text-muted">{detail || e.shortDescription}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {further.length > 0 && (
        <section aria-labelledby="further" className="mx-auto mt-10 w-full max-w-6xl px-4">
          <div className="flex items-baseline justify-between">
            <h2 id="further" className="font-display text-2xl font-extrabold text-brand">
              Further out
            </h2>
            <Link href="/upcoming" className="text-sm font-semibold underline underline-offset-4">
              See all upcoming
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {further.map((e) => (
              <li key={e.id} className="grid gap-2 py-3 sm:grid-cols-[120px_1fr_auto] sm:items-center">
                <p className="font-display font-extrabold text-brand">{shortDate(e.startAt)}</p>
                <div>
                  <p className="font-bold">{e.title}</p>
                  <div className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span>{timeOf(e)},</span>
                    <Place e={e} />
                  </div>
                  <div className="mt-1">
                    <Chips e={e} />
                  </div>
                </div>
                <Actions e={e} compact />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
