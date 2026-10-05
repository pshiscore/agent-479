import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin/auth";
import { placeById, publishBlockers, suggestVenues } from "@/lib/admin/places";
import { getDb } from "@/lib/db/client";
import { addressLine, openedLabel, PLACE_KIND_LABELS, PLACE_TYPE_LABELS, targetLabel } from "@/lib/places/format";
import { confirmPlaceSource, editPlace, hidePlaceAction, linkPlaceVenue, publishPlaceAction } from "../../actions";
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
                </span>
              ) : (
                <span className="text-amber-700 dark:text-amber-400">not verified{s.note ? ` (${s.note})` : ""}</span>
              )}
            </li>
          ))}
          {p.sources.length === 0 && <li className="text-zinc-500">No source yet.</li>}
        </ul>
        <form action={confirmPlaceSource} className="mt-3 grid max-w-3xl gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
          <input type="hidden" name="id" value={p.id} />
          <p className="font-semibold">I checked a source in my browser</p>
          <input name="url" type="url" required placeholder="Source URL" defaultValue={p.sources.find((s) => s.verifiedBy !== "owner")?.url ?? ""} className={input} />
          <input name="confirmed" required minLength={3} placeholder="What I saw: name, address, opening date" className={input} />
          <label className="flex items-center gap-2">
            <input type="checkbox" name="openToPublic" value="1" defaultChecked={p.openToPublic === true} /> Open to the public
          </label>
          <div>
            <button className={button}>Record as owner-verified</button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">Publish</h2>
        {live ? (
          <p>
            Public since {when(p.publishedAt)} as {p.status === "open" ? "now open" : "opening soon"}.
          </p>
        ) : blockers.length ? (
          <p className="text-zinc-500">Can&apos;t publish yet: {blockers.join("; ")}.</p>
        ) : (
          <form action={publishPlaceAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="id" value={p.id} />
            <input name="note" placeholder="Note (optional)" className={`${input} min-w-64 flex-1`} />
            <button className={button}>Publish</button>
          </form>
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

      <section>
        <h2 className="mb-2 text-base font-semibold">Edit</h2>
        <PlaceForm
          action={editPlace}
          hidden={{ id: p.id, openToPublicCurrent: String(p.openToPublic) }}
          cities={cities}
          submit="Save changes"
          withSource={false}
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
          }}
        />
      </section>
    </div>
  );
}
