import { gunzipSync, gzipSync } from "node:zlib";
import { zxyToTileId } from "pmtiles";

/**
 * A small PMTiles v3 reader and writer for the venues map's regional extract
 * (Phase B; owner, 2026-10-17). The pmtiles package reads archives in the
 * browser; this side cuts our area out of a planet build and writes it as one
 * file. Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 * Numbers can exceed 32 bits (offsets in a 139 GB file), so no bitwise math.
 */

export interface Entry {
  tileId: number;
  offset: number;
  length: number;
  // 0 marks a leaf directory; otherwise the number of consecutive tile IDs sharing this content.
  runLength: number;
}

export interface Header {
  rootDirectoryOffset: number;
  rootDirectoryLength: number;
  jsonMetadataOffset: number;
  jsonMetadataLength: number;
  leafDirectoryOffset: number;
  leafDirectoryLength: number;
  tileDataOffset: number;
  tileDataLength: number;
  numAddressedTiles: number;
  numTileEntries: number;
  numTileContents: number;
  clustered: boolean;
  internalCompression: number;
  tileCompression: number;
  tileType: number;
  minZoom: number;
  maxZoom: number;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  centerZoom: number;
  centerLon: number;
  centerLat: number;
}

export const HEADER_BYTES = 127;
const ROOT_MAX = 16_384 - HEADER_BYTES;
const GZIP = 2;

// ---- varints (unsigned, up to 2^53) ----

function writeVarint(out: number[], n: number) {
  while (n >= 128) {
    out.push((n % 128) + 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
}

function readVarint(buf: Uint8Array, pos: { i: number }): number {
  let n = 0;
  let mult = 1;
  for (;;) {
    const b = buf[pos.i++];
    n += (b & 0x7f) * mult;
    if (b < 128) return n;
    mult *= 128;
  }
}

const decompress = (b: Uint8Array, c: number) => (c === GZIP ? new Uint8Array(gunzipSync(b)) : b);

// ---- directories ----

export function parseDirectory(raw: Uint8Array, compression: number): Entry[] {
  const buf = decompress(raw, compression);
  const pos = { i: 0 };
  const n = readVarint(buf, pos);
  const entries: Entry[] = Array.from({ length: n }, () => ({ tileId: 0, offset: 0, length: 0, runLength: 0 }));
  let last = 0;
  for (const e of entries) e.tileId = last += readVarint(buf, pos);
  for (const e of entries) e.runLength = readVarint(buf, pos);
  for (const e of entries) e.length = readVarint(buf, pos);
  entries.forEach((e, i) => {
    const v = readVarint(buf, pos);
    e.offset = v === 0 && i > 0 ? entries[i - 1].offset + entries[i - 1].length : v - 1;
  });
  return entries;
}

export function serializeDirectory(entries: readonly Entry[]): Uint8Array {
  const out: number[] = [];
  writeVarint(out, entries.length);
  let last = 0;
  for (const e of entries) {
    writeVarint(out, e.tileId - last);
    last = e.tileId;
  }
  for (const e of entries) writeVarint(out, e.runLength);
  for (const e of entries) writeVarint(out, e.length);
  entries.forEach((e, i) => writeVarint(out, i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length ? 0 : e.offset + 1));
  return new Uint8Array(gzipSync(Uint8Array.from(out)));
}

/** The entry that holds a tile ID (a tile entry, or a leaf directory to look in), or null. */
export function lookup(entries: readonly Entry[], tileId: number): Entry | null {
  let lo = 0;
  let hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].tileId < tileId) lo = mid + 1;
    else if (entries[mid].tileId > tileId) hi = mid - 1;
    else return entries[mid];
  }
  if (hi < 0) return null;
  const e = entries[hi];
  if (e.runLength === 0) return e;
  return tileId - e.tileId < e.runLength ? e : null;
}

// ---- header ----

const u64 = (v: DataView, at: number) => Number(v.getBigUint64(at, true));

export function parseHeader(b: Uint8Array): Header {
  if (new TextDecoder().decode(b.slice(0, 7)) !== "PMTiles" || b[7] !== 3) throw new Error("not a PMTiles v3 archive");
  const v = new DataView(b.buffer, b.byteOffset, HEADER_BYTES);
  return {
    rootDirectoryOffset: u64(v, 8),
    rootDirectoryLength: u64(v, 16),
    jsonMetadataOffset: u64(v, 24),
    jsonMetadataLength: u64(v, 32),
    leafDirectoryOffset: u64(v, 40),
    leafDirectoryLength: u64(v, 48),
    tileDataOffset: u64(v, 56),
    tileDataLength: u64(v, 64),
    numAddressedTiles: u64(v, 72),
    numTileEntries: u64(v, 80),
    numTileContents: u64(v, 88),
    clustered: v.getUint8(96) === 1,
    internalCompression: v.getUint8(97),
    tileCompression: v.getUint8(98),
    tileType: v.getUint8(99),
    minZoom: v.getUint8(100),
    maxZoom: v.getUint8(101),
    minLon: v.getInt32(102, true) / 1e7,
    minLat: v.getInt32(106, true) / 1e7,
    maxLon: v.getInt32(110, true) / 1e7,
    maxLat: v.getInt32(114, true) / 1e7,
    centerZoom: v.getUint8(118),
    centerLon: v.getInt32(119, true) / 1e7,
    centerLat: v.getInt32(123, true) / 1e7,
  };
}

function headerBytes(h: Header): Uint8Array {
  const b = new Uint8Array(HEADER_BYTES);
  b.set(new TextEncoder().encode("PMTiles"), 0);
  b[7] = 3;
  const v = new DataView(b.buffer);
  const put = (at: number, n: number) => v.setBigUint64(at, BigInt(n), true);
  put(8, h.rootDirectoryOffset);
  put(16, h.rootDirectoryLength);
  put(24, h.jsonMetadataOffset);
  put(32, h.jsonMetadataLength);
  put(40, h.leafDirectoryOffset);
  put(48, h.leafDirectoryLength);
  put(56, h.tileDataOffset);
  put(64, h.tileDataLength);
  put(72, h.numAddressedTiles);
  put(80, h.numTileEntries);
  put(88, h.numTileContents);
  v.setUint8(96, h.clustered ? 1 : 0);
  v.setUint8(97, h.internalCompression);
  v.setUint8(98, h.tileCompression);
  v.setUint8(99, h.tileType);
  v.setUint8(100, h.minZoom);
  v.setUint8(101, h.maxZoom);
  const e7 = (at: number, deg: number) => v.setInt32(at, Math.round(deg * 1e7), true);
  e7(102, h.minLon);
  e7(106, h.minLat);
  e7(110, h.maxLon);
  e7(114, h.maxLat);
  v.setUint8(118, h.centerZoom);
  e7(119, h.centerLon);
  e7(123, h.centerLat);
  return b;
}

// ---- tile ranges ----

const lon2x = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/** Every tile ID covering a box, zooms minZoom..maxZoom, ascending. */
export function tileIdsInBox(box: { minLon: number; minLat: number; maxLon: number; maxLat: number }, minZoom: number, maxZoom: number): number[] {
  const ids: number[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const [x0, x1] = [lon2x(box.minLon, z), lon2x(box.maxLon, z)];
    const [y0, y1] = [lat2y(box.maxLat, z), lat2y(box.minLat, z)];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) ids.push(zxyToTileId(z, x, y));
  }
  return ids.sort((a, b) => a - b);
}

// ---- writing ----

/**
 * Writes an archive from tiles in tile-ID order. Identical contents (same
 * `contentKey`) are stored once, and consecutive IDs sharing a content become
 * one run. Directories go to leaves when the root wouldn't fit the first 16 KB.
 */
export function writeArchive(
  tiles: readonly { tileId: number; contentKey: string; data: Uint8Array }[],
  meta: Record<string, unknown>,
  h: Pick<Header, "tileType" | "tileCompression" | "minZoom" | "maxZoom" | "minLon" | "minLat" | "maxLon" | "maxLat" | "centerZoom" | "centerLon" | "centerLat">,
): Uint8Array {
  const sorted = [...tiles].sort((a, b) => a.tileId - b.tileId);
  const offsets = new Map<string, { offset: number; length: number }>();
  const chunks: Uint8Array[] = [];
  let dataLength = 0;
  const entries: Entry[] = [];
  for (const t of sorted) {
    let at = offsets.get(t.contentKey);
    if (!at) {
      at = { offset: dataLength, length: t.data.length };
      offsets.set(t.contentKey, at);
      chunks.push(t.data);
      dataLength += t.data.length;
    }
    const prev = entries.at(-1);
    if (prev && prev.offset === at.offset && prev.tileId + prev.runLength === t.tileId) prev.runLength++;
    else entries.push({ tileId: t.tileId, offset: at.offset, length: at.length, runLength: 1 });
  }

  let root = serializeDirectory(entries);
  let leaves: Uint8Array = new Uint8Array(0);
  if (root.length > ROOT_MAX) {
    for (let size = 4096; ; size = Math.ceil(size * 1.2)) {
      const parts: Uint8Array[] = [];
      const rootEntries: Entry[] = [];
      let at = 0;
      for (let i = 0; i < entries.length; i += size) {
        const leaf = serializeDirectory(entries.slice(i, i + size));
        rootEntries.push({ tileId: entries[i].tileId, offset: at, length: leaf.length, runLength: 0 });
        parts.push(leaf);
        at += leaf.length;
      }
      root = serializeDirectory(rootEntries);
      if (root.length <= ROOT_MAX) {
        leaves = concat(parts);
        break;
      }
    }
  }
  const metadata = new Uint8Array(gzipSync(Buffer.from(JSON.stringify(meta))));
  const rootOffset = HEADER_BYTES;
  const metaOffset = rootOffset + root.length;
  const leafOffset = metaOffset + metadata.length;
  const dataOffset = leafOffset + leaves.length;
  const header = headerBytes({
    ...h,
    rootDirectoryOffset: rootOffset,
    rootDirectoryLength: root.length,
    jsonMetadataOffset: metaOffset,
    jsonMetadataLength: metadata.length,
    leafDirectoryOffset: leafOffset,
    leafDirectoryLength: leaves.length,
    tileDataOffset: dataOffset,
    tileDataLength: dataLength,
    numAddressedTiles: sorted.length,
    numTileEntries: entries.length,
    numTileContents: offsets.size,
    clustered: true,
    internalCompression: GZIP,
  });
  return concat([header, root, metadata, leaves, ...chunks]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
