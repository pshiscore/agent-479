import { sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin/auth";
import { getDb } from "@/lib/db/client";
import { addPlace } from "../../actions";
import { Notice } from "../../ui";
import { PlaceForm } from "../form";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function NewPlace({ searchParams }: PageProps<"/admin/places/new">) {
  await requireAdmin();
  const q = await searchParams;
  const cities = ((await getDb().execute(sql`select distinct city from venues where active order by 1`)) as unknown as { city: string }[]).map((r) => r.city);
  return (
    <div className="grid gap-4">
      <Notice error={one(q.error)} />
      <h1 className="text-lg font-semibold">Add a place</h1>
      <p className="text-zinc-500">Saved as a draft: nothing is public until you publish it. Your entry is recorded as owner-verified.</p>
      <PlaceForm action={addPlace} cities={cities} submit="Save draft" withSource />
    </div>
  );
}
