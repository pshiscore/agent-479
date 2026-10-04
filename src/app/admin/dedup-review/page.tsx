import { DEDUP_THRESHOLDS } from "@/config/dedup";
import { requireAdmin } from "@/lib/admin/auth";
import { type FrozenFacts, labeledPairs, reviewQueue, suggestedThresholds } from "@/lib/admin/dedup-review";
import { getDb } from "@/lib/db/client";
import { formatInChicago } from "@/lib/time";
import { labelDedupPair } from "../actions";
import { button, input, Notice, when } from "../ui";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const at = (f: FrozenFacts) =>
  f.allDay || f.timeTba
    ? `${formatInChicago(new Date(f.startAt), { weekday: "short", month: "short", day: "numeric" })}${f.timeTba ? " (time TBA)" : " (all day)"}`
    : formatInChicago(new Date(f.startAt), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Side({ f }: { f: FrozenFacts }) {
  return (
    <div className="grid gap-1">
      <p className="font-semibold">{f.title}</p>
      <p>{at(f)}</p>
      <p>
        {f.subSpace ? `${f.subSpace}, ` : ""}
        {f.venue}, {f.city}
      </p>
      <p className="text-zinc-500">
        {f.source}
        {f.sourceUrl ? (
          <>
            {" · "}
            <a className="underline" href={f.sourceUrl} target="_blank" rel="noreferrer">
              listing
            </a>
          </>
        ) : null}
      </p>
    </div>
  );
}

export default async function DedupReview({ searchParams }: PageProps<"/admin/dedup-review">) {
  await requireAdmin();
  const q = await searchParams;
  const db = getDb();
  const [queue, labeled, suggested] = [await reviewQueue(db, 30), await labeledPairs(db), await suggestedThresholds(db)];

  return (
    <div className="grid gap-8">
      <Notice msg={one(q.msg)} error={one(q.error)} />
      <section>
        <h2 className="mb-2 text-base font-semibold">Thresholds</h2>
        <p>
          Configured: merge at {DEDUP_THRESHOLDS.tMerge}, ask the model from {DEDUP_THRESHOLDS.tLlm} ({DEDUP_THRESHOLDS.basis}). From your {suggested.counts.labels}{" "}
          label{suggested.counts.labels === 1 ? "" : "s"} ({suggested.counts.same} same, {suggested.counts.different} different): merge at {suggested.tMerge}, ask
          from {suggested.tLlm}.
        </p>
        <p className="text-zinc-500">
          Merge: {suggested.reasons.tMerge}. Ask: {suggested.reasons.tLlm}.
        </p>
        {suggested.warnings.map((w) => (
          <p key={w} className="text-red-700 dark:text-red-400">
            {w}
          </p>
        ))}
      </section>

      <section>
        <h2 className="mb-1 text-base font-semibold">Label these ({queue.length})</h2>
        <p className="mb-3 text-zinc-500">
          Same means one occurrence listed twice. Different means two separate events, even if they share a title. One pair per pair of titles; the nearest to a
          threshold first.
        </p>
        <ol className="grid gap-4">
          {queue.map((item) => (
            <li key={item.candidateId} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="mb-3 grid gap-4 sm:grid-cols-2">
                <Side f={item.a} />
                <Side f={item.b} />
              </div>
              <p className="mb-2 text-xs text-zinc-500">
                Title score {item.scores.score} (trigram {item.scores.trigram}, words {item.scores.tokenSet}), {item.scores.startDiffMinutes} min apart
                {item.scores.subSpaceDiffers ? ", different rooms" : ""}. The engine said {item.decision.replace("_", " ")}
                {item.confidence != null ? ` (model confidence ${item.confidence})` : ""}.
                {item.sameTitlePairs > 1 ? ` ${item.sameTitlePairs} pairs share these titles.` : ""}
              </p>
              <form action={labelDedupPair} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="candidateId" value={item.candidateId} />
                <input name="note" placeholder="Note (optional)" className={`${input} min-w-48 flex-1`} />
                <button name="label" value="same" className={button}>
                  Same
                </button>
                <button name="label" value="different" className="rounded border border-zinc-400 px-3 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  Different
                </button>
              </form>
            </li>
          ))}
        </ol>
        {queue.length === 0 && <p className="text-zinc-500">Nothing left to label.</p>}
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">Labeled ({labeled.length})</h2>
        <table className="w-full border-collapse">
          <tbody>
            {labeled.map((l, i) => {
              const a = l.factsA as FrozenFacts;
              const b = l.factsB as FrozenFacts;
              return (
                <tr key={i} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                  <td className="py-1 pr-3 whitespace-nowrap text-zinc-500">{when(l.labeledAt)}</td>
                  <td className="py-1 pr-3">{l.label}</td>
                  <td className="py-1 pr-3">{l.scores.score}</td>
                  <td className="py-1">
                    {a.title} / {b.title}
                    {l.note ? <span className="text-zinc-500"> · {l.note}</span> : null}
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
