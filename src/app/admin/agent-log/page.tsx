import Link from "next/link";
import { revertible } from "@/lib/actions/rollback";
import { requireAdmin } from "@/lib/admin/auth";
import { agentLog } from "@/lib/admin/queries";
import { getDb } from "@/lib/db/client";
import { rollback } from "../actions";
import { button, Diff, input, Notice, when } from "../ui";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f-]{36}$/i;

export default async function AgentLog({ searchParams }: PageProps<"/admin/agent-log">) {
  await requireAdmin();
  const q = await searchParams;
  const page = Math.max(0, Number(one(q.page)) || 0);
  const filters = {
    action: one(q.action) || undefined,
    entityType: one(q.entity) || undefined,
    runId: UUID.test(one(q.run) ?? "") ? one(q.run) : undefined,
    entityId: UUID.test(one(q.id) ?? "") ? one(q.id) : undefined,
  };
  const { rows, hasMore, facets } = await agentLog(getDb(), { page, ...filters });
  const link = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const all = { action: filters.action, entity: filters.entityType, run: filters.runId, id: filters.entityId, ...over };
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/agent-log${s ? `?${s}` : ""}`;
  };
  const actions = [...new Set(facets.map((f) => f.action))].sort();
  const entities = [...new Set(facets.map((f) => f.entityType))].sort();
  const returnTo = link({ page: page ? String(page) : undefined });

  return (
    <div>
      <Notice msg={one(q.msg)} error={one(q.error)} />
      <form className="mb-4 flex flex-wrap items-end gap-3" action="/admin/agent-log">
        <label className="grid gap-1">
          Action
          <select name="action" defaultValue={filters.action ?? ""} className={input}>
            <option value="">all</option>
            {actions.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          Entity
          <select name="entity" defaultValue={filters.entityType ?? ""} className={input}>
            <option value="">all</option>
            {entities.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </label>
        {filters.runId && <input type="hidden" name="run" value={filters.runId} />}
        {filters.entityId && <input type="hidden" name="id" value={filters.entityId} />}
        <button className={button}>Filter</button>
        {(filters.runId || filters.entityId || filters.action || filters.entityType) && (
          <Link href="/admin/agent-log" className="underline">
            clear
          </Link>
        )}
      </form>
      {filters.runId && <p className="mb-2 text-zinc-500">Run {filters.runId}</p>}

      <ol className="grid gap-2">
        {rows.map((a) => {
          const can = revertible(a);
          return (
            <li key={a.id} className="rounded border border-zinc-200 dark:border-zinc-800">
              <details>
                <summary className="cursor-pointer list-none p-2">
                  <span className="mr-2 whitespace-nowrap text-zinc-500">{when(a.createdAt)}</span>
                  <span className="mr-2 font-mono">{a.action}</span>
                  <span className="mr-2 text-zinc-500">{a.entityType}</span>
                  {a.approvalStatus && <span className="mr-2 rounded bg-zinc-100 px-1 dark:bg-zinc-800">{a.approvalStatus}</span>}
                  {a.revertedByActionId && <span className="mr-2 rounded bg-amber-100 px-1 text-amber-900 dark:bg-amber-900 dark:text-amber-100">rolled back</span>}
                  <span>{a.reason}</span>
                </summary>
                <div className="grid gap-3 border-t border-zinc-100 p-3 dark:border-zinc-800">
                  <p className="text-zinc-500">
                    {a.actor}
                    {a.model ? ` · ${a.model}` : ""}
                    {a.confidence != null ? ` · confidence ${a.confidence}` : ""}
                    {a.runId ? (
                      <>
                        {" · "}
                        <Link className="underline" href={link({ run: a.runId, page: undefined })}>
                          this run
                        </Link>
                      </>
                    ) : null}
                    {a.entityId ? (
                      <>
                        {" · "}
                        <Link className="underline" href={link({ id: a.entityId, page: undefined })}>
                          this {a.entityType}&apos;s history
                        </Link>
                      </>
                    ) : null}
                  </p>
                  <Diff before={a.before} after={a.after} />
                  {can.ok ? (
                    <form action={rollback} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="actionId" value={a.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <input name="reason" required minLength={5} placeholder="Why roll this back?" className={`${input} min-w-64 flex-1`} />
                      <button className={button}>{can.label}</button>
                    </form>
                  ) : (
                    <p className="text-zinc-500">Can&apos;t roll back: {can.why}.</p>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ol>
      {rows.length === 0 && <p className="text-zinc-500">Nothing logged with these filters.</p>}

      <nav className="mt-4 flex gap-4">
        {page > 0 && (
          <Link className="underline" href={link({ page: String(page - 1) })}>
            Newer
          </Link>
        )}
        {hasMore && (
          <Link className="underline" href={link({ page: String(page + 1) })}>
            Older
          </Link>
        )}
      </nav>
    </div>
  );
}
