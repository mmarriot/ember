// For tests only: small bundles made in memory, well formed or broken on purpose, written as embertools/bundle.py
// writes them (docs/format.md). Each event has a table T (x, y, z; 2 rows) and a relation R from T to T; with
// `runTable`, run 1 has a per-run table C.
import { gzipSync } from "node:zlib";
import { blobSource, type Source } from "./bundle";

const enc = new TextEncoder();

/** `json` padded with spaces so that what follows it starts 8-aligned, when it starts at byte `at`. */
const padded = (json: string, at: number) => enc.encode(json + " ".repeat((8 - ((at + json.length) % 8)) % 8));

/** A record ("EVD1", its JSON length, its JSON, its arrays), compressed as the writer does. */
function record(meta: object, arrays: Uint8Array) {
  const json = padded(JSON.stringify(meta), 8),
    out = new Uint8Array(8 + json.length + arrays.length);
  out.set(enc.encode("EVD1"));
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  out.set(arrays, 8 + json.length);
  return gzipSync(out);
}

export interface TestBundle {
  /** The number of events (default 1). */
  events?: number;
  /** R's offsets and indices in every event (default [0, 1, 2] and [1, 0]: each row of T to the other). */
  offsets?: number[];
  indices?: number[];
  /** Run 1 has a per-run table C. */
  runTable?: boolean;
  /** Changes each event's record JSON (docs/format.md "Record"), e.g. to break it. */
  record?: (meta: Record<string, unknown>) => object;
}

/** A bundle file made in memory. */
export function testBundle({
  events = 1,
  offsets = [0, 1, 2],
  indices = [1, 0],
  runTable = false,
  record: change = (meta) => meta,
}: TestBundle = {}) {
  const f32 = (doc = "") => ({ type: "f32", doc });
  const header = {
    schema: "evd/1",
    profile: "test",
    source: { files: [] },
    tables: {
      T: { doc: "", columns: { x: f32(), y: f32(), z: f32() } },
      ...(runTable ? { C: { doc: "", scope: "run", columns: { a: f32() } } } : {}),
    },
    relations: { R: { from: "T", to: "T", weights: [] } },
    display: [{ table: "T", repr: "markers", group: "g", label: "T", position: ["x", "y", "z"], visible: true }],
  };
  const arrays = new Uint8Array(4 * (6 + offsets.length + indices.length));
  new Float32Array(arrays.buffer, 0, 6).set([1, 2, 3, 4, 5, 6]);
  new Uint32Array(arrays.buffer, 24).set([...offsets, ...indices]);
  const meta = (i: number) =>
    change({
      event: [1, 1, i],
      tables: { T: { n: 2, columns: { x: [0, 2], y: [8, 2], z: [16, 2] } } },
      relations: {
        R: { offsets: [24, offsets.length], indices: [24 + 4 * offsets.length, indices.length], weights: {} },
      },
    });

  const head = padded(JSON.stringify(header), 12),
    start = new Uint8Array(12);
  start.set(enc.encode("EVDB"));
  new DataView(start.buffer).setUint32(4, 1, true);
  new DataView(start.buffer).setUint32(8, head.length, true);
  const parts: Uint8Array[] = [start, head],
    index: { events: object[]; runs: object[] } = { events: [], runs: [] };
  let at = 12 + head.length;
  const add = (r: Uint8Array) => {
    parts.push(r);
    at += r.length;
    return { offset: at - r.length, length: r.length };
  };
  if (runTable)
    index.runs.push({
      run: 1,
      ...add(
        record({ event: [1, 0, 0], tables: { C: { n: 1, columns: { a: [0, 1] } } }, relations: {} }, new Uint8Array(8)),
      ),
    });
  for (let i = 0; i < events; i++)
    index.events.push({ run: 1, lumi: 1, event: i, ...add(record(meta(i), arrays)), counts: { T: 2 } });

  const json = enc.encode(JSON.stringify(index)),
    trailer = new Uint8Array(16);
  new DataView(trailer.buffer).setBigUint64(0, BigInt(at), true);
  new DataView(trailer.buffer).setUint32(8, json.length, true);
  trailer.set(enc.encode("EVDB"), 12);
  return new Blob([...parts, json, trailer]);
}

/** A source of `blob` whose reads can be held back or made to fail: `gate(offset)` is awaited before each read, and
 *  a read it rejects fails. */
export function gatedSource(blob: Blob, gate: (offset: number) => Promise<void>): Source {
  const source = blobSource(blob);
  return {
    size: source.size,
    read: async (offset, length) => {
      await gate(offset);
      return source.read(offset, length);
    },
  };
}
