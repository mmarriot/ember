// Reader for .evdb bundles (docs/format.md): header and index once, then one ranged read per event.
// Columns are typed-array views on the decompressed record: no parsing and no copies.

const TYPES = {
  f32: Float32Array, f64: Float64Array, i8: Int8Array, u8: Uint8Array, i16: Int16Array,
  u16: Uint16Array, i32: Int32Array, u32: Uint32Array, i64: BigInt64Array, u64: BigUint64Array,
} as const;
export type TypeCode = keyof typeof TYPES;
export type Column = InstanceType<(typeof TYPES)[TypeCode]>;

export interface DisplayLayer {
  table: string;
  repr: "cells" | "markers" | "ellipsoids" | "segments";
  group: string;
  label: string;
  kind?: string; // object type from the profile (e.g. "trackster"); `group` is then its label
  source?: string; // which reconstruction path produced it, e.g. "SoA" or "legacy"
  position: [string, string, string];
  end?: [string, string, string]; // segments: where the line ends (it starts at `position`)
  colour?: string | null;
  palette?: "heat" | "cool";
  /** Categorical colouring: one colour per object, the colour of the `from` object of a relation that contains it,
   *  or one colour per value of a column (`abs`: of its absolute value; `names`: legend names per value). */
  colourBy?: "row" | { relation: string } | { category: string; abs?: boolean; names?: Record<string, string> };
  stage?: number; // reconstruction step (0, 1, ...) of the replay; the default view shows the last one
  size?: string | null;
  time?: string | null; // column with the arrival time in ns (missing: <= -50), for the replay
  axis?: [string, string, string];
  extent?: [string, string, string];
  cut?: { group: string; column: string; unit?: string; default?: number };
  visible: boolean;
}
export interface Header {
  schema: string;
  source: { files: string[]; created?: string };
  profile: string;
  tables: Record<string, { doc: string; columns: Record<string, { type: TypeCode; doc: string }> }>;
  relations: Record<string, { from: string; to: string; weights: string[] }>;
  display: DisplayLayer[];
  /** How particles move through the detector, for the reconstruction replay: away from a point (default: the
   *  origin, i.e. collisions), or along a direction (e.g. [0, -1, 0] for cosmics). */
  replay?: { from?: [number, number, number]; direction?: [number, number, number] };
}
export interface IndexEntry {
  run: number; lumi: number; event: number; offset: number; length: number; counts: Record<string, number>;
}
export interface Table { n: number; columns: Record<string, Column> }
export interface Relation { offsets: Uint32Array; indices: Uint32Array; weights: Record<string, Float32Array> }
export interface EventData { id: [number, number, number]; tables: Record<string, Table>; relations: Record<string, Relation> }

/** Random access to bytes: an HTTP URL or a Blob (local file, tests). */
export interface Source { size: number; read(offset: number, length: number): Promise<ArrayBuffer> }

export function blobSource(blob: Blob): Source {
  return { size: blob.size, read: (offset, length) => blob.slice(offset, offset + length).arrayBuffer() };
}

export async function httpSource(url: string): Promise<Source> {
  const probe = await fetch(url, { headers: { Range: "bytes=0-0" } });
  if (!probe.ok) throw new Error(`${url}: HTTP ${probe.status}`);
  if (probe.status === 200) return blobSource(await probe.blob()); // server ignores Range: keep the whole file
  const size = Number(probe.headers.get("Content-Range")?.split("/")[1]);
  // Servers (or caches in between) may answer any range request with the whole file (HTTP 200): from then on
  // keep that copy and serve every read from it.
  let whole: Promise<Blob> | null = null;
  return {
    size,
    async read(offset, length) {
      if (!whole) {
        const r = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
        if (r.status === 206) return r.arrayBuffer();
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        whole = r.blob();
      }
      return (await whole).slice(offset, offset + length).arrayBuffer();
    },
  };
}

const text = (buf: ArrayBuffer) => new TextDecoder().decode(buf);
const gunzip = (buf: ArrayBuffer) =>
  new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();

export class Bundle {
  private constructor(readonly header: Header, readonly events: IndexEntry[], private readonly source: Source) {}

  static async open(source: Source): Promise<Bundle> {
    const head = new DataView(await source.read(0, 12));
    if (text(head.buffer.slice(0, 4)) !== "EVDB" || head.getUint32(4, true) !== 1) throw new Error("not an evd/1 bundle");
    const header: Header = JSON.parse(text(await source.read(12, head.getUint32(8, true))));
    const trailer = new DataView(await source.read(source.size - 16, 16));
    if (text(trailer.buffer.slice(12, 16)) !== "EVDB") throw new Error("bundle has no trailer (incomplete?)");
    const index = JSON.parse(text(await source.read(Number(trailer.getBigUint64(0, true)), trailer.getUint32(8, true))));
    return new Bundle(header, index.events, source);
  }

  async event(i: number): Promise<EventData> {
    const entry = this.events[i];
    return parseRecord(await gunzip(await this.source.read(entry.offset, entry.length)), this.header);
  }
}

export function parseRecord(buf: ArrayBuffer, header: Header): EventData {
  const dv = new DataView(buf);
  if (text(buf.slice(0, 4)) !== "EVD1") throw new Error("bad event record");
  const hlen = dv.getUint32(4, true);
  const meta = JSON.parse(text(buf.slice(8, 8 + hlen)));
  const base = 8 + hlen;
  const view = <T extends TypeCode>(type: T, [offset, length]: [number, number]) =>
    new TYPES[type](buf, base + offset, length) as InstanceType<(typeof TYPES)[T]>;

  const tables: Record<string, Table> = {};
  for (const [name, t] of Object.entries<{ n: number; columns: Record<string, [number, number]> }>(meta.tables)) {
    const types = header.tables[name].columns;
    tables[name] = {
      n: t.n,
      columns: Object.fromEntries(Object.entries(t.columns).map(([c, loc]) => [c, view(types[c].type, loc)])),
    };
  }
  const relations: Record<string, Relation> = {};
  for (const [name, r] of Object.entries<any>(meta.relations)) {
    relations[name] = {
      offsets: view("u32", r.offsets),
      indices: view("u32", r.indices),
      weights: Object.fromEntries(Object.entries<[number, number]>(r.weights).map(([w, loc]) => [w, view("f32", loc)])),
    };
  }
  return { id: meta.event, tables, relations };
}
