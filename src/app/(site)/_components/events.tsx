import Link from "next/link";
import { cityPath, categoryPath, venuePath } from "@/lib/routes";
import type { EventItem, SeriesRow } from "@/lib/site/queries";
import { venueDisplayName } from "@/lib/venues/display";
import type { Placed } from "@/lib/site/multiday";
import { agesLine, dayHeading, hoursLabel, ongoingLabel, rangeLabel, shortDate, timeOf } from "./format";

/** Event pieces shared by every list (docs/product/front-page.md, C). */

export function Place({ e }: { e: Pick<EventItem, "venue" | "subSpace" | "city"> }) {
  return (
    <p className="text-sm">
      <Link href={venuePath(e.venue.slug)} className="underline underline-offset-2 hover:text-accent">
        {venueDisplayName(e.venue.name, e.subSpace)}
      </Link>
      ,{" "}
      <Link href={cityPath(e.city.slug)} className="underline underline-offset-2 hover:text-accent">
        {e.city.name}
      </Link>
    </p>
  );
}

export function Chips({ e, max = 3 }: { e: Pick<EventItem, "category" | "tags">; max?: number }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
      <Link href={categoryPath(e.category.slug)} className="rounded bg-tint px-2 py-0.5 text-accent hover:underline">
        {e.category.name}
      </Link>
      {e.tags.slice(0, max).map((t) => (
        <span key={t.slug} className="rounded border border-line px-2 py-0.5 text-muted">
          {t.name}
        </span>
      ))}
    </div>
  );
}

export function Actions({ e, compact }: { e: Pick<EventItem, "moreInfoUrl" | "ticketUrl" | "source">; compact?: boolean }) {
  const btn = `rounded-md border border-foreground/70 px-3 ${compact ? "py-1 text-xs" : "py-1.5 text-sm"} font-semibold hover:bg-chip`;
  return (
    <div className="flex flex-wrap gap-2">
      {e.moreInfoUrl && (
        <a href={e.moreInfoUrl} className={btn} rel="noopener" target="_blank">
          More info
        </a>
      )}
      {e.ticketUrl && (
        <a href={e.ticketUrl} className={btn} rel="noopener" target="_blank">
          Get tickets{e.source === "ticketmaster" ? " (Ticketmaster)" : ""}
        </a>
      )}
    </div>
  );
}

const md = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" }).format(d);

/** "Part of Lights of the Ozarks" on a part; "Includes: Light Night (Nov 21), Parade (Dec 4)" on a festival (festivals 2b). */
function Family({ e }: { e: Pick<EventItem, "parent" | "parts"> }) {
  if (!e.parent && e.parts.length === 0) return null;
  return (
    <p className="text-sm text-muted">
      {e.parent && <>Part of {e.parent.title}</>}
      {e.parent && e.parts.length > 0 && " · "}
      {e.parts.length > 0 && <>Includes: {e.parts.map((p) => `${p.title} (${md(p.startAt)})`).join(", ")}</>}
    </p>
  );
}

/** The time line of a timeline item: that day's stated hours for a multi-day event, else the start time. */
function itemTime(e: Placed): string {
  const p = e.placement;
  if (!p) return timeOf(e);
  if (p.hours) return hoursLabel(p.hours);
  if (p.dayNumber === 1) return timeOf(e);
  return e.allDay ? "All day" : "Continues today";
}

/** One event in a day's timeline. */
export function TimelineItem({ e }: { e: Placed }) {
  const p = e.placement;
  return (
    <li className="relative border-b border-line py-4 pl-8 last:border-b-0">
      <span aria-hidden className="absolute left-0 top-5 h-4 w-4 rounded-full border-[3px] border-accent bg-background" />
      <p className="text-sm font-bold">
        {itemTime(e)}
        {p && e.endAt && (
          <span className="font-semibold text-muted">
            {" · "}
            {rangeLabel(e.startAt, e.endAt)}
            {p.dayNumber > 1 ? ` · Day ${p.dayNumber} of ${p.dayCount}` : ""}
          </span>
        )}
      </p>
      <h3 className="mt-0.5 text-lg font-bold leading-snug">{e.title}</h3>
      <Place e={e} />
      <Family e={e} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <Chips e={e} />
        <Actions e={e} compact />
      </div>
    </li>
  );
}

export function DayTimeline({ date, items }: { date: Date; items: Placed[] }) {
  return (
    <section className="mt-6">
      <h3 className="font-display text-lg font-extrabold text-accent">{dayHeading(date)}</h3>
      <ol className="relative mt-1 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-[3px] before:bg-accent/70">
        {items.map((e) => (
          <TimelineItem key={e.id} e={e} />
        ))}
      </ol>
    </section>
  );
}

/** Long runs ("Through Jan 1" once started, as of the view's first day), listed once above the timeline (festivals 2a). */
export function OngoingStrip({ items, asOf }: { items: EventItem[]; asOf: Date }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Ongoing" className="mt-6 rounded-lg border border-line px-4 py-3">
      <h3 className="font-display text-lg font-extrabold">Ongoing</h3>
      <ul className="divide-y divide-line">
        {items.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div>
              <p className="font-semibold">
                {e.title} <span className="text-sm font-semibold text-accent">{ongoingLabel(e, asOf)}</span>
              </p>
              <Place e={e} />
              <Family e={e} />
            </div>
            <Actions e={e} compact />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A recurring series folded into one row (B6). */
export function SeriesRows({ series }: { series: SeriesRow[] }) {
  if (series.length === 0) return null;
  return (
    <section className="mt-8">
      <h3 className="font-display text-lg font-extrabold">Weekly and recurring</h3>
      <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
        {series.map((s) => {
          const ages = agesLine(s.next);
          return (
            <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
              <div>
                <p className="font-semibold">
                  {s.title}, <span className="text-accent">{s.label}</span>
                </p>
                <p className="text-sm text-muted">
                  Next: {shortDate(s.next.startAt)}, {timeOf(s.next)} · {venueDisplayName(s.venue.name, s.next.subSpace)}, {s.city.name}
                  {ages ? ` · ${ages}` : ""}
                </p>
              </div>
              <Actions e={s.next} compact />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
