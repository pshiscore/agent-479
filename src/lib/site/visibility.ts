import { TICKETMASTER_DISPLAY_APPROVED } from "@/config/front-page";
import { type AccessEnv, isSiteLocked } from "@/lib/site-access";

/**
 * Whether events from a source may appear on public pages. Ticketmaster's
 * stay hidden once the site is unlocked, until their display terms are
 * re-read and approved (TICKETMASTER_DISPLAY_APPROVED); while locked, the
 * owner can preview them.
 */
export function sourceVisible(sourceSlug: string, env: AccessEnv = process.env): boolean {
  if (sourceSlug !== "ticketmaster") return true;
  return TICKETMASTER_DISPLAY_APPROVED || isSiteLocked(env);
}
