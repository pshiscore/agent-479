/**
 * Copies the map's fonts and icon sprites from Protomaps' basemaps-assets
 * (GitHub Pages) with our bot, so the map loads nothing from third parties
 * (Phase B). Fonts are under the SIL Open Font License and the sprites are
 * MIT; their license files travel with them. Only the glyph ranges for Latin
 * text are copied (labels here are English); a missing range just leaves that
 * character unrendered.
 *
 * Usage: npm run map:assets   (writes map-build/assets/ and data/map-assets.log.json)
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { botFetch, FetchBlockedError } from "@/lib/http/fetch";
import { PoliteClient } from "@/lib/sources/http";

const BASE = "https://protomaps.github.io/basemaps-assets/";
const FONTS = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"];
// Basic Latin, Latin-1, Latin Extended A/B, IPA and spacing marks, combining marks, Cherokee (some
// names here are written in it), Latin Extended Additional, punctuation, letterlike symbols.
const RANGES = [0, 256, 512, 768, 4864, 7680, 8192, 8448];
const FLAVORS = ["light", "dark"];
const LICENSE_NAMES = ["LICENSE", "LICENSE.txt", "LICENSE.md", "OFL.txt", "OFL-1.1.txt"];

const log: { path: string; status: number; bytes: number }[] = [];
let last = 0;
async function get(path: string): Promise<Uint8Array | null> {
  const wait = last + 700 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const res = await botFetch(BASE + path, { signal: AbortSignal.timeout(30_000) });
  const body = res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  log.push({ path, status: res.status, bytes: body?.length ?? 0 });
  return body;
}

async function save(path: string, body: Uint8Array) {
  const out = `map-build/assets/${path}`;
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, body);
}

async function main() {
  const http = new PoliteClient();
  if (!(await http.allows(`${BASE}fonts/`))) throw new Error("robots.txt disallows the assets");
  try {
    let sprites = "";
    for (const v of ["v4", "v3"]) {
      const json = await get(`sprites/${v}/light.json`);
      if (json) {
        sprites = `sprites/${v}`;
        await save(`${sprites}/light.json`, json);
        break;
      }
    }
    if (!sprites) throw new Error("no sprite sheet found under sprites/v4 or sprites/v3");
    for (const flavor of FLAVORS) {
      for (const f of [`${flavor}.json`, `${flavor}.png`, `${flavor}@2x.json`, `${flavor}@2x.png`]) {
        if (log.some((l) => l.path === `${sprites}/${f}`)) continue;
        const body = await get(`${sprites}/${f}`);
        if (!body) throw new Error(`missing ${sprites}/${f}`);
        await save(`${sprites}/${f}`, body);
      }
    }
    for (const font of FONTS) {
      for (const r of RANGES) {
        const path = `fonts/${encodeURIComponent(font)}/${r}-${r + 255}.pbf`;
        const body = await get(path);
        if (body) await save(`fonts/${font}/${r}-${r + 255}.pbf`, body);
      }
    }
    const licenses: string[] = [];
    for (const dir of ["fonts", sprites, "sprites"]) {
      for (const name of LICENSE_NAMES) {
        const body = await get(`${dir}/${name}`);
        if (body) {
          await save(`${dir}/${name}`, body);
          licenses.push(`${dir}/${name}`);
          break;
        }
      }
    }
    const summary = { fetchedAt: new Date().toISOString(), base: BASE, sprites, fonts: FONTS, ranges: RANGES, licenses, requests: log.length, bytes: log.reduce((n, l) => n + l.bytes, 0), log };
    await writeFile("data/map-assets.log.json", `${JSON.stringify(summary, null, 2)}\n`);
    console.log({ ...summary, log: undefined });
  } catch (err) {
    if (err instanceof FetchBlockedError) console.error("BLOCKED: stop; recorded.", err.message);
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
