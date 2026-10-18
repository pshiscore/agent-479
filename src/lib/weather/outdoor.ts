/**
 * Which venues are outdoor (owner, 2026-10-17): parks, areas, and plazas by
 * type, plus venues the venue seed marks outdoor (the AMP, Butterfield Stage,
 * the ballparks and stadiums, and Pinnacle Hills Promenade), signed off like
 * any venue fact. An event is
 * also outdoor when it carries the Outdoor tag. Outdoor events show the chance
 * of rain and NWS warning badges.
 */
export const OUTDOOR_TYPES: readonly string[] = ["park", "area", "plaza"];

export const isOutdoorVenue = (v: { venueType: string; outdoor?: boolean | null }) => OUTDOOR_TYPES.includes(v.venueType) || v.outdoor === true;
