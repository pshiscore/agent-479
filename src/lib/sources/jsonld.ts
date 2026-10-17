import { decodeEntities } from "@/lib/text/entities";

/**
 * Schema.org events in a page's JSON-LD (step 7, the structured-data
 * fetcher; docs/product/organizers.md). Pages are untrusted data: only the
 * whitelisted facts below leave this module; the description goes to the
 * internal staging column, never into the payload.
 */

const EVENT_TYPE = /(^|[^a-z])(Event|[A-Za-z]+Event)$/;

/** Every object typed Event (or a subtype like MusicEvent) with a name and a start, in document order. */
export function jsonLdEventObjects(html: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const types = ([] as unknown[]).concat(o["@type"] ?? []).map(String);
    if (types.some((t) => EVENT_TYPE.test(t)) && typeof o.name === "string" && typeof o.startDate === "string") found.push(o);
    if (o["@graph"]) visit(o["@graph"]);
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1]));
    } catch {
      // Malformed JSON-LD says nothing.
    }
  }
  return found;
}

/** The facts we keep from one JSON-LD event. */
export interface JsonLdFacts {
  type: string;
  name: string;
  startDate: string;
  endDate: string | null;
  eventStatus: string | null;
  attendanceMode: string | null;
  url: string | null;
  location: { name: string | null; street: string | null; city: string | null; text: string | null; virtual: boolean } | null;
  offers: { price: number | null; lowPrice: number | null; highPrice: number | null; currency: string | null; url: string | null }[];
  performers: string[];
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? decodeEntities(v).replace(/\s+/g, " ").trim() : null);
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,]/g, "")) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const list = (v: unknown) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const last = (v: string | null) => (v ? v.split(/[/#]/).pop() ?? v : null);

const absolute = (v: unknown, base: string) => {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s, base);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
};

/** Whitelists one event's facts; its description comes back separately. */
export function jsonLdFacts(o: Record<string, unknown>, pageUrl: string): { facts: JsonLdFacts; description: string | null } {
  const types = list(o["@type"]).map(String);
  const place = list(o.location).find((l) => l && typeof l === "object" && /Place/.test(String((l as Record<string, unknown>)["@type"] ?? "Place"))) as Record<string, unknown> | undefined;
  const virtual = list(o.location).some((l) => l && typeof l === "object" && /VirtualLocation/.test(String((l as Record<string, unknown>)["@type"])));
  const locText = list(o.location).map(str).find(Boolean) ?? null;
  const addr = place?.address;
  const a = addr && typeof addr === "object" ? (addr as Record<string, unknown>) : null;
  const location =
    place || locText || virtual
      ? {
          name: str(place?.name),
          street: a ? str(a.streetAddress) : null,
          city: a ? str(a.addressLocality) : null,
          text: [str(place?.name), a ? [str(a.streetAddress), str(a.addressLocality)].filter(Boolean).join(", ") : str(addr)].filter(Boolean).join(", ") || locText,
          virtual: virtual && !place,
        }
      : null;
  const offers = list(o.offers)
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({ price: num(x.price), lowPrice: num(x.lowPrice), highPrice: num(x.highPrice), currency: str(x.priceCurrency), url: absolute(x.url, pageUrl) }));
  const performers = list(o.performer)
    .map((p) => (p && typeof p === "object" ? str((p as Record<string, unknown>).name) : str(p)))
    .filter((n): n is string => !!n);
  return {
    facts: {
      type: types.find((t) => EVENT_TYPE.test(t)) ?? "Event",
      name: str(o.name)!.slice(0, 300),
      startDate: String(o.startDate).trim(),
      endDate: str(o.endDate),
      eventStatus: last(str(o.eventStatus)),
      attendanceMode: last(str(o.eventAttendanceMode)),
      url: absolute(o.url, pageUrl),
      location,
      offers,
      performers,
    },
    description: str(o.description)?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null,
  };
}
