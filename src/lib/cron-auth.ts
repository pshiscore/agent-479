import { timingSafeEqual } from "node:crypto";

/**
 * Vercel sends "Authorization: Bearer $CRON_SECRET" to cron routes. Anything
 * else is refused, and so is every request when CRON_SECRET isn't set.
 */
export function isAuthorizedCron(request: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < 16) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
