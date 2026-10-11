import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin/auth";
import { placeById, publishBlockers, suggestVenues, targetPassed } from "@/lib/admin/places";
import { getDb } from "@/lib/db/client";
import { addableFacts, placeFacts } from "@/lib/places/describe";
import { addressLine, openedLabel, PLACE_KIND_LABELS, PLACE_TYPE_LABELS, targetLabel } from "@/lib/places/format";
import { googleBrowserKey, mapsPlaceUrl } from "@/lib/google/places";
import { editPlace, hidePlaceAction, linkPlaceVenue, removePlaceDescriptionAction, setGooglePlaceAction, writePlaceDescriptionAction } from "../../actions";
import { GoogleMatch } from "../google-match";
import { button, input, Notice, when } from "../../ui";
import { PlaceForm } from "../form";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const monthOrDay = (on: string | null, precision: string | null) => (on ? (precision === "month" ? on.slice(0, 7) : on) : "");

export default async function PlacePage({ params, searchParams }: PageProps<"/admin/places/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const q = await searchParams;
  const db = getDb();
  const p = /^[0-9a-f-]{36}$/i.test(id) ? await placeById(db, id) : null;
  if (!p) notFound();
  const suggestions = await suggestVenues(db, p);
  const cities = ((await db.execute(sql`select distinct city from venues where active order by 1`)) as unknown as { city: string }[]).map((r) => r.city);
  const blockers = publishBlockers(p);
  const live = p.status === "open" || p.status === "opening_soon";
  const facts = addableFacts(placeFacts(p));
  const googleKey = googleBrowserKey();
  const checks: [boolean, string][] = [
    [p.openToPublic === true, "Open to the public, confirmed by you"],
    [Boolean(p.openedOn || (p.targetOn && !targetPassed(p))), p.targetOn && !p.openedOn && targetPassed(p) ? "A stated opening date (the target date has passed: if it opened, put the date in Opened)" : "A stated opening date (or a future target date if it hasn't opened yet)"],
    [p.sources.some((s) => s.verifiedBy === "owner"), "A page you checked in your browser"],
  ];

  return (
    <div className="grid gap-8">
      <Notice msg={one(q.msg)} error={one(q.error)} />
      <div>
        <Link href="/admin/places" className="text-sm underline">
          All places
        </Link>
        <h1 className="mt-1 text-lg font-semibold">{p.name}</h1>
        <p className="text-zinc-500">
          {PLACE_TYPE_LABELS[p.placeType]} · {PLACE_KIND_LABELS[p.kind]} · {addressLine(p)}, {p.city} · status: <strong>{p.status.replace("_", " ")}</strong>
          {p.streetNumberUnconfirmed ? " · street number unconfirmed" : ""}
        </p>
        <p>{openedLabel(p) ?? targetLabel(p) ?? "No stated opening date"}</p>
        <p className="text-sm">
          Open to the public: <strong>{p.openToPublic === true ? "yes (confirmed)" : p.openToPublic === false ? "no" : "not confirmed"}</strong> ·{" "}
          <Link className="underline" href={`/admin/agent-log?id=${p.id}`}>
            history
          </Link>
        </p>
      </div>

      {p.status === "opening_soon" && (
        <section className="rounded border border-zinc-300 p-3 dark:border-zinc-700">
          <h2 className="mb-1 text-base font-semibold">Opening soon</h2>
          <p>
            Public as &quot;{targetLabel(p)}&quot;. Once it has opened: put the stated date in <strong>Opened</strong>, record the page that says so, and choose{" "}
            <strong>Save and mark open</strong>.
          </p>
          {targetPassed(p) && <p className="mt-1 text-amber-700 dark:text-amber-400">The target date has passed. If it opened, mark it open; if not, hide it until there&apos;s a new date.</p>}
        </section>
      )}
      {!live && p.status !== "hidden" && (
        <section className="rounded border border-zinc-300 p-3 dark:border-zinc-700">
          <h2 className="mb-1 text-base font-semibold">To publish</h2>
          <ul className="grid gap-0.5">
            {checks.map(([ok, text]) => (
              <li key={text} className={ok ? "text-green-700 dark:text-green-400" : ""}>
                {ok ? "✓" : "✗"} {text}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-zinc-500">
            {blockers.length ? "Fill in what's missing in the form below, then choose Save and publish." : "Ready: choose Save and publish below."}
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-base font-semibold">Edit</h2>
        {/* Keyed on the last save, so the form starts fresh after each one (no stale "what it says"). */}
        <PlaceForm
          key={p.updatedAt.toISOString()}
          action={editPlace}
          hidden={{ id: p.id, openToPublicCurrent: String(p.openToPublic) }}
          cities={cities}
          submit="Save"
          withSource={false}
          verify={{ canPublish: !live, openingSoon: p.status === "opening_soon", leads: p.sources.filter((s) => s.verifiedBy !== "owner").map((s) => s.url) }}
          values={{
            name: p.name,
            placeType: p.placeType,
            kind: p.kind,
            address: p.address,
            addressKind: p.addressKind === "home_base" ? "street" : p.addressKind,
            city: p.city,
            postalCode: p.postalCode,
            opened: monthOrDay(p.openedOn, p.openedPrecision),
            openedQualifier: p.openedQualifier,
            target: monthOrDay(p.targetOn, p.targetPrecision),
            targetQualifier: p.targetQualifier,
            website: p.website,
            notes: p.notes,
            openToPublic: p.openToPublic,
          }}
        />
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">Sources</h2>
        <ul className="grid gap-1 text-sm">
          {p.sources.map((s) => (
            <li key={s.url}>
              <a className="underline" href={s.url} target="_blank" rel="noreferrer">
                {s.url}
              </a>{" "}
              {s.verifiedBy === "owner" ? (
                <span className="text-green-700 dark:text-green-400">
                  owner-verified {s.checkedAt}: {s.confirmed}
                  {s.facts?.length ? ` · stated facts: ${s.facts.join("; ")}` : ""}
                </span>
              ) : (
                <span className="text-amber-700 dark:text-amber-400">not verified{s.note ? ` (${s.note})` : ""}</span>
              )}
            </li>
          ))}
          {p.sources.length === 0 && <li className="text-zinc-500">No source yet.</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">Description</h2>
        {p.description ? (
          <>
            <p className="max-w-3xl">{p.description}</p>
            <p className="text-sm text-zinc-500">Generated {when(p.descriptionGeneratedAt)} from the stated facts.</p>
          </>
        ) : (
          <p className="text-zinc-500">
            {facts.length ? "None yet." : "None: no stated fact beyond the name and type. Add facts when you record a source you checked."}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {facts.length > 0 && (
            <form action={writePlaceDescriptionAction}>
              <input type="hidden" name="id" value={p.id} />
              <button className={button}>{p.description ? "Rewrite description" : "Write description"}</button>
            </form>
          )}
          {p.description && (
            <form action={removePlaceDescriptionAction}>
              <input type="hidden" name="id" value={p.id} />
              <button className="rounded border border-zinc-400 px-3 py-1">Remove</button>
            </form>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">Status</h2>
        {live ? (
          <p>
            Public since {when(p.publishedAt)} as {p.status === "open" ? "now open" : "opening soon"}.
          </p>
        ) : (
          <p className="text-zinc-500">Not public yet. Use Save and publish above.</p>
        )}
        {p.status !== "hidden" && (
          <form action={hidePlaceAction} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="id" value={p.id} />
            <input name="reason" required minLength={3} placeholder="Why hide it?" className={`${input} min-w-64 flex-1`} />
            <button className="rounded border border-zinc-400 px-3 py-1">Hide</button>
          </form>
        )}
        {p.status === "hidden" && <p className="text-sm text-zinc-500">Hidden {when(p.hiddenAt)}: {p.hiddenReason}</p>}
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">Google match</h2>
        <p className="mb-2 text-zinc-500">
          For &quot;Show Google ratings and reviews&quot; on the place page. Only Google&apos;s place ID is stored; you confirm it, never automatic.
        </p>
        {p.googlePlaceId ? (
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Matched: <span className="font-mono text-xs">{p.googlePlaceId}</span> ({when(p.googlePlaceIdConfirmedAt)})
            </span>
            <a className="underline" target="_blank" rel="noreferrer" href={mapsPlaceUrl(`${p.name}, ${p.address}, ${p.city}`, p.googlePlaceId)}>
              Open in Google Maps
            </a>
            <form action={setGooglePlaceAction}>
              <input type="hidden" name="id" value={p.id} />
              <button name="remove" value="1" className="text-sm underline">
                Remove match
              </button>
            </form>
          </div>
        ) : googleKey ? (
          <GoogleMatch browserKey={googleKey} placeId={p.id} query={`${p.name}, ${p.address}, ${p.city}, AR`} action={setGooglePlaceAction} />
        ) : (
          <p className="text-zinc-500">No Google browser key set (NEXT_PUBLIC_GOOGLE_MAPS_KEY).</p>
        )}
        {!p.googlePlaceId && (
          <form action={setGooglePlaceAction} className="mt-2 flex flex-wrap gap-2">
            <input type="hidden" name="id" value={p.id} />
            <input name="googlePlaceId" required placeholder="Or paste a Google place ID (ChIJ…)" className={`${input} min-w-80`} />
            <button className="rounded border border-zinc-400 px-3 py-1">Use this ID</button>
          </form>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">Venue match</h2>
        {suggestions.length === 0 && !p.venueId && <p className="text-zinc-500">No venue in our list matches this address or name.</p>}
        <ul className="grid gap-2">
          {suggestions.map((m) => (
            <li key={m.venue.id} className="flex flex-wrap items-center gap-3">
              <span>
                {m.venue.name} ({m.venue.address ?? "no address"}) · matched by {[m.byAddress && "address", m.byName && "name"].filter(Boolean).join(" and ")}
              </span>
              {p.venueId === m.venue.id ? (
                <span className="text-green-700 dark:text-green-400">linked</span>
              ) : (
                <form action={linkPlaceVenue}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="venueId" value={m.venue.id} />
                  <button className="rounded border border-zinc-400 px-2 py-0.5 text-sm">Link this venue</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {p.venueId && (
          <form action={linkPlaceVenue} className="mt-2">
            <input type="hidden" name="id" value={p.id} />
            <button className="text-sm underline">Remove venue link</button>
          </form>
        )}
      </section>

    </div>
  );
}
