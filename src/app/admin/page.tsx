import Link from "next/link";
import { CRON_MAX_DURATION_S, runTiming } from "@/lib/cron-budget";
import { sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin/auth";
import { COMMUNITY_WARN_SHARE, dashboard } from "@/lib/admin/queries";
import { getDb } from "@/lib/db/client";
import { when } from "./ui";

export default async function AdminOverview() {
  await requireAdmin();
  const db = getDb();
  const d = await dashboard(db, new Date());
  // Shadow mode (owner, 2026-10-16): sources in shadow, and automatic demotions in the last 14 days.
  const [{ shadow }] = (await db.execute(sql`select count(*)::int shadow from sources where publish_state = 'shadow'`)) as unknown as { shadow: number }[];
  const demotions = (await db.execute(sql`
    select a.created_at, s.slug, a.reason from agent_actions a join sources s on s.id = a.entity_id
    where a.entity_type = 'source' and a.actor like 'agent:%' and a.reason like 'live → shadow:%' and a.created_at > now() - interval '14 days'
    order by a.created_at desc`)) as unknown as { created_at: string; slug: string; reason: string }[];
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

      {demotions.length > 0 && (
        <section className="rounded border border-red-300 bg-red-50 p-3 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <h2 className="font-semibold">Sources sent back to shadow</h2>
          <ul>
            {demotions.map((x) => (
              <li key={`${x.slug}-${x.created_at}`}>
                {when(x.created_at)} · {x.slug}: {x.reason.replace(/^live → shadow: /, "")}
              </li>
            ))}
          </ul>
        </section>
      )}
      {shadow > 0 && (
        <p>
          <Link href="/admin/review?view=sources" className="underline">
            {shadow} source{shadow === 1 ? "" : "s"} in shadow
          </Link>{" "}
          (their events wait for you in Review, by source)
        </p>
      )}

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
        {d.runs.some((r) => runTiming(r).slow) && (
          <p className="mb-2 text-amber-700 dark:text-amber-400">A run below took more than half the {CRON_MAX_DURATION_S} s function limit. Jobs stop starting new work at 60% and pick up next run.</p>
        )}
        <table className="w-full border-collapse">
          <tbody>
            {d.runs.map((r) => {
              const t = runTiming(r);
              return (
              <tr key={r.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                <td className="py-1 pr-3 whitespace-nowrap">{when(r.startedAt)}</td>
                <td className="py-1 pr-3">{r.job}</td>
                <td className={`py-1 pr-3 ${r.status === "failed" ? "text-red-700 dark:text-red-400" : ""}`}>{r.status}</td>
                <td className={`py-1 pr-3 whitespace-nowrap ${t.slow ? "font-semibold text-amber-700 dark:text-amber-400" : "text-zinc-500"}`}>
                  {t.durationMs === null ? "running" : `${Math.round(t.durationMs / 1000)} s`}
                  {t.slow ? " (over half the limit)" : ""}
                </td>
                <td className="py-1">
                  <Link className="underline" href={`/admin/agent-log?run=${r.id}`}>
                    changes
                  </Link>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
