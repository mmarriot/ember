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
  /** A background layer (e.g. the whole readout): not framed or replayed, drawn thin, picked only when nothing else
   *  is near. */
  context?: boolean;
  dim?: number; // 0..1: how far its colours are mixed towards the background
  visible: boolean;
}
/** A per-event chart: `table` rows grouped by the integer column `groupBy`, counted or summed over `value`. */
/** `where`: an expression (as for filters) choosing the rows that count, e.g. "time > 0". */
export interface Summary { title: string; table: string; groupBy: string; value?: string; op: "sum" | "count" | "mean"; unit?: string; where?: string }
/** A named way of looking at the data: colour columns per table and row filters (expressions) per table. */
export interface Preset { name: string; colour?: Record<string, string>; filters?: Record<string, string> }
export type RunInfo = Record<string, string | number | boolean>;
export interface Header {
  schema: string;
  source: { files: string[]; created?: string };
  profile: string;
  /** `scope: "run"`: written once per run (see RunEntry) and added to every event of that run. */
  tables: Record<string, { doc: string; scope?: "run"; columns: Record<string, { type: TypeCode; doc: string }> }>;
  relations: Record<string, { from: string; to: string; weights: string[] }>;
  display: DisplayLayer[];
  /** How particles move through the detector, for the reconstruction replay: away from a point (default: the
   *  origin, i.e. collisions), along a direction (e.g. [0, -1, 0] for cosmics), or in a fixed random order (hits
   *  without meaningful arrival times, e.g. noise). */
  replay?: { from?: [number, number, number]; direction?: [number, number, number]; order?: "random" };
  /** Starting camera preset, and the smallest radius (cm) the camera frames, e.g. small for a test-beam setup. */
  view?: { start?: "3d" | "front" | "side" | "rz"; minRadius?: number };
  summaries?: Summary[];
  /** Title of a run from its information (RunEntry.info), e.g. "{Beam} {Energy} GeV"; parts (between " · ") that
   *  name a field the run lacks are left out. */
  runTitle?: string;
  runFields?: string[]; // which run information to show, in this order (default: all)
  presets?: Preset[];
}
export interface IndexEntry {
  run: number; lumi: number; event: number; offset: number; length: number; counts: Record<string, number>;
}
/** A run of the bundle: where its per-run tables are (if it has any), and what is known about it. */
export interface RunEntry { run: number; offset?: number; length?: number; counts?: Record<string, number>; info?: RunInfo }
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
  private readonly runTables = new Map<number, Promise<Record<string, Table>>>(); // read once per run
  private constructor(readonly header: Header, readonly events: IndexEntry[], readonly runs: RunEntry[], private readonly source: Source) {}

  static async open(source: Source): Promise<Bundle> {
    const head = new DataView(await source.read(0, 12));
    if (text(head.buffer.slice(0, 4)) !== "EVDB" || head.getUint32(4, true) !== 1) throw new Error("not an evd/1 bundle");
    const header: Header = JSON.parse(text(await source.read(12, head.getUint32(8, true))));
    const trailer = new DataView(await source.read(source.size - 16, 16));
    if (text(trailer.buffer.slice(12, 16)) !== "EVDB") throw new Error("bundle has no trailer (incomplete?)");
    const index = JSON.parse(text(await source.read(Number(trailer.getBigUint64(0, true)), trailer.getUint32(8, true))));
    return new Bundle(header, index.events, index.runs ?? [], source);
  }

  /** Event i, with the per-run tables of its run (if the bundle has any) added to its own. */
  async event(i: number): Promise<EventData> {
    const entry = this.events[i];
    const [ev, perRun] = await Promise.all([this.record(entry), this.run(entry.run)]);
    ev.tables = { ...perRun, ...ev.tables };
    return ev;
  }

  private run(run: number): Promise<Record<string, Table>> {
    const entry = this.runs.find((r) => r.run === run);
    if (entry?.offset === undefined || entry.length === undefined) return Promise.resolve({});
    if (!this.runTables.has(run)) this.runTables.set(run, this.record({ offset: entry.offset, length: entry.length }).then((r) => r.tables));
    return this.runTables.get(run)!;
  }

  /** What is known about a run (type, setup, beam, ...), or {}. */
  runInfo(run: number): RunInfo {
    return this.runs.find((r) => r.run === run)?.info ?? {};
  }

  /** The profile's run title filled in for `run`: parts naming a field the run lacks are dropped. */
  runTitle(run: number): string {
    const info = this.runInfo(run), template = this.header.runTitle;
    if (!template) return "";
    return template.split(" · ")
      .filter((part) => [...part.matchAll(/\{(\w+)\}/g)].every(([, k]) => info[k] !== undefined && info[k] !== ""))
      .map((part) => part.replace(/\{(\w+)\}/g, (_, k) => String(info[k])))
      .join(" · ");
  }

  private async record(entry: { offset: number; length: number }) {
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
