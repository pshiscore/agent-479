// Copies MapLibre's worker files to public/maplibre/<version>/ so the map's
// worker loads from our own domain (the bundler can't follow MapLibre's
// relative worker URL). Runs before `dev` and `build`; the output is gitignored.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("node_modules/maplibre-gl/package.json", "utf8"));
const out = `public/maplibre/${version}`;
mkdirSync(out, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(`node_modules/maplibre-gl/dist/${f}`, `${out}/${f}`);
