import type { VenueGroupSlug } from "@/config/venue-groups";

/** Venue group icons: inline strokes in the site's icon style (no emoji, no icon package). Decorative: the label says the group. */

const PATHS: Record<VenueGroupSlug, React.ReactNode> = {
  // A tree.
  "parks-trails": <path d="M8 14v-3m0 0L4.5 11 8 2l3.5 9H8z" />,
  // A music note.
  "music-bars": (
    <>
      <path d="M6 12V3.5l6-1.5v8" />
      <circle cx="4.5" cy="12" r="1.5" />
      <circle cx="10.5" cy="10" r="1.5" />
    </>
  ),
  // A framed picture.
  "museums-arts": (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1" />
      <path d="M2.5 11l3.5-3.5 3 3 2-2 2.5 2.5" />
    </>
  ),
  // A stage with curtains.
  "arenas-theaters": <path d="M2 3h12M3 3v10M13 3v10M3 3c1.5 3 3.5 4 5 4s3.5-1 5-4M2 13h12" />,
  // An open book.
  "libraries-civic": <path d="M8 4.5C6.5 3.5 4.5 3 2.5 3v9.5c2 0 4 .5 5.5 1.5 1.5-1 3.5-1.5 5.5-1.5V3c-2 0-4 .5-5.5 1.5zM8 4.5V14" />,
  // A calendar.
  "event-spaces": (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </>
  ),
  // A map pin.
  "districts-markets": (
    <>
      <path d="M8 14s4.5-4 4.5-7.5a4.5 4.5 0 10-9 0C3.5 10 8 14 8 14z" />
      <circle cx="8" cy="6.5" r="1.5" />
    </>
  ),
  // A dot.
  other: <circle cx="8" cy="8" r="2.5" />,
};

export function VenueGroupIcon({ group, className = "h-4 w-4" }: { group: VenueGroupSlug; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[group]}
    </svg>
  );
}
