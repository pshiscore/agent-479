import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { applyLinkPolicy, loadLinkPolicies } from "@/lib/links";
import { cityPath } from "@/lib/routes";
import { slugify } from "@/lib/slug";
import { venueBySlug } from "@/lib/site/queries";
import { Listing } from "../../_components/listing";

export async function generateMetadata({ params }: PageProps<"/venue/[slug]">): Promise<Metadata> {
  const venue = await venueBySlug(getDb(), (await params).slug);
  return { title: venue?.name ?? "Venue" };
}

export default async function VenuePage({ params, searchParams }: PageProps<"/venue/[slug]">) {
  const { slug } = await params;
  const db = getDb();
  const venue = await venueBySlug(db, slug);
  if (!venue) notFound();
  const website = venue.website ? applyLinkPolicy(venue.website, await loadLinkPolicies(db)) : null;
  return (
    <Listing
      path={`/venue/${slug}`}
      params={await searchParams}
      fixed={{ venue: slug }}
      hide={["city", "venueType"]}
      heading={venue.name}
      subheading={
        <p>
          {venue.address ? `${venue.address}, ` : ""}
          <Link href={cityPath(slugify(venue.city))} className="underline underline-offset-2">
            {venue.city}
          </Link>
          {website ? (
            <>
              {" · "}
              <a href={website} className="underline underline-offset-2" rel="noopener" target="_blank">
                Website
              </a>
            </>
          ) : null}
        </p>
      }
    />
  );
}
