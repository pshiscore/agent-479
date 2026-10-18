import type { WeatherHour } from "@/lib/db/schema";

/**
 * Pure readers for National Weather Service API responses (event weather).
 * NWS data is public domain; we keep facts only: per hour the temperature,
 * day or night, the condition code from its icon address (we draw our own
 * icons and never load theirs), the short forecast text, and the chance of
 * rain. For alerts: type, severity, times, outline, and zone codes.
 */

export const API = "https://api.weather.gov";

export const hourlyUrl = (office: string, x: number, y: number) => `${API}/gridpoints/${office}/${x},${y}/forecast/hourly`;
export const ALERTS_URL = `${API}/alerts/active?area=AR`;

/** "https://api.weather.gov/icons/land/day/tsra_hi,40/rain,30?size=small" → "tsra_hi" (the first, primary condition). */
export function conditionCode(iconUrl: unknown): string {
  if (typeof iconUrl !== "string") return "unknown";
  try {
    const parts = new URL(iconUrl).pathname.split("/").filter(Boolean);
    const i = parts.findIndex((p) => p === "day" || p === "night");
    const code = i >= 0 ? parts[i + 1] : undefined;
    return code ? code.split(",")[0] : "unknown";
  } catch {
    return "unknown";
  }
}

/** An hourly forecast: its NWS update time and the hours from `keepFrom` on. */
export function parseHourly(body: string, keepFrom: Date): { updatedAt: Date | null; hours: WeatherHour[] } {
  const p = (JSON.parse(body) as { properties?: { updateTime?: string; generatedAt?: string; periods?: Record<string, unknown>[] } }).properties;
  if (!p?.periods || !Array.isArray(p.periods)) throw new Error("no periods in the hourly forecast");
  const updated = p.updateTime ?? p.generatedAt;
  const hours: WeatherHour[] = [];
  for (const h of p.periods) {
    const start = new Date(String(h.startTime));
    if (Number.isNaN(start.getTime()) || start < keepFrom) continue;
    const t = Number(h.temperature);
    if (!Number.isFinite(t)) continue;
    // NWS hourly temperatures are Fahrenheit unless it says otherwise.
    const tempF = h.temperatureUnit === "C" ? Math.round((t * 9) / 5 + 32) : Math.round(t);
    const pop = (h.probabilityOfPrecipitation as { value?: unknown } | undefined)?.value;
    hours.push({
      start: start.toISOString(),
      tempF,
      isDaytime: h.isDaytime === true,
      code: conditionCode(h.icon),
      shortForecast: typeof h.shortForecast === "string" ? h.shortForecast.slice(0, 80) : "",
      popPct: typeof pop === "number" ? Math.round(pop) : null,
    });
  }
  return { updatedAt: updated ? new Date(updated) : null, hours };
}

export interface ParsedAlert {
  nwsId: string;
  event: string;
  severity: string | null;
  onsetAt: Date | null;
  endsAt: Date | null;
  geometry: Record<string, unknown> | null;
  zones: string[];
}

const when = (v: unknown) => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Active alerts: an outline when NWS gives one, and the zone codes (UGC) it covers. */
export function parseAlerts(body: string): ParsedAlert[] {
  const features = (JSON.parse(body) as { features?: { geometry?: Record<string, unknown> | null; properties?: Record<string, unknown> }[] }).features;
  if (!Array.isArray(features)) throw new Error("no features in the alerts response");
  const out: ParsedAlert[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    if (typeof p.id !== "string" || typeof p.event !== "string") continue;
    const ugc = ((p.geocode as { UGC?: unknown } | undefined)?.UGC ?? []) as unknown[];
    const zoneUrls = (Array.isArray(p.affectedZones) ? p.affectedZones : []) as unknown[];
    const zones = [...new Set([...ugc, ...zoneUrls.map((z) => (typeof z === "string" ? z.split("/").pop() : null))].filter((z): z is string => typeof z === "string" && /^[A-Z]{2}[CZ]\d{3}$/.test(z)))];
    out.push({
      nwsId: p.id,
      event: p.event.slice(0, 120),
      severity: typeof p.severity === "string" ? p.severity : null,
      onsetAt: when(p.onset) ?? when(p.effective),
      endsAt: when(p.ends) ?? when(p.expires),
      geometry: f.geometry ?? null,
      zones,
    });
  }
  return out;
}
