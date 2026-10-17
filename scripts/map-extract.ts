/**
 * Cuts the venues map's region out of a Protomaps planet build (Phase B;
 * owner, 2026-10-17: the extract is fetched with our bot and logged like any
 * other fetch). Terms: docs/sources-terms.md, "Map tiles".
 *
 * Reads only the header, the directories, and the tile ranges inside our box,
 * as HTTP range requests through botFetch (honest user agent; a block stops),
 * after checking robots.txt, one request at a time with a pause. Nearby ranges
 * are merged so the request count stays small. Writes the archive to
 * map-build/ (gitignored; it goes to our R2 map bucket), a summary to
 * data/map-extract.log.json, and a run record in the database.
 *
 * Usage: MIGRATE_PRODUCTION=yes npm run map:extract -- --build 20261016.pmtiles [--maxzoom 15]
 */
import * as dotenv from "dotenv";
const production = process.env.MIGRATE_PRODUCTION === "yes";
dotenv.config({ path: production ? ".env.production.local" : ".env.local", quiet: true, override: production });

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { getDb } from "@/lib/db/client";
import { botFetch } from "@/lib/http/fetch";
import { type Entry, HEADER_BYTES, lookup, parseDirectory, parseHeader, tileIdsInBox, writeArchive } from "@/lib/map/pmtiles-write";
import { MAP_ATTRIBUTION_HTML, MAP_BOUNDS } from "@/config/map";
import { withRun } from "@/lib/runs";
import { PoliteClient } from "@/lib/sources/http";

const { values: args } = parseArgs({ options: { build: { type: "string" }, maxzoom: { type: "string", default: "15" } } });
const BUILD_HOST = "https://build.protomaps.com/";
const GAP_MS = 1_000;
const MERGE_GAP = 256 * 1024;
const MAX_RUN = 16 * 1024 * 1024;

const log: { offset: number; length: number; status: number }[] = [];
let last = 0;
async function range(url: string, offset: number, length: number): Promise<Uint8Array> {
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const res = await botFetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal: AbortSignal.timeout(120_000) });
  log.push({ offset, length, status: res.status });
  if (res.status !== 206) throw new Error(`expected 206 Partial Content, got ${res.status}`);
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.length !== length) throw new Error(`asked for ${length} bytes, got ${body.length}`);
  return body;
}

/** Merges byte ranges into few requests: close neighbors share one, capped in size. */
function mergeRanges(ranges: { offset: number; length: number }[]) {
  const sorted = [...ranges].sort((a, b) => a.offset - b.offset);
  const runs: { offset: number; end: number }[] = [];
  for (const r of sorted) {
    const cur = runs.at(-1);
    if (cur && r.offset - cur.end <= MERGE_GAP && r.offset + r.length - cur.offset <= MAX_RUN) cur.end = Math.max(cur.end, r.offset + r.length);
    else runs.push({ offset: r.offset, end: r.offset + r.length });
  }
  return runs;
}

async function fetchRanges(url: string, base: number, ranges: { offset: number; length: number }[]) {
  const got = new Map<number, Uint8Array>();
  for (const run of mergeRanges(ranges)) {
    const bytes = await range(url, base + run.offset, run.end - run.offset);
    for (const r of ranges) if (r.offset >= run.offset && r.offset + r.length <= run.end) got.set(r.offset, bytes.slice(r.offset - run.offset, r.offset - run.offset + r.length));
  }
  return got;
}

async function main() {
  if (!args.build || !/^\d{8}\.pmtiles$/.test(args.build)) throw new Error("--build YYYYMMDD.pmtiles (from build-metadata.protomaps.dev/builds.json)");
  const maxZoom = Number(args.maxzoom);
  const url = BUILD_HOST + args.build;
  const http = new PoliteClient({ timeoutMs: 20_000 });
  if (!(await http.allows(url))) throw new Error(`robots.txt disallows ${url}`);
  const db = getDb();
  try {
    const stats = await withRun(db, "manual", async () => {
      // Header and root directory sit in the first 16 KB.
      const first = await range(url, 0, 16_384);
      const h = parseHeader(first);
      const root = parseDirectory(first.slice(h.rootDirectoryOffset, h.rootDirectoryOffset + h.rootDirectoryLength), h.internalCompression);
      const meta = JSON.parse(new TextDecoder().decode(gunzipSync(await range(url, h.jsonMetadataOffset, h.jsonMetadataLength)))) as Record<string, unknown>;

      // Resolve each tile ID through the root and as many leaf levels as needed.
      const ids = tileIdsInBox(MAP_BOUNDS, 0, maxZoom);
      const dirs = new Map<number, Entry[]>();
      const found = new Map<number, Entry>();
      let pending = ids.map((id) => ({ id, dir: root }));
      while (pending.length) {
        const leavesNeeded = new Map<number, Entry>();
        const next: { id: number; dir: Entry[] }[] = [];
        const waiting: { id: number; leaf: number }[] = [];
        for (const p of pending) {
          const e = lookup(p.dir, p.id);
          if (!e) continue;
          if (e.runLength > 0) found.set(p.id, e);
          else if (dirs.has(e.offset)) next.push({ id: p.id, dir: dirs.get(e.offset)! });
          else {
            leavesNeeded.set(e.offset, e);
            waiting.push({ id: p.id, leaf: e.offset });
          }
        }
        if (leavesNeeded.size) {
          const got = await fetchRanges(url, h.leafDirectoryOffset, [...leavesNeeded.values()].map((e) => ({ offset: e.offset, length: e.length })));
          for (const [offset, bytes] of got) dirs.set(offset, parseDirectory(bytes, h.internalCompression));
        }
        for (const w of waiting) next.push({ id: w.id, dir: dirs.get(w.leaf)! });
        pending = next;
      }

      // Tile data, each distinct range once.
      const unique = new Map<number, number>();
      for (const e of found.values()) unique.set(e.offset, e.length);
      const data = await fetchRanges(url, h.tileDataOffset, [...unique.entries()].map(([offset, length]) => ({ offset, length })));
      const tiles = [...found.entries()].map(([tileId, e]) => ({ tileId, contentKey: String(e.offset), data: data.get(e.offset)! }));

      const archive = writeArchive(
        tiles,
        {
          ...meta,
          name: "479 Guide venues map: Benton and Washington counties",
          description: `Regional extract of the Protomaps basemap build ${args.build} (OpenStreetMap data, a Produced Work under the ODbL).`,
          attribution: MAP_ATTRIBUTION_HTML,
        },
        { tileType: h.tileType, tileCompression: h.tileCompression, minZoom: 0, maxZoom, ...MAP_BOUNDS, centerZoom: 10, centerLon: (MAP_BOUNDS.minLon + MAP_BOUNDS.maxLon) / 2, centerLat: (MAP_BOUNDS.minLat + MAP_BOUNDS.maxLat) / 2 },
      );
      const name = `nwa-${args.build}`;
      await mkdir("map-build", { recursive: true });
      await writeFile(`map-build/${name}`, archive);
      const sha256 = createHash("sha256").update(archive).digest("hex");
      const summary = {
        fetchedAt: new Date().toISOString(),
        source: url,
        sourceVersion: meta.version ?? null,
        robots: "allowed",
        requests: log.length,
        bytesRead: log.reduce((n, r) => n + r.length, 0),
        statuses: [...new Set(log.map((r) => r.status))],
        bounds: MAP_BOUNDS,
        maxZoom,
        tiles: tiles.length,
        distinctTiles: unique.size,
        file: `map-build/${name}`,
        bytes: archive.length,
        sha256,
        headerBytes: HEADER_BYTES,
      };
      await writeFile("data/map-extract.log.json", `${JSON.stringify(summary, null, 2)}\n`);
      return summary;
    });
    console.log(stats);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
