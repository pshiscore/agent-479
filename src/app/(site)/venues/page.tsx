import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { VENUE_GROUPS } from "@/config/venue-groups";
import { getDb } from "@/lib/db/client";
import { venuePath } from "@/lib/routes";
import {
  COUNT_DAYS,
  filterVenues,
  parseVenueFilters,
  venueHref,
  venueList,
} from "@/lib/site/venue-list";
import {
  ChipsPanel,
  DropdownChip,
  ToggleChip,
} from "../_components/filter-chips";
import { VenueGroupIcon } from "../_components/venue-icons";

export const metadata: Metadata = {
  title: "Venues",
  description:
    "Places across Benton and Washington counties, with how many events each has coming up.",
};

/**
 * Venues (owner, 2026-10-17, Phase A): one column of venue cards with a type
 * badge, the city, and the count of events in the next 30 days. Filters are
 * the shared chips, and the URL is the state. Phase B adds the map.
 */
export default async function Venues({ searchParams }: PageProps<"/venues">) {
  await connection();
  const f = parseVenueFilters(await searchParams);
  const all = await venueList(getDb(), new Date());
  const shown = filterVenues(all, f);
  const cities = [
    ...new Map(all.map((v) => [v.city.slug, v.city.name])).entries(),
  ]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label }));
  const groups = VENUE_GROUPS.filter((g) =>
    all.some((v) => v.group.slug === g.slug),
  ).map((g) => ({ value: g.slug, label: g.label }));
  const active = [f.city, f.type, f.upcoming].filter(Boolean).length;

  const chips = (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownChip
        label="City"
        allLabel="All of NWA"
        options={cities}
        selected={f.city}
        hrefFor={(v) => venueHref(f, { city: v })}
        clearHref={venueHref(f, { city: undefined })}
      />
      <DropdownChip
        label="Venue type"
        allLabel="Any type"
        options={groups}
        selected={f.type}
        hrefFor={(v) => venueHref(f, { type: v })}
        clearHref={venueHref(f, { type: undefined })}
      />
      <ToggleChip
        href={venueHref(f, { upcoming: !f.upcoming })}
        selected={!!f.upcoming}
        label="Has upcoming events"
      />
      <div className="ml-auto">
        <DropdownChip
          label="Sort"
          allLabel="A–Z"
          options={[{ value: "upcoming", label: "Most upcoming" }]}
          selected={f.sort}
          hrefFor={(v) =>
            venueHref(f, { sort: v === "upcoming" ? "upcoming" : undefined })
          }
          clearHref={venueHref(f, { sort: undefined })}
        />
      </div>
    </div>
  );

  return (
    <div className="w-full">
      <div className="mx-auto max-w-6xl px-4 pt-8">
        <h1 className="font-display text-4xl font-extrabold text-brand">
          Venues
        </h1>
        <p className="mt-2 text-muted">
          Places across Benton and Washington counties. Counts are events in the
          next {COUNT_DAYS} days; a weekly program counts once.
        </p>
      </div>
      <ChipsPanel
        chips={chips}
        active={active}
        count={shown.length}
        noun="venue"
        clearHref={venueHref({ sort: f.sort })}
      />
      {/* Left-aligned with the heading and chips; Phase B puts the map beside it. */}
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="max-w-3xl">
          {shown.length === 0 ? (
            <p className="text-muted">
              No venues match.{" "}
              <Link
                href={venueHref({ sort: f.sort })}
                className="font-semibold underline underline-offset-4"
              >
                Clear the filters
              </Link>
            </p>
          ) : (
            <ul className="grid gap-3">
              {shown.map((v) => {
                const label =
                  v.upcoming > 0
                    ? `${v.name}, ${v.group.label}, ${v.city.name}: ${v.upcoming} upcoming event${v.upcoming === 1 ? "" : "s"} in the next ${COUNT_DAYS} days`
                    : `${v.name}, ${v.group.label}, ${v.city.name}: view venue`;
                return (
                  <li key={v.slug}>
                    <Link
                      href={venuePath(v.slug)}
                      aria-label={label}
                      className="flex items-center justify-between gap-4 rounded-xl border border-line bg-background px-4 py-3 transition-colors duration-150 hover:border-foreground/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
                    >
                      <div className="min-w-0">
                        <p className="font-display text-lg font-extrabold leading-tight">
                          {v.name}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <span className="inline-flex items-center gap-1.5 rounded-pill bg-chip px-2.5 py-0.5 font-semibold">
                            <VenueGroupIcon
                              group={v.group.slug}
                              className="h-3.5 w-3.5"
                            />
                            {v.group.label}
                          </span>
                          <span className="text-muted">{v.city.name}</span>
                        </p>
                      </div>
                      {v.upcoming > 0 ? (
                        <div className="shrink-0 text-right">
                          <p className="font-display text-2xl font-extrabold leading-none text-accent">
                            {v.upcoming}
                          </p>
                          <p className="text-xs text-muted">upcoming</p>
                        </div>
                      ) : (
                        <span className="shrink-0 text-sm font-semibold text-muted">
                          View venue
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
