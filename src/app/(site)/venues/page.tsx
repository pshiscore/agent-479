import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { VENUE_TYPE_LABELS } from "@/config/front-page";
import { getDb } from "@/lib/db/client";
import { cityPath, venuePath } from "@/lib/routes";
import { venuesByCity } from "@/lib/site/queries";

export const metadata: Metadata = { title: "Venues" };

export default async function Venues() {
  await connection();
  const groups = await venuesByCity(getDb(), new Date());
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="font-display text-4xl font-extrabold text-brand">Venues</h1>
      <div className="mt-6 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <section key={g.city.slug}>
            <h2 className="font-display text-xl font-extrabold">
              <Link href={cityPath(g.city.slug)} className="hover:text-accent">
                {g.city.name}
              </Link>
            </h2>
            <ul className="mt-2 grid gap-1 text-sm">
              {g.venues.map((v) => (
                <li key={v.slug} className="flex justify-between gap-3">
                  <Link href={venuePath(v.slug)} className="underline underline-offset-2">
                    {v.name}
                  </Link>
                  <span className="shrink-0 text-muted">
                    {v.upcoming > 0 ? `${v.upcoming} upcoming` : (VENUE_TYPE_LABELS[v.venue_type] ?? "")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
