import { asc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin/auth";
import { getDb } from "@/lib/db/client";
import { organizers, venues } from "@/lib/db/schema";
import { formatInChicago } from "@/lib/time";

/**
 * The organizer registry (docs/product/organizers.md), read-only. Entries are
 * internal pointers: the agent verifies each against the organizer's own
 * site and logs it (no sign-off). Changes show in the agent log.
 */

const TYPE_LABELS: Record<string, string> = {
  government: "Government",
  parks_department: "Parks department",
  fire_department: "Fire department",
  library: "Library",
  museum: "Museum",
  venue: "Venue",
  downtown_organization: "Downtown organization",
  chamber: "Chamber of commerce",
  festival_organizer: "Festival organizer",
  race_organizer: "Race organizer",
  nonprofit: "Nonprofit",
  business: "Business",
};

export default async function OrganizersPage() {
  await requireAdmin();
  const db = getDb();
  const rows = await db
    .select({ o: organizers, venueName: venues.name })
    .from(organizers)
    .leftJoin(venues, eq(venues.id, organizers.venueId))
    .orderBy(asc(organizers.status), asc(organizers.organizerType), asc(organizers.name));
  const counts = rows.reduce<Record<string, number>>((n, r) => ({ ...n, [r.o.status]: (n[r.o.status] ?? 0) + 1 }), {});

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-lg font-semibold">Organizer registry</h1>
        <p className="text-zinc-500">
          {rows.length} organizers: {counts.verified ?? 0} verified against their own site, {counts.candidate ?? 0} candidates
          {counts.retired ? `, ${counts.retired} retired` : ""}. Internal only; nothing here is published.
        </p>
      </div>
      <ul className="grid divide-y divide-zinc-100 dark:divide-zinc-800">
        {rows.map(({ o, venueName }) => {
          const events = o.verification.notes?.find((n) => n.note?.startsWith("Events link"))?.url;
          return (
            <li key={o.id} className="grid gap-1 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-semibold">{o.name}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${o.status === "verified" ? "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}>{o.status}</span>
                <span className="text-zinc-500">
                  {TYPE_LABELS[o.organizerType]} · {o.city ?? "—"}
                  {o.homeCounty ? ` (${o.homeCounty} County)` : ""} · publishes by {o.channel.replace("_", " ")}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {o.website && (
                  <a href={o.website} className="break-all underline" rel="noopener" target="_blank">
                    {o.website}
                  </a>
                )}
                {events && (
                  <a href={events} className="break-all underline" rel="noopener" target="_blank">
                    Events link (hint)
                  </a>
                )}
                {venueName && <span>Venue: {venueName}</span>}
                {o.lastCheckedAt && <span className="text-zinc-500">Checked {formatInChicago(o.lastCheckedAt, { month: "short", day: "numeric", year: "numeric" })}</span>}
              </div>
              {o.notes && <p className="text-zinc-500">{o.notes}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
