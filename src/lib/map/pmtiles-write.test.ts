import { PMTiles, type RangeResponse, type Source, tileIdToZxy } from "pmtiles";
import { describe, expect, it } from "vitest";
import { lookup, parseDirectory, parseHeader, serializeDirectory, tileIdsInBox, writeArchive } from "./pmtiles-write";

const memory = (bytes: Uint8Array): Source => ({
  getKey: () => "memory",
  getBytes: async (offset: number, length: number): Promise<RangeResponse> => ({ data: bytes.slice(offset, offset + length).buffer }),
});

const NWA = { minLon: -94.7, minLat: 35.7, maxLon: -93.75, maxLat: 36.55 };
const head = { tileType: 1, tileCompression: 1, minZoom: 0, maxZoom: 10, ...NWA, centerZoom: 9, centerLon: -94.2, centerLat: 36.2 };

describe("pmtiles writer", () => {
  it("round-trips directories, including big offsets and runs", () => {
    const entries = [
      { tileId: 0, offset: 0, length: 10, runLength: 1 },
      { tileId: 1, offset: 10, length: 20, runLength: 3 },
      { tileId: 9, offset: 140_000_000_000, length: 5, runLength: 1 },
      { tileId: 12, offset: 0, length: 7, runLength: 0 },
    ];
    expect(parseDirectory(serializeDirectory(entries), 2)).toEqual(entries);
    expect(lookup(entries, 2)).toEqual(entries[1]);
    expect(lookup(entries, 5)).toBeNull();
    expect(lookup(entries, 40)).toEqual(entries[3]);
  });

  it("lists every tile in a box, by zoom", () => {
    const ids = tileIdsInBox(NWA, 0, 6);
    expect(ids.slice(0, 1)).toEqual([0]);
    const zooms = ids.map((id) => tileIdToZxy(id)[0]);
    expect(new Set(zooms)).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("writes an archive the official reader can read, with leaves and deduplicated tiles", async () => {
    const ids = tileIdsInBox(NWA, 0, 12);
    // Every third tile is the same "ocean" content, as real archives have.
    const tiles = ids.map((tileId, i) => (i % 3 === 0 ? { tileId, contentKey: "same", data: new Uint8Array([7, 7, 7]) } : { tileId, contentKey: `t${tileId}`, data: new TextEncoder().encode(`tile ${tileId}`) }));
    const bytes = writeArchive(tiles, { name: "test", attribution: "© OpenStreetMap" }, { ...head, maxZoom: 12 });
    const h = parseHeader(bytes);
    expect(h).toMatchObject({ numAddressedTiles: ids.length, clustered: true, maxZoom: 12 });
    expect(h.numTileContents).toBeLessThan(ids.length);

    const reader = new PMTiles(memory(bytes));
    expect((await reader.getHeader()).numAddressedTiles).toBe(ids.length);
    expect(await reader.getMetadata()).toMatchObject({ attribution: "© OpenStreetMap" });
    for (const i of [1, 2, Math.floor(ids.length / 2), ids.length - 1]) {
      const [z, x, y] = tileIdToZxy(ids[i]);
      const got = await reader.getZxy(z, x, y);
      const want = tiles[i].data;
      expect(new Uint8Array(got!.data)).toEqual(want);
    }
    const [z, x, y] = tileIdToZxy(ids[0]);
    expect(new Uint8Array((await reader.getZxy(z, x, y))!.data)).toEqual(new Uint8Array([7, 7, 7]));
  });

  it("moves directories to leaves when the root would pass 16 KB, and still reads every tile", async () => {
    // 60,000 distinct tiles with irregular gaps and sizes (a seeded generator), as real archives have.
    let seed = 42;
    const rand = (n: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) % n) + 1;
    let id = 1_000;
    const tiles = Array.from({ length: 60_000 }, (_, i) => ({ tileId: (id += rand(40) + 1), contentKey: `t${i}`, data: new TextEncoder().encode(`tile ${i} ${"x".repeat(rand(300))}`) }));
    const bytes = writeArchive(tiles, { name: "big" }, { ...head, maxZoom: 15 });
    const h = parseHeader(bytes);
    expect(h.leafDirectoryLength).toBeGreaterThan(0);
    expect(h.rootDirectoryOffset + h.rootDirectoryLength).toBeLessThanOrEqual(16_384);
    const reader = new PMTiles(memory(bytes));
    for (const i of [0, 12_345, 59_999]) {
      const [z, x, y] = tileIdToZxy(tiles[i].tileId);
      expect(new TextDecoder().decode((await reader.getZxy(z, x, y))!.data)).toBe(new TextDecoder().decode(tiles[i].data));
    }
  });
});
