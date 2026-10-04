import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { COMMUNITY_WARN_SHARE, dashboard } from "@/lib/admin/queries";
import { getDb } from "@/lib/db/client";
import { when } from "./ui";

export default async function AdminOverview() {
  await requireAdmin();
  const d = await dashboard(getDb(), new Date());
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const pendingTotal = d.pending.reduce((n, p) => n + p.n, 0);

  return (
    <div className="grid gap-8">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Upcoming events", d.upcoming],
          ["Waiting for a venue", d.needsVenue.total],
          ["Pending proposals", pendingTotal],
          ["LLM today / 7 days", `$${d.llm.today.toFixed(2)} / $${d.llm.week.toFixed(2)}`],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="text-zinc-500">{label}</div>
            <div className="text-xl font-semibold">{value}</div>
          </div>
        ))}
      </section>

      {pendingTotal > 0 && (
        <p>
          <Link href="/admin/proposals" className="underline">
            {pendingTotal} proposal{pendingTotal === 1 ? "" : "s"} waiting for you
          </Link>{" "}
          ({d.pending.map((p) => `${p.n} ${p.action.replace("propose_", "").replaceAll("_", " ")}`).join(", ")})
        </p>
      )}

      <section>
        <h2 className="mb-2 text-base font-semibold">Community, last 7 days</h2>
        <p className={d.community.warn ? "font-semibold text-red-700 dark:text-red-400" : ""}>
          {d.community.community} of {d.community.classified} classified events ({pct(d.community.share)}) went to Community
          {d.community.warn ? `: above ${pct(COMMUNITY_WARN_SHARE)}, so a category may be missing.` : "."}
        </p>
        {d.community.topThemes.length > 0 && (
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">Top hints: {d.community.topThemes.map(([t, n]) => `${t} (${n})`).join(", ")}</p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">Sources</h2>
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="py-1 pr-3">Source</th>
              <th className="py-1 pr-3">State</th>
              <th className="py-1 pr-3">Last success</th>
              <th className="py-1 pr-3">Failures in a row</th>
              <th className="py-1">Dedup</th>
            </tr>
          </thead>
          <tbody>
            {d.sources.map((s) => (
              <tr key={s.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1 pr-3">{s.name}</td>
                <td className={`py-1 pr-3 ${s.disabledReason === "blocked" ? "font-semibold text-red-700 dark:text-red-400" : ""}`}>
                  {s.enabled ? "enabled" : s.disabledReason}
                </td>
                <td className="py-1 pr-3">{when(s.lastSuccessAt)}</td>
                <td className={`py-1 pr-3 ${s.consecutiveFailures >= d.attentionAt ? "font-semibold text-red-700 dark:text-red-400" : ""}`}>
                  {s.consecutiveFailures}
                  {s.consecutiveFailures >= d.attentionAt ? " (needs attention)" : ""}
                </td>
                <td className="py-1">{s.dedupMode}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.blocked.map((b) => (
          <p key={b.source.id} className="mt-2 text-red-700 dark:text-red-400">
            {b.source.name} was disabled after a block ({when(b.disabledAt)}): {b.reason}. Re-enable only by hand, with your reason.
          </p>
        ))}
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">Waiting for a venue: {d.needsVenue.total}</h2>
        <ul className="list-disc pl-5">
          {d.needsVenue.byKey.slice(0, 10).map((k) => (
            <li key={k.locationKey}>
              {k.locationKey} ({k.records})
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">Duplicate detection</h2>
        {d.dedup.length === 0 ? (
          <p className="text-zinc-500">No pairs checked yet.</p>
        ) : (
          <p>{d.dedup.map((x) => `${x.n} ${x.decision.replace("_", " ")} (${x.mode})`).join(" · ")}</p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">Recent runs</h2>
        <table className="w-full border-collapse">
          <tbody>
            {d.runs.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                <td className="py-1 pr-3 whitespace-nowrap">{when(r.startedAt)}</td>
                <td className="py-1 pr-3">{r.job}</td>
                <td className={`py-1 pr-3 ${r.status === "failed" ? "text-red-700 dark:text-red-400" : ""}`}>{r.status}</td>
                <td className="py-1">
                  <Link className="underline" href={`/admin/agent-log?run=${r.id}`}>
                    changes
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
