import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Invisible anti-spam for the submission form (owner, 2026-10-16: no CAPTCHA,
 * no third parties). The form carries a signed timestamp: a submission sent
 * less than a few seconds after the form loaded, or a day later, or with a
 * forged token, is refused. With the hidden "website" field (people leave it
 * empty), that stops most bots. Nothing about the visitor is stored.
 */

export const MIN_FILL_MS = 4_000;
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** A key of its own, derived from a secret the app already has. */
function key(): Buffer | null {
  const secret = process.env.CRON_SECRET;
  return secret ? createHmac("sha256", secret).update("479-guide:submission-token:v1").digest() : null;
}

const sign = (k: Buffer, t: string) => createHmac("sha256", k).update(t).digest("base64url");

export function issueToken(now = Date.now()): string | null {
  const k = key();
  if (!k) return null;
  const t = String(now);
  return `${t}.${sign(k, t)}`;
}

export type TokenCheck = "ok" | "too_fast" | "expired" | "invalid" | "unavailable";

export function checkToken(token: string, now = Date.now()): TokenCheck {
  const k = key();
  if (!k) return "unavailable";
  const [t, mac] = token.split(".");
  if (!t || !mac || !/^\d{10,16}$/.test(t)) return "invalid";
  const want = Buffer.from(sign(k, t));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return "invalid";
  const age = now - Number(t);
  if (age < MIN_FILL_MS) return "too_fast";
  if (age > MAX_AGE_MS) return "expired";
  return "ok";
}
