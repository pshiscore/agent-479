import Link from "next/link";
import {
  PLACE_KIND_LABELS,
  PLACE_TYPE_LABELS,
  addressLine,
  appleDirectionsUrl,
  googleDirectionsUrl,
  googleMapsSearchUrl,
  justOpened,
  mapsQuery,
  openedLabel,
  targetLabel,
} from "@/lib/places/format";
import type { PublicPlace } from "@/lib/places/public";
import { cityPath, placePath } from "@/lib/routes";
import { slugify } from "@/lib/slug";
import { DirectionsLink } from "./directions-link";

/** New in Town pieces (docs/product/front-page.md, H): facts only, no reviews or ratings. */

/** The city, linked to its page when we have one. */
export function PlaceCity({ city, cities }: { city: string; cities: Set<string> }) {
  const slug = slugify(city);
  return cities.has(slug) ? (
    <Link href={cityPath(slug)} className="underline underline-offset-2 hover:text-accent">
      {city}
    </Link>
  ) : (
    <>{city}</>
  );
}

/** "New", "New location", ... plus "Just opened" within 30 days of a stated day. */
export function PlaceLabels({ p, now }: { p: PublicPlace; now: Date }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
      <span className="rounded bg-tint px-2 py-0.5 text-accent">{PLACE_TYPE_LABELS[p.placeType]}</span>
      <span className="rounded border border-line px-2 py-0.5 text-muted">{PLACE_KIND_LABELS[p.kind]}</span>
      {p.status === "open" && justOpened(p, now) && <span className="rounded border border-accent px-2 py-0.5 text-accent">Just opened</span>}
    </div>
  );
}

/** The stated opening (or target) date. */
export const placeWhen = (p: PublicPlace) => (p.status === "open" ? openedLabel(p) : targetLabel(p));

/** One place in a list: name (to its page), date, address, and labels. */
export function PlaceCard({ p, cities, now }: { p: PublicPlace; cities: Set<string>; now: Date }) {
  return (
    <li className="grid gap-1.5 py-4">
      <p className="text-sm font-semibold text-accent">{placeWhen(p)}</p>
      <h3 className="font-display text-xl font-extrabold leading-tight">
        <Link href={placePath(p.slug)} className="hover:text-accent">
          {p.name}
        </Link>
      </h3>
      <p className="text-sm">
        {addressLine(p)}, <PlaceCity city={p.city} cities={cities} />
      </p>
      <PlaceLabels p={p} now={now} />
    </li>
  );
}

/** A compact row for the homepage module. */
export function PlaceRow({ p }: { p: PublicPlace }) {
  return (
    <li>
      <Link href={placePath(p.slug)} className="block py-3 hover:text-accent">
        <span className="font-bold">{p.name}</span>
        <span className="block text-xs text-muted">
          {PLACE_TYPE_LABELS[p.placeType]}, {p.city} · {placeWhen(p)}
        </span>
      </Link>
    </li>
  );
}

/** Website, Directions, and "Reviews on Google Maps" (a plain link: nothing is fetched or shown from it). */
export function PlaceLinks({ p, website }: { p: PublicPlace; website: string | null }) {
  const btn = "rounded-md border border-foreground/70 px-3 py-1.5 text-sm font-semibold hover:bg-chip";
  const query = mapsQuery(p);
  return (
    <div className="flex flex-wrap gap-2">
      {website && (
        <a href={website} className={btn} rel="noopener" target="_blank">
          Website
        </a>
      )}
      <DirectionsLink google={googleDirectionsUrl(query)} apple={appleDirectionsUrl(query)} className={btn}>
        Directions
      </DirectionsLink>
      <a href={googleMapsSearchUrl(query)} className={btn} rel="noopener" target="_blank">
        Reviews on Google Maps
      </a>
    </div>
  );
}
