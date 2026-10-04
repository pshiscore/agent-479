/**
 * The bot's public identity (AGENTS.md rule 6). Every outbound request sends
 *   Agent479Bot/1.0 (+https://479.guide/bot; bot@479.guide)
 * built from SITE_URL (where /bot explains what we fetch and how to opt out)
 * and BOT_CONTACT_EMAIL. Both are published in other sites' logs and on /bot,
 * so the contact must be an address on the site's own domain, never a
 * personal one, and the site must be its public https origin.
 */
export const BOT_NAME = "Agent479Bot";
export const BOT_VERSION = "1.0";
export const DEFAULT_SITE = "https://479.guide";
export const DEFAULT_CONTACT = "bot@479.guide";

export class BotIdentityError extends Error {}

export function botIdentity(email = process.env.BOT_CONTACT_EMAIL, siteUrl = process.env.SITE_URL): { site: string; contact: string } {
  const contact = email?.trim();
  if (!contact) throw new BotIdentityError("BOT_CONTACT_EMAIL is not set; refusing to make outbound requests");
  const site = siteUrl?.trim().replace(/\/+$/, "");
  const m = site ? /^https:\/\/([a-z0-9.-]+)$/i.exec(site) : null;
  if (!site || !m || /^(localhost|127\.0\.0\.1)$/i.test(m[1])) {
    throw new BotIdentityError(`SITE_URL must be the site's https origin (${DEFAULT_SITE}); refusing to make outbound requests`);
  }
  const domain = m[1].toLowerCase().replace(/^www\./, "");
  if (!contact.toLowerCase().endsWith(`@${domain}`)) {
    throw new BotIdentityError(`BOT_CONTACT_EMAIL must be an address at ${domain} (e.g. ${DEFAULT_CONTACT}), never a personal one`);
  }
  return { site, contact };
}

/** The identity for display (/bot): the configured one if valid, else the defaults. Never throws. */
export function publicBotIdentity(): { site: string; contact: string } {
  try {
    return botIdentity();
  } catch {
    return { site: DEFAULT_SITE, contact: DEFAULT_CONTACT };
  }
}

export function botUserAgent(email = process.env.BOT_CONTACT_EMAIL, siteUrl = process.env.SITE_URL): string {
  const { site, contact } = botIdentity(email, siteUrl);
  return `${BOT_NAME}/${BOT_VERSION} (+${site}/bot; ${contact})`;
}
