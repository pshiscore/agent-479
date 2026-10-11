"use client";

import { useState } from "react";
import { importGoogleLibrary } from "@/components/google-maps-loader";

/**
 * "Find on Google" (admin): Google's free IDs-only text search, run in the
 * owner's browser, lists candidate place IDs, each with a Google Maps link
 * so the owner can see which business it is. Nothing is stored until the
 * owner chooses "This is it". Only the ID is ever kept.
 */

type SearchByText = (req: { textQuery: string; fields: string[]; maxResultCount: number; locationBias: unknown }) => Promise<{ places: { id: string }[] }>;

// Northwest Arkansas, roughly: bias results here.
const NWA = { center: { lat: 36.25, lng: -94.17 }, radius: 50_000 };

export function GoogleMatch({ browserKey, placeId, query, action }: { browserKey: string; placeId: string; query: string; action: (f: FormData) => Promise<void> }) {
  const [state, setState] = useState<{ status: "idle" | "searching" | "done" | "error"; ids: string[]; error?: string }>({ status: "idle", ids: [] });

  async function search() {
    setState({ status: "searching", ids: [] });
    try {
      const places = await importGoogleLibrary(browserKey, "places");
      const Place = places.Place as { searchByText: SearchByText };
      // fields: ["id"] keeps this on the free "Text Search Essentials (IDs Only)" SKU.
      const { places: found } = await Place.searchByText({ textQuery: query, fields: ["id"], maxResultCount: 5, locationBias: NWA });
      setState({ status: "done", ids: found.map((p) => p.id) });
    } catch (err) {
      setState({ status: "error", ids: [], error: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="grid gap-2">
      <div>
        <button type="button" onClick={search} disabled={state.status === "searching"} className="rounded border border-zinc-400 px-3 py-1">
          {state.status === "searching" ? "Searching Google…" : "Find on Google"}
        </button>{" "}
        <span className="text-zinc-500">searches for &quot;{query}&quot;</span>
      </div>
      {state.status === "error" && <p className="text-red-700 dark:text-red-400">Google search failed: {state.error}</p>}
      {state.status === "done" && state.ids.length === 0 && <p className="text-zinc-500">No match on Google. Paste an ID below if you find it in Maps.</p>}
      {state.ids.length > 0 && (
        <ul className="grid gap-1">
          {state.ids.map((gid, i) => (
            <li key={gid} className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-xs">
                {i + 1}. {gid}
              </span>
              <a className="underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}&query_place_id=${encodeURIComponent(gid)}`}>
                Open in Google Maps
              </a>
              <form action={action}>
                <input type="hidden" name="id" value={placeId} />
                <input type="hidden" name="googlePlaceId" value={gid} />
                <button className="rounded border border-zinc-400 px-2 py-0.5 text-sm">This is it</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
