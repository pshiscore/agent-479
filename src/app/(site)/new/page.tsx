import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getDb } from "@/lib/db/client";
import { PLACE_CATEGORY_LABELS, PLACE_CATEGORY_ORDER, windowLabel, windowStart } from "@/lib/places/format";
import { openingSoon, recentOpenings } from "@/lib/places/public";
import { newInTownPath } from "@/lib/routes";
import { citySlugs } from "@/lib/site/queries";
import { SectionTitle } from "../_components/chrome";
import { PlaceCard } from "../_components/places";

export const metadata: Metadata = { title: "New in Town" };

/** How many places each category block shows before "See all". */
const PER_BLOCK = 6;

/** New in Town (docs/product/front-page.md, H): one block per category; empty categories are hidden. */
export default async function NewInTown() {
  await connection();
  const db = getDb();
  const now = new Date();
  // Few queries at once: more than the pool size can stall Supabase's pooler (src/lib/db/client.ts).
  const [cities, soon, openings] = await Promise.all([citySlugs(db), openingSoon(db), recentOpenings(db, now)]);
  const blocks = PLACE_CATEGORY_ORDER.map((category) => ({ category, places: openings.filter((p) => p.category === category) }));
  const shown = blocks.filter((b) => b.places.length > 0);
  const since = windowLabel(windowStart(now));

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="font-display text-4xl font-extrabold text-brand sm:text-5xl">New in Town</h1>
      <p className="mt-2 text-sm text-muted">Places across Northwest Arkansas that opened since {since}, from the dates their sources state.</p>

      {shown.length === 0 && soon.length === 0 && <p className="mt-8">Nothing to show yet. New places appear here once their opening is confirmed from a source.</p>}

      {shown.map(({ category, places }) => (
        <section key={category} aria-labelledby={`new-${category}`} className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <SectionTitle id={`new-${category}`}>{PLACE_CATEGORY_LABELS[category]}</SectionTitle>
            <Link href={newInTownPath(category)} className="text-sm font-semibold underline underline-offset-4">
              See all {places.length}
            </Link>
          </div>
          <ul className="mt-2 divide-y divide-line">
            {places.slice(0, PER_BLOCK).map((p) => (
              <PlaceCard key={p.id} p={p} cities={cities} now={now} />
            ))}
          </ul>
        </section>
      ))}

      {soon.length > 0 && (
        <section aria-labelledby="opening-soon" className="mt-10">
          <SectionTitle id="opening-soon" tone="accent">
            Opening soon
          </SectionTitle>
          <ul className="mt-2 divide-y divide-line">
            {soon.map((p) => (
              <PlaceCard key={p.id} p={p} cities={cities} now={now} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
