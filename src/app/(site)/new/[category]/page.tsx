import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/lib/db/client";
import { loadLinkPolicies } from "@/lib/links";
import { PLACE_CATEGORIES } from "@/lib/db/schema";
import { PLACE_CATEGORY_LABELS, windowLabel, windowStart } from "@/lib/places/format";
import { openingSoon, recentOpenings } from "@/lib/places/public";
import { newInTownPath } from "@/lib/routes";
import { citySlugs } from "@/lib/site/queries";
import { SectionTitle } from "../../_components/chrome";
import { PlaceCard } from "../../_components/places";

type Category = (typeof PLACE_CATEGORIES)[number];
const isCategory = (c: string): c is Category => (PLACE_CATEGORIES as readonly string[]).includes(c);

export async function generateMetadata({ params }: PageProps<"/new/[category]">): Promise<Metadata> {
  const { category } = await params;
  return { title: isCategory(category) ? `New ${PLACE_CATEGORY_LABELS[category].toLowerCase()}` : "New in Town" };
}

/** One New in Town category: places opened in the last 6 months, newest first. The heading is computed, never written. */
export default async function NewInTownCategory({ params }: PageProps<"/new/[category]">) {
  const { category } = await params;
  if (!isCategory(category)) notFound();
  await connection();
  const db = getDb();
  const now = new Date();
  const policies = await loadLinkPolicies(db);
  const [cities, places, soon] = await Promise.all([citySlugs(db), recentOpenings(db, now, { category }), openingSoon(db, { category })]);
  const label = PLACE_CATEGORY_LABELS[category];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <p className="text-sm">
        <Link href={newInTownPath()} className="font-semibold underline underline-offset-4">
          New in Town
        </Link>
      </p>
      <h1 className="mt-2 font-display text-4xl font-extrabold text-brand sm:text-5xl">
        {label} opened since {windowLabel(windowStart(now))} ({places.length})
      </h1>
      {places.length === 0 ? (
        <p className="mt-6">None yet. Places appear here once their opening is confirmed from a source.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {places.map((p) => (
            <PlaceCard key={p.id} p={p} cities={cities} now={now} policies={policies} />
          ))}
        </ul>
      )}
      {soon.length > 0 && (
        <section aria-labelledby="opening-soon" className="mt-10">
          <SectionTitle id="opening-soon" tone="accent">
            Opening soon
          </SectionTitle>
          <ul className="mt-2 divide-y divide-line">
            {soon.map((p) => (
              <PlaceCard key={p.id} p={p} cities={cities} now={now} policies={policies} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
