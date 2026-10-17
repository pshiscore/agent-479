import Link from "next/link";
import { VENUE_TYPE_LABELS } from "@/config/front-page";
import { activeCount, clearAll, type Keep, toggleRecurring, toggleTag, withCategory, withCity, withVenueType } from "@/lib/site/chips";
import type { Filters } from "@/lib/site/queries";
import { ChipsEnhancer } from "./chips-enhance";

/**
 * Filter chips (owner, 2026-10-04): every chip is a link to the filtered URL,
 * so it applies instantly (soft navigation, scroll kept) and works without
 * JavaScript. Dropdown chips are <details> menus (a bottom sheet on phones);
 * toggle chips add or remove a tag; the switch shows recurring programs. On
 * phones the whole set sits behind a sticky "Filters" button.
 * Logic and URL parameters are unchanged (src/lib/site/filters.ts).
 */

const QUICK_TAGS = [
  ["free", "Free"],
  ["family-friendly", "Family-friendly"],
  ["21-plus", "21+"],
  ["en-espanol", "En español"],
] as const;

const pill = "inline-flex h-11 items-center gap-1.5 rounded-pill border px-4 text-sm font-semibold whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none";
const off = `${pill} border-line bg-background text-foreground hover:border-foreground/40`;
const on = `${pill} border-accent bg-accent text-accent-ink`;

function Check() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface Option {
  value: string;
  label: string;
}

/** A dropdown chip (a <details> menu; a bottom sheet on phones). Shared by event and venue filters. */
export function DropdownChip({
  label,
  allLabel,
  options,
  selected,
  hrefFor,
  clearHref,
}: {
  label: string;
  allLabel: string;
  options: Option[];
  selected?: string;
  hrefFor: (v: string | undefined) => string;
  clearHref: string;
}) {
  const chosen = options.find((o) => o.value === selected);
  return (
    <div className="relative flex items-center">
      <details data-chip-menu className="group">
        <summary
          className={`${chosen ? on : off} cursor-pointer list-none [&::-webkit-details-marker]:hidden ${chosen ? "rounded-r-none border-r-0 pr-2" : ""}`}
          aria-label={chosen ? `${label}: ${chosen.label}. Change ${label.toLowerCase()}` : `${label}: any`}
        >
          {chosen ? chosen.label : label}
          <Chevron />
        </summary>
        {/* Phone: a bottom sheet over a dim backdrop. Wider screens: a popover under the chip. */}
        <div aria-hidden className="fixed inset-0 z-40 bg-black/40 sm:hidden" data-chip-backdrop />
        <div className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-2xl border border-line bg-background p-2 shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:max-h-80 sm:min-w-56 sm:rounded-2xl">
          <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted sm:hidden">{label}</p>
          <ul>
            {[{ value: "", label: allLabel }, ...options].map((o) => {
              const active = (o.value || undefined) === selected;
              return (
                <li key={o.value || "all"}>
                  <Link
                    href={hrefFor(o.value || undefined)}
                    scroll={false}
                    aria-current={active ? "true" : undefined}
                    className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-chip focus-visible:bg-chip ${active ? "font-bold text-accent" : ""}`}
                  >
                    {o.label}
                    {active && <Check />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </details>
      {chosen && (
        <Link href={clearHref} scroll={false} aria-label={`Clear ${label.toLowerCase()}`} className={`${on} rounded-l-none border-l border-l-accent-ink/30 px-3`}>
          <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </Link>
      )}
    </div>
  );
}

export function FilterChips({
  base,
  filters,
  options,
  keep = {},
  hide = [],
  count,
}: {
  base: string;
  filters: Filters;
  options: { cities: Option[]; categories: Option[] };
  keep?: Keep;
  hide?: ("city" | "category" | "venueType")[];
  count?: number;
}) {
  const n = activeCount(filters);
  const venueTypes = Object.entries(VENUE_TYPE_LABELS).map(([value, label]) => ({ value, label }));

  const chips = (
    <div className="flex flex-wrap items-center gap-2">
      {!hide.includes("city") && (
        <DropdownChip
          label="City"
          allLabel="All of NWA"
          options={options.cities}
          selected={filters.city}
          hrefFor={(v) => withCity(base, filters, v, keep)}
          clearHref={withCity(base, filters, undefined, keep)}
        />
      )}
      {!hide.includes("category") && (
        <DropdownChip
          label="Category"
          allLabel="All categories"
          options={options.categories}
          selected={filters.category}
          hrefFor={(v) => withCategory(base, filters, v, keep)}
          clearHref={withCategory(base, filters, undefined, keep)}
        />
      )}
      {!hide.includes("venueType") && (
        <DropdownChip
          label="Venue type"
          allLabel="Any venue"
          options={venueTypes}
          selected={filters.venueType}
          hrefFor={(v) => withVenueType(base, filters, v, keep)}
          clearHref={withVenueType(base, filters, undefined, keep)}
        />
      )}
      {QUICK_TAGS.map(([slug, label]) => (
        <ToggleChip key={slug} href={toggleTag(base, filters, slug, keep)} selected={filters.tags?.includes(slug) ?? false} label={label} />
      ))}
      <Link
        href={toggleRecurring(base, filters, keep)}
        scroll={false}
        aria-current={filters.showRecurring ? "true" : undefined}
        className="ml-auto inline-flex h-11 items-center gap-2 rounded-pill px-2 text-sm font-semibold"
      >
        <span
          aria-hidden
          className={`relative h-6 w-10 rounded-pill transition-colors duration-150 motion-reduce:transition-none ${filters.showRecurring ? "bg-accent" : "bg-line"}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-pill bg-background shadow transition-[left] duration-150 motion-reduce:transition-none ${filters.showRecurring ? "left-[18px]" : "left-0.5"}`}
          />
        </span>
        Show recurring
        <span className="sr-only">{filters.showRecurring ? " (on)" : " (off)"}</span>
      </Link>
    </div>
  );

  return <ChipsPanel chips={chips} active={n} count={count} noun="event" clearHref={clearAll(base, keep)} />;
}

/** A toggle chip: a link that adds or removes one filter. */
export function ToggleChip({ href, selected, label }: { href: string; selected: boolean; label: string }) {
  return (
    <Link href={href} scroll={false} aria-current={selected ? "true" : undefined} className={selected ? on : off}>
      {selected && <Check />}
      {label}
      <span className="sr-only">{selected ? " (on; select to remove)" : ""}</span>
    </Link>
  );
}

/** The chips' frame: on the page on wider screens, behind a sticky "Filters" button on phones. */
export function ChipsPanel({ chips, active: n, count, noun, clearHref }: { chips: React.ReactNode; active: number; count?: number; noun: string; clearHref: string }) {
  const counted = (c: number) => `${c} ${noun}${c === 1 ? "" : "s"}`;
  // On phones the count already sits on the Filters button, so the panel omits it.
  const summary = (showCount: boolean) =>
    (showCount || n > 0) && (
      <div className="flex items-center gap-4 text-sm">
        {showCount && count !== undefined && (
          <span className="text-muted" aria-live="polite">
            {counted(count)}
          </span>
        )}
        {n > 0 && (
          <Link href={clearHref} scroll={false} className="font-semibold underline underline-offset-4">
            Clear all
          </Link>
        )}
      </div>
    );

  return (
    // "contents" so the phone bar sticks for the whole page, not just this wrapper.
    <div data-filter-chips className="contents">
      <ChipsEnhancer />
      {/* Wider screens: the chips on the page background. */}
      <div className="mx-auto hidden max-w-6xl gap-3 px-4 pt-6 sm:grid">
        {chips}
        {summary(true)}
      </div>
      {/* Phones: a sticky "Filters" button that drops the chips down. */}
      <details data-filter-panel className="group/panel sticky top-0 z-30 border-b border-line bg-background sm:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
          <span className={n > 0 ? on : off}>
            Filters{n > 0 ? ` (${n})` : ""}
            <Chevron />
          </span>
          {count !== undefined && <span className="text-sm text-muted">{counted(count)}</span>}
        </summary>
        <div className="grid gap-3 px-4 pb-4 pt-1">
          {chips}
          {summary(false)}
        </div>
      </details>
    </div>
  );
}
