import { requireAdmin } from "@/lib/admin/auth";
import { proposals } from "@/lib/admin/queries";
import { getDb } from "@/lib/db/client";
import { decide } from "../actions";
import { button, input, Notice, when } from "../ui";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const WHAT_APPROVING_DOES: Record<string, string> = {
  propose_link: "Approving writes this Ticketmaster venue link.",
  propose_venue_match: "Approving pins this venue on the listing; the event is written on the next process run.",
  propose_venue: "Approving records your decision. The venue itself is added through the venue seed and sign-off.",
  propose_category: "Approving records your decision. The category is added in the taxonomy seed.",
};

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

export default async function Proposals({ searchParams }: PageProps<"/admin/proposals">) {
  await requireAdmin();
  const q = await searchParams;
  const { pending, decided } = await proposals(getDb());

  return (
    <div className="grid gap-8">
      <Notice msg={one(q.msg)} error={one(q.error)} />
      <section>
        <h2 className="mb-3 text-base font-semibold">Waiting for you ({pending.length})</h2>
        {pending.length === 0 && <p className="text-zinc-500">Nothing pending.</p>}
        <ol className="grid gap-4">
          {pending.map((p) => (
            <li key={p.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="mb-1">
                <span className="mr-2 font-mono">{p.action}</span>
                <span className="text-zinc-500">{when(p.createdAt)}</span>
              </p>
              <p className="mb-2">{p.reason}</p>
              <dl className="mb-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
                {Object.entries((p.after ?? {}) as Record<string, unknown>).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-mono text-zinc-500">{k}</dt>
                    <dd className="break-words font-mono">{show(v)}</dd>
                  </div>
                ))}
              </dl>
              <p className="mb-2 text-zinc-500">{WHAT_APPROVING_DOES[p.action] ?? ""}</p>
              <form action={decide} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="proposalId" value={p.id} />
                <input name="note" required minLength={3} placeholder="Your note (why)" className={`${input} min-w-64 flex-1`} />
                <button name="decision" value="approved" className={button}>
                  Approve
                </button>
                <button name="decision" value="rejected" className="rounded border border-zinc-400 px-3 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  Reject
                </button>
              </form>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold">Recently decided</h2>
        <table className="w-full border-collapse">
          <tbody>
            {decided.map((p) => (
              <tr key={p.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                <td className="py-1 pr-3 whitespace-nowrap text-zinc-500">{when(p.reviewedAt)}</td>
                <td className="py-1 pr-3 font-mono">{p.action}</td>
                <td className="py-1 pr-3">{p.approvalStatus}</td>
                <td className="py-1">{p.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
