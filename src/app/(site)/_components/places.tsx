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
  yelpSearchUrl,
} from "@/lib/places/format";
import { mapsPlaceUrl } from "@/lib/google/places";
import { applyLinkPolicy, type LinkPolicy } from "@/lib/links";
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
export function PlaceCard({ p, cities, now, policies }: { p: PublicPlace; cities: Set<string>; now: Date; policies: readonly LinkPolicy[] }) {
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
      <div className="mt-1">
        <PlaceButtons p={p} policies={policies} compact />
      </div>
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

/**
 * The place's buttons (owner, 2026-10-11): Website and Menu when we have them
 * (the owner checked both), Google reviews (Google Maps, at the matched place
 * when there is one), and Yelp reviews (a search). Links only: nothing from
 * Google or Yelp is fetched, shown, or stored. The place page adds Directions.
 */
export function PlaceButtons({ p, policies, directions = false, compact = false }: { p: PublicPlace; policies: readonly LinkPolicy[]; directions?: boolean; compact?: boolean }) {
  const btn = `rounded-md border border-foreground/70 font-semibold hover:bg-chip ${compact ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"}`;
  const query = mapsQuery(p);
  const website = p.website ? applyLinkPolicy(p.website, policies) : null;
  const menu = p.menuUrl ? applyLinkPolicy(p.menuUrl, policies) : null;
  const google = p.googlePlaceId ? mapsPlaceUrl(query, p.googlePlaceId) : googleMapsSearchUrl(query);
  return (
    <div className="flex flex-wrap gap-2">
      {website && (
        <a href={website} className={btn} rel="noopener" target="_blank">
          Website
        </a>
      )}
      {menu && (
        <a href={menu} className={btn} rel="noopener" target="_blank">
          Menu
        </a>
      )}
      {directions && (
        <DirectionsLink google={googleDirectionsUrl(query)} apple={appleDirectionsUrl(query)} className={btn}>
          Directions
        </DirectionsLink>
      )}
      <a href={google} className={btn} rel="noopener" target="_blank">
        Google reviews
      </a>
      <a href={yelpSearchUrl(p)} className={btn} rel="noopener" target="_blank">
        Yelp reviews
      </a>
    </div>
  );
}
