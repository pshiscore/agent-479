/**
 * Some APIs take their key in the query string (Ticketmaster's `apikey`).
 * Any URL that may end up in an error message, runs.stats, or a log goes
 * through this first, so a key is never stored.
 */
const SECRET_PARAMS = /^(api_?key|key|token|access_token|client_secret|secret|signature|sig)$/i;

export function redactUrl(url: string | URL): string {
  let u: URL;
  try {
    u = new URL(String(url));
  } catch {
    return String(url).replace(/([?&](?:api_?key|key|token|access_token|client_secret|secret)=)[^&#\s]*/gi, "$1REDACTED");
  }
  for (const name of [...u.searchParams.keys()]) {
    if (SECRET_PARAMS.test(name)) u.searchParams.set(name, "REDACTED");
  }
  return u.toString();
}
