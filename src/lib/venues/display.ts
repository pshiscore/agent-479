/**
 * How a venue is named on the site: with the room or hall first when the event
 * is in one, e.g. "Baum Walker Hall, Walton Arts Center".
 */
export function venueDisplayName(venueName: string, subSpace?: string | null): string {
  const room = subSpace?.trim();
  return room ? `${room}, ${venueName}` : venueName;
}
