import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/lib/db/client";
import { applyLinkPolicy, loadLinkPolicies } from "@/lib/links";
import { PLACE_TYPE_LABELS, addressLine, schemaType, statedDate } from "@/lib/places/format";
import { linkedVenueSlug, placeBySlug, type PublicPlace } from "@/lib/places/public";
import { newInTownPath, venuePath } from "@/lib/routes";
import { citySlugs } from "@/lib/site/queries";
import { chicagoDate, formatDate } from "@/lib/time";
import { PlaceCity, PlaceLabels, PlaceLinks, placeWhen } from "../../_components/places";

/** A place's own page (docs/product/front-page.md, H): facts, links, and sources. No reviews or ratings. */

export async function generateMetadata({ params }: PageProps<"/place/[slug]">): Promise<Metadata> {
  const p = await placeBySlug(getDb(), (await params).slug);
  return { title: p?.name ?? "New in Town" };
}

/** schema.org LocalBusiness markup: name, type, address, website. Never ratings or reviews. */
function jsonLd(p: PublicPlace, website: string | null) {
  return {
    "@context": "https://schema.org",
    "@type": schemaType(p.placeType),
    name: p.name,
    address: {
      "@type": "PostalAddress",
      // Only a street address is a street address; an intersection or a food truck's base isn't.
      ...(p.addressKind === "street" ? { streetAddress: p.address } : {}),
      addressLocality: p.city,
      addressRegion: "AR",
      ...(p.postalCode ? { postalCode: p.postalCode } : {}),
      addressCountry: "US",
    },
    ...(website ? { url: website } : {}),
  };
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export default async function PlacePage({ params }: PageProps<"/place/[slug]">) {
  await connection();
  const db = getDb();
  const p = await placeBySlug(db, (await params).slug);
  if (!p) notFound();
  const now = new Date();
  const policies = await loadLinkPolicies(db);
  const website = p.website ? applyLinkPolicy(p.website, policies) : null;
  const [cities, venueSlug] = await Promise.all([citySlugs(db), linkedVenueSlug(db, p.venueId)]);
  // Sources shown are the ones the owner checked: they back the facts on this page.
  const sources = p.sources.filter((s) => s.verifiedBy === "owner").map((s) => ({ ...s, href: applyLinkPolicy(s.url, policies) }));

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-8">
      {/* JSON-LD: "<" is escaped so no text can close the script tag. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(p, website)).replace(/</g, "\\u003c") }} />
      <p className="text-sm">
        <Link href={newInTownPath(p.category)} className="font-semibold underline underline-offset-4">
          New in Town
        </Link>
      </p>
      <p className="mt-6 text-sm font-semibold text-accent">{placeWhen(p)}</p>
      <h1 className="mt-1 font-display text-4xl font-extrabold leading-none text-brand sm:text-5xl">{p.name}</h1>
      <p className="mt-3">
        {PLACE_TYPE_LABELS[p.placeType]} · {addressLine(p)}, <PlaceCity city={p.city} cities={cities} />
      </p>
      <div className="mt-3">
        <PlaceLabels p={p} now={now} />
      </div>
      {p.description && p.descriptionGeneratedAt && (
        <div className="mt-6">
          <p>{p.description}</p>
          <p className="mt-1 text-xs text-muted">Summary generated {statedDate(formatDate(chicagoDate(p.descriptionGeneratedAt)), "day")} from the sources below.</p>
        </div>
      )}
      <div className="mt-6">
        <PlaceLinks p={p} website={website} />
      </div>
      {venueSlug && (
        <p className="mt-6 text-sm">
          <Link href={venuePath(venueSlug)} className="font-semibold underline underline-offset-4">
            Events at {p.name}
          </Link>
        </p>
      )}
      {sources.length > 0 && (
        <section aria-labelledby="sources" className="mt-10 border-t border-line pt-4 text-sm">
          <h2 id="sources" className="font-bold">
            Sources
          </h2>
          <ul className="mt-2 grid gap-1">
            {sources.map((s) => (
              <li key={s.url}>
                {s.href ? (
                  <a href={s.href} className="underline underline-offset-2" rel="noopener" target="_blank">
                    {host(s.url)}
                  </a>
                ) : (
                  host(s.url)
                )}
                {s.checkedAt ? <span className="text-muted"> · Last checked {statedDate(s.checkedAt, "day")}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
