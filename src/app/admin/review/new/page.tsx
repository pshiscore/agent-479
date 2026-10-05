import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { getDb } from "@/lib/db/client";
import { eventFormOptions } from "@/lib/review/options";
import { addEventAction } from "../../actions";
import { button, input, Notice } from "../../ui";
import { EventFields } from "../fields";

/** "Add event": an event the owner checked on its official page, for festivals and Facebook-only events. */
export default async function AddEventPage({ searchParams }: PageProps<"/admin/review/new">) {
  await requireAdmin();
  const q = await searchParams;
  const options = await eventFormOptions(getDb());
  return (
    <div className="grid gap-6">
      <Notice error={Array.isArray(q.error) ? q.error[0] : q.error} />
      <div>
        <Link href="/admin/review" className="text-sm underline">
          Review
        </Link>
        <h1 className="mt-1 text-lg font-semibold">Add event</h1>
        <p className="text-zinc-500">From a page you checked in your browser. It&apos;s recorded as owner-verified.</p>
      </div>
      <form action={addEventAction} className="grid max-w-3xl gap-4">
        <EventFields options={options} />
        <label className="grid gap-1">
          <span className="font-semibold">What the page says</span>
          <input name="confirmed" required minLength={3} placeholder="e.g. Oct 15–18, 8 am to 5 pm, free admission" className={input} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button name="intent" value="publish" className={button}>
            Add and publish
          </button>
          <button name="intent" value="review" className="rounded border border-zinc-400 px-3 py-1">
            Save for review
          </button>
        </div>
      </form>
    </div>
  );
}
