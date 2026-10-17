import { requireAdmin } from "@/lib/admin/auth";
import { getDb } from "@/lib/db/client";
import { oneClick, proposedDiscoveries, recentDecisions } from "@/lib/discovery/store";
import { approveDiscoveryAction, rejectDiscoveryAction } from "../actions";
import { button, input, Notice, when } from "../ui";

/**
 * Feed discoveries (docs/product/organizers.md, step 6): feeds the agent
 * found on organizers' own sites. Approving creates a disabled, untested
 * source; the test fetch and shadow review follow. The terms decision is the
 * owner's: public .gov feeds with no flagged terms are one click, everything
 * else needs a note saying why the terms are fine.
 */

const KIND_LABELS: Record<string, string> = { ics: "iCal feed", rss: "RSS feed", events_api: "Events API", page_data: "Event data on a page", html: "Web page" };

export default async function DiscoveriesPage({ searchParams }: PageProps<"/admin/discoveries">) {
  await requireAdmin();
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const db = getDb();
  const waiting = await proposedDiscoveries(db);
  const decided = await recentDecisions(db, 15);
  const byOrg = new Map<string, typeof waiting>();
  for (const w of waiting) byOrg.set(w.orgName, [...(byOrg.get(w.orgName) ?? []), w]);

  return (
    <div className="grid gap-6">
      <Notice msg={one(q.msg)} error={one(q.error)} />
      <div>
        <h1 className="text-lg font-semibold">Feed discoveries</h1>
        <p className="text-zinc-500">
          {waiting.length} waiting from {byOrg.size} organizers. Approving creates a source that stays off until its test fetch passes, then starts in
          shadow (nothing publishes until you approve its events or promote it).
        </p>
      </div>

      {[...byOrg.entries()].map(([orgName, items]) => (
        <section key={orgName} className="grid gap-3">
          <h2 className="text-base font-semibold">{orgName}</h2>
          {items.map(({ d }) => {
            const quick = oneClick(d);
            const blocked = d.robotsResult === "disallowed";
            return (
              <article key={d.id} className="grid gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold">{d.label ?? KIND_LABELS[d.kind]}</span>
                  <span className="text-zinc-500">
                    {KIND_LABELS[d.kind]}
                    {d.platform ? ` · ${d.platform.replaceAll("_", " ")}` : ""}
                  </span>
                </div>
                <a href={d.url} className="break-all font-mono text-xs underline" rel="noopener" target="_blank">
                  {d.url}
                </a>
                <p>
                  robots.txt:{" "}
                  <strong className={blocked ? "text-red-700 dark:text-red-400" : ""}>{blocked ? "disallows this address" : "allows"}</strong> (checked {when(d.robotsCheckedAt)}) · Terms:{" "}
                  {d.termsUrl ? (
                    <>
                      <a href={d.termsUrl} className="underline" rel="noopener" target="_blank">
                        terms page
                      </a>
                      {d.termsFlags.length ? <strong className="text-amber-700 dark:text-amber-400"> flagged: {d.termsFlags.join(", ")}</strong> : " (nothing flagged)"}
                    </>
                  ) : (
                    "no terms page found"
                  )}
                </p>
                {d.notes && <p className="text-zinc-500">{d.notes}</p>}
                {d.sampleEvents.length > 0 && (
                  <ul className="grid gap-0.5 text-xs">
                    {d.sampleEvents.map((s, i) => (
                      <li key={i}>
                        <span className="text-zinc-500">{s.startAt}</span> · {s.title}
                        {s.location ? <span className="text-zinc-500"> · {s.location}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
                {d.suggestedFilters.length > 0 && <p className="text-xs">Suggested filters once it&rsquo;s a source: {d.suggestedFilters.map((f) => `"${f}"`).join(", ")}</p>}
                <div className="flex flex-wrap gap-3">
                  {!blocked && (
                    <form action={approveDiscoveryAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="discoveryId" value={d.id} />
                      {!quick && <input name="note" required minLength={3} placeholder="Why the terms are fine" className={`${input} w-full min-w-0 sm:w-72`} />}
                      <button className={button}>{quick ? "Approve (public .gov feed)" : "Approve"}</button>
                    </form>
                  )}
                  <form action={rejectDiscoveryAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="discoveryId" value={d.id} />
                    <input name="note" required minLength={3} placeholder="Why not" className={`${input} w-full min-w-0 sm:w-56`} />
                    <button className="underline">Reject</button>
                  </form>
                </div>
              </article>
            );
          })}
        </section>
      ))}

      {decided.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-base font-semibold">Recent decisions</h2>
          <ul className="grid gap-1">
            {decided.map(({ d, orgName, sourceSlug }) => (
              <li key={d.id}>
                <strong>{d.status}</strong> {when(d.decidedAt)} · {orgName}: {d.label ?? d.url}
                {sourceSlug ? <span className="font-mono text-xs"> → {sourceSlug}</span> : null}
                {d.decisionNote ? <span className="text-zinc-500"> · {d.decisionNote}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
