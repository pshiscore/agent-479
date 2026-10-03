/**
 * The user agent every outbound request sends (AGENTS.md rule 6). Throws when
 * BOT_CONTACT_EMAIL is unset, so nothing fetches anonymously.
 */
export function botUserAgent(email = process.env.BOT_CONTACT_EMAIL): string {
  const contact = email?.trim();
  if (!contact) throw new Error("BOT_CONTACT_EMAIL is not set; refusing to make outbound requests");
  return `Agent479Bot (contact: ${contact})`;
}
