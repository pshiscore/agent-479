import { formatInChicago } from "@/lib/time";

/** Small shared pieces for the admin pages. Server components only. */

export const when = (d: Date | string | null | undefined) =>
  d ? formatInChicago(new Date(d), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

export function Notice({ msg, error }: { msg?: string; error?: string }) {
  if (error) return <p className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>;
  if (msg) return <p className="mb-4 rounded border border-green-300 bg-green-50 p-3 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">{msg}</p>;
  return null;
}

const show = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s === undefined ? "—" : s.length > 240 ? `${s.slice(0, 240)}…` : s;
};

/** The top-level fields that differ between before and after (or every field of an insert). */
export function Diff({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(
    (k) => !["updatedAt", "lastSeenAt", "_meta"].includes(k) && JSON.stringify(b[k]) !== JSON.stringify(a[k]),
  );
  if (keys.length === 0) return <p className="text-zinc-500">No field changes recorded.</p>;
  return (
    <table className="w-full table-fixed border-collapse text-xs">
      <thead>
        <tr className="text-left text-zinc-500">
          <th className="w-40 py-1 pr-2">Field</th>
          <th className="py-1 pr-2">Before</th>
          <th className="py-1">After</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k} className="border-t border-zinc-100 align-top dark:border-zinc-800">
            <td className="py-1 pr-2 font-mono">{k}</td>
            <td className="break-words py-1 pr-2 font-mono text-red-700 dark:text-red-400">{k in b ? show(b[k]) : "—"}</td>
            <td className="break-words py-1 font-mono text-green-700 dark:text-green-400">{k in a ? show(a[k]) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const input = "rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700";
export const button = "rounded bg-zinc-900 px-3 py-1 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900";
