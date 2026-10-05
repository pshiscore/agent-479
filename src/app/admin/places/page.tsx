import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { listPlaces, publishBlockers } from "@/lib/admin/places";
import { getDb } from "@/lib/db/client";
import { addressLine, openedLabel, PLACE_KIND_LABELS, PLACE_TYPE_LABELS, targetLabel } from "@/lib/places/format";
import { button, Notice } from "../ui";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const ORDER = ["draft", "opening_soon", "open", "hidden"] as const;
const HEADINGS: Record<string, string> = { draft: "Drafts (not public)", opening_soon: "Opening soon (public)", open: "Now open (public)", hidden: "Hidden" };

export default async function Places({ searchParams }: PageProps<"/admin/places">) {
  await requireAdmin();
  const q = await searchParams;
  const all = await listPlaces(getDb());
  return (
    <div className="grid gap-8">
      <Notice msg={one(q.msg)} error={one(q.error)} />
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">New in Town: places</h1>
        <Link href="/admin/places/new" className={button}>
          Add a place
        </Link>
      </div>
      {ORDER.map((status) => {
        const rows = all.filter((p) => p.status === status);
        if (rows.length === 0) return null;
        return (
          <section key={status}>
            <h2 className="mb-2 text-base font-semibold">
              {HEADINGS[status]} ({rows.length})
            </h2>
            <ul className="grid gap-2">
              {rows.map((p) => {
                const blockers = status === "draft" ? publishBlockers(p) : [];
                return (
                  <li key={p.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                    <Link href={`/admin/places/${p.id}`} className="font-semibold underline">
                      {p.name}
                    </Link>{" "}
                    <span className="text-zinc-500">
                      {PLACE_TYPE_LABELS[p.placeType]} · {PLACE_KIND_LABELS[p.kind]} · {addressLine(p)}, {p.city}
                    </span>
                    <p className="text-sm">{openedLabel(p) ?? targetLabel(p) ?? <span className="text-red-700 dark:text-red-400">No stated opening date</span>}</p>
                    {blockers.length > 0 && <p className="text-xs text-zinc-500">To publish: {blockers.join("; ")}.</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {all.length === 0 && <p className="text-zinc-500">No places yet.</p>}
    </div>
  );
}
