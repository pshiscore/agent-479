import Link from "next/link";
import { VENUE_TYPE_LABELS } from "@/config/front-page";
import type { Filters } from "@/lib/site/queries";

/**
 * The filter bar (A2): a plain GET form, so every filtered view is a URL and
 * it works without JavaScript. On the homepage it submits to /upcoming.
 */

const QUICK_TAGS = [
  ["free", "Free"],
  ["family-friendly", "Family-friendly"],
  ["21-plus", "21+"],
  ["en-espanol", "En español"],
] as const;

export function FilterBar({
  action,
  filters,
  options,
  hide = [],
}: {
  action: string;
  filters: Filters;
  options: { cities: { slug: string; name: string }[]; categories: { slug: string; name: string }[] };
  hide?: ("city" | "category" | "venueType")[];
}) {
  const field = "rounded-md border border-line bg-background px-2 py-1.5 text-sm";
  return (
    <form action={action} method="get" className="border-b border-line bg-tint">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 text-sm">
        {!hide.includes("city") && (
          <label className="flex items-center gap-2 font-semibold">
            City
            <select name="city" defaultValue={filters.city ?? ""} className={field}>
              <option value="">All of NWA</option>
              {options.cities.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!hide.includes("category") && (
          <label className="flex items-center gap-2 font-semibold">
            Category
            <select name="category" defaultValue={filters.category ?? ""} className={field}>
              <option value="">All categories</option>
              {options.categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!hide.includes("venueType") && (
          <label className="flex items-center gap-2 font-semibold">
            Where
            <select name="venue_type" defaultValue={filters.venueType ?? ""} className={field}>
              <option value="">Anywhere</option>
              {Object.entries(VENUE_TYPE_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Tags</legend>
          {QUICK_TAGS.map(([slug, label]) => (
            <label key={slug} className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-background px-2.5 py-1.5 font-semibold has-checked:border-accent has-checked:text-accent">
              <input type="checkbox" name="tags" value={slug} defaultChecked={filters.tags?.includes(slug)} className="accent-[var(--accent)]" />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" name="recurring" value="1" defaultChecked={filters.showRecurring} className="accent-[var(--accent)]" />
          Show recurring
        </label>
        <button className="rounded-md bg-accent px-3 py-1.5 font-semibold text-accent-ink">Apply</button>
        {(filters.city || filters.category || filters.venueType || filters.tags?.length || filters.showRecurring) && (
          <Link href={action} className="underline underline-offset-2">
            Clear
          </Link>
        )}
      </div>
    </form>
  );
}
