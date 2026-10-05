import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { getDb } from "@/lib/db/client";
import { formValues } from "@/lib/review/form";
import { eventFormOptions } from "@/lib/review/options";
import { proposalById } from "@/lib/review/proposals";
import { editApproveAction } from "../../actions";
import { button, input, Notice } from "../../ui";
import { EventFields } from "../fields";

/** "Edit and approve": the proposal's facts in the event form; saving approves with the edits (logged). */
export default async function EditApprovePage({ params, searchParams }: PageProps<"/admin/review/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const q = await searchParams;
  const db = getDb();
  const p = /^[0-9a-f-]{36}$/.test(id) ? await proposalById(db, id) : null;
  if (!p) notFound();
  const options = await eventFormOptions(db);
  return (
    <div className="grid gap-6">
      <Notice error={Array.isArray(q.error) ? q.error[0] : q.error} />
      <div>
        <Link href="/admin/review" className="text-sm underline">
          Review
        </Link>
        <h1 className="mt-1 text-lg font-semibold">Edit and approve: {p.facts.title}</h1>
        {p.status !== "pending" && <p className="text-zinc-500">Already {p.status}.</p>}
      </div>
      {p.status === "pending" && (
        <form action={editApproveAction} className="grid max-w-3xl gap-4">
          <input type="hidden" name="id" value={p.id} />
          <EventFields options={options} values={formValues(p.facts)} />
          <label className="grid gap-1">
            <span className="font-semibold">Note (optional)</span>
            <input name="note" className={input} />
          </label>
          <div>
            <button className={button}>Approve with these facts</button>
          </div>
        </form>
      )}
    </div>
  );
}
