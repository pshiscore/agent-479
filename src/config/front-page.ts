/**
 * Front page rules (docs/product/front-page.md). Rules and weights live here,
 * in config, never in judgment; changing one is a code change.
 */

/**
 * The feature slot (section B1): one upcoming event, chosen by these rules.
 * Each event scores the sum of the weights of the rules it meets; the highest
 * score wins, then the soonest start. Events in a recurring series never
 * feature. The choice is logged with the rules that selected it.
 */
export const FEATURE_RULES = {
  horizonDays: 30,
  newlyAnnounced: { days: 7, weight: 2 },
  largeVenue: {
    weight: 1,
    // PROPOSED tier (2026-10-04), pending the owner's confirmation: we have no
    // venue capacity data, so this is the owner's list, by venue slug.
    venues: [
      "walmart-amp",
      "bud-walton-arena",
      "razorback-stadium",
      "baum-walker-stadium",
      "arvest-ballpark",
      "barnhill-arena",
      "walton-arts-center",
      "ozark-music-hall",
    ],
  },
} as const;

/** "This weekend" variety (section B2): at most this many per venue, and in all. */
export const WEEKEND_LIMITS = { perVenue: 2, total: 14 } as const;

/** Lists (section B4): rule-based collections, each a filtered view. */
export const LISTS = [
  { slug: "free", name: "Free", blurb: "Events whose own listing says they're free.", tag: "free", days: null },
  { slug: "volunteer", name: "Volunteer", blurb: "Blood drives, volunteer fairs, and other ways to help.", tag: "volunteer", days: null },
  { slug: "family-friendly", name: "Family-friendly this week", blurb: "Programs listed for kids and families.", tag: "family-friendly", days: 7 },
  { slug: "en-espanol", name: "En español", blurb: "Events held in Spanish.", tag: "en-espanol", days: null },
] as const;

/** Tag order on cards (section C: at most 3 shown). */
export const TAG_ORDER = [
  "free",
  "ticketed",
  "family-friendly",
  "21-plus",
  "registration-required",
  "en-espanol",
  "volunteer",
  "outdoor",
  "dog-friendly",
  "biking",
] as const;

/** Venue types offered in the venue-type filter, with their labels. */
export const VENUE_TYPE_LABELS: Record<string, string> = {
  library: "At a library",
  park: "In a park",
  museum: "At a museum",
  theater: "At a theater",
  music_venue: "At a music venue",
  arena: "At an arena or stadium",
};

/**
 * Ticketmaster events stay off public pages until their display, attribution,
 * and image terms are re-read and recorded (docs/PREDEPLOY_CHECKLIST.md).
 * While the site is locked they show, so the owner can preview them.
 */
export const TICKETMASTER_DISPLAY_APPROVED = false;
