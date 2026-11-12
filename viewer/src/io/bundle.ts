// Reader for .evdb bundles (docs/format.md): header and index once, then one ranged read per event.
// Columns are typed-array views on the decompressed record: no parsing and no copies.

const TYPES = {
  f32: Float32Array, f64: Float64Array, i8: Int8Array, u8: Uint8Array, i16: Int16Array,
  u16: Uint16Array, i32: Int32Array, u32: Uint32Array, i64: BigInt64Array, u64: BigUint64Array,
} as const;
export type TypeCode = keyof typeof TYPES;
export type Column = InstanceType<(typeof TYPES)[TypeCode]>;

/** How layers can be drawn (render/layers.ts `builders`); a bundle may name others, from a newer format. */
export const REPRS = ["cells", "markers", "ellipsoids", "segments", "helix", "cones", "polyline"] as const;
/** A value per row from a column, scaled and clamped (cm per unit; `log`: cm per decade of 1 + |value|). */
export interface Scaled { column: string; scale: number; min?: number; max?: number; log?: boolean }
/** A length to a cylinder around the beam (cm): from the object's start along its direction until it leaves it. */
export interface ToCylinder { to: { r: number; z: number } }
/** A number per row: a constant, a column, or a scaled column. */
export type PerRow = number | string | Scaled;
export type ViewName = "3d" | "front" | "side" | "rz";
/** `cells`: the cell's shape. `tower`: an eta-phi bin seen from the origin, from the front face through `position`
 *  (a cylinder rho = const, or a disc |z| = const) outwards by `depth` cm. `box`: an oriented box or trapezoid around
 *  `position`, axes `u` (width) and `v` (length) as columns, `size` [half width at -v, at +v, half length, half
 *  thickness]. Default: a hexagon in the z plane (half-width `size`). */
export type CellShape =
  | { shape: "hexagon" }
  | { shape: "tower"; face?: "cylinder" | "disc"; dEta?: PerRow; dPhi?: PerRow; depth?: PerRow }
  | { shape: "box"; u: [string, string, string]; v: [string, string, string]; size: [PerRow, PerRow, PerRow, PerRow] };
export interface DisplayLayer {
  table: string;
  repr: (typeof REPRS)[number];
  group: string;
  label: string;
  kind?: string; // object type from the profile (e.g. "trackster"); `group` is then its label
  source?: string; // which reconstruction path produced it, e.g. "SoA" or "legacy"
  /** The part of the detector it belongs to (e.g. "HGCal"): its tab in the side panel, and with a header `domains`
   *  entry of that name, the view that draws it (none: drawn in every domain's view). Truth layers have none. */
  domain?: string;
  position: [string, string, string];
  end?: [string, string, string]; // segments: where the line ends (it starts at `position`); helix: where the path stops
  momentum?: [string, string, string]; // helix: px, py, pz at the start [GeV]
  charge?: string; // helix: charge column [e]; 0 (or none) draws a straight line
  colour?: string | null;
  /** One colour ("#rrggbb") for every row, e.g. each physics kind its own, instead of a scale; takes precedence over
   *  `colourBy: "none"` (an older viewer's fallback) but not over the colour modes' or the user's choices. */
  fixedColour?: string;
  palette?: "heat" | "cool";
  /** Categorical colouring: one colour per object ("row"); one neutral colour ("none", set by a colour mode for a
   *  layer it cannot reach); one colour each for the largest objects ("identity",
   *  the others share one); the colour of the partner across a relation; the colour of the `content` table's object
   *  with the most weight in its hits; or one colour per value of a column (`abs`: of its absolute value; `names`:
   *  legend names per value, as {value: name} or, to keep the order of integer values, [value, name] pairs). */
  colourBy?: "row" | "identity" | "none" | { relation: string } | { content: string }
    | { category: string; abs?: boolean; names?: Record<string, string> | [string | number, string][] };
  stage?: number; // reconstruction step (0, 1, ...) of the replay; the default view shows the last one
  /** `helix`: the replay builds each path along its length, after the hits arrive and before the clustering and the
   *  stages: its first `seed` parts (the `to` objects of relation `parts`, stored in order along the path) light up,
   *  then the path grows out from its start, lighting each part as it reaches it. */
  grow?: { parts: string; seed?: number };
  size?: string | null; // cells: half-width column [cm]; markers: a column whose larger values draw larger discs
  time?: string | null; // column with the arrival time in ns (missing: <= -50), for the replay
  axis?: [string, string, string];
  extent?: [string, string, string];
  /** A minimum on `column`, one slider per `group`; `label`: the slider's name (default: the column). */
  cut?: { group: string; column: string; unit?: string; default?: number; label?: string };
  /** A background layer (e.g. the whole readout): not framed or replayed, drawn thin, picked only when nothing else
   *  is near. */
  context?: boolean;
  dim?: number; // 0..1: how far its colours are mixed towards the background
  /** How to name an object in lists (related objects, tree): these columns, with value names, e.g. pdgId 211 -> "π+". */
  describe?: { columns: string[]; names?: Record<string, Record<string, string>> };
  /** Expression applied as the layer's filter until the user changes it (e.g. "isSignal"). */
  filter?: string;
  /** Set by the converter: a less preferred reconstruction path of a kind that is shown (e.g. legacy next to SoA). */
  alternative?: boolean;
  /** `ellipsoids`: the surface drawn on the ellipsoid: "solid" (default, translucent), "shell" (outline), "cage"
   *  (rings around the principal axes) or "core" (compact and opaque). */
  shape?: "solid" | "shell" | "cage" | "core";
  /** Simulation truth rather than reconstruction: labelled as such, drawn dashed (segments). */
  truth?: boolean;
  /** Truth particles: which of them is "the particle" that colours and groups everything below it (docs/truth.md):
   *  the rows with `bit` set in the integer column `flags` (e.g. truth::LevelFlag 2, generator-level stable). A row
   *  takes the colour of its highest such ancestor, or its own without one. Colours go first to rows with `first`
   *  non-zero (e.g. isSignal), then by size. */
  particle?: { flags: string; bit: number; first?: string };
  /** A reco kind the truth graph says nothing about (docs/truth.md): why (`reason`, for the UI) and the number of the
   *  gap in docs/truth-graph.md. Ignored once the kind has its own reco -> truth relation with a `match` hint.
   *  `derived: "content"`: evd's stand-in may colour it by the particle with the most simulated energy in its parts
   *  (only HGCal layer clusters). */
  truthGap?: { reason: string; gap?: number; derived?: "content" };
  /** Draw only the objects related to the current selection (none without one), until the user chooses all. */
  onSelection?: boolean;
  /** `cells`: the cell's shape (default: hexagon). */
  cell?: CellShape;
  /** `segments`: three columns, the direction of a line of `length` from `position` (instead of `end`); `cones`:
   *  [eta, phi] columns of the axis. */
  direction?: string[];
  /** `segments`, `cones`: the length (cm); `helix`: with `to`, where a path without a finite `end` stops. */
  length?: PerRow | ToCylinder;
  centred?: boolean; // segments with `direction`: `length` split evenly around `position`
  arrow?: boolean; // segments: an arrow head at the end
  width?: number; // segments, helix, polyline: line width in px (default 1)
  /** `polyline`: the path of each row through the rows of a relation's `to` table (their `position` columns, default
   *  x, y, z), in stored order, e.g. a muon track through its hits. */
  points?: { relation: string; position?: [string, string, string] };
  radius?: number | string; // cones: half-opening in eta-phi
  /** The views that draw the layer (default: all). */
  views?: ViewName[];
  visible: boolean;
  /** Object rows under the layer in its side-panel tab (the Physics tab's event summary): the `max` largest by `sort`
   *  (default: the layer's size column) that pass its cut and filter, with these columns. The tab's headline gives
   *  how many pass ("count", default) or, for a one-object table such as MET, the first column's value ("value"). */
  list?: { columns: string[]; sort?: string; max?: number; headline?: "count" | "value" };
  /** The columns the inspector's summary shows first (e.g. pt, eta, phi for a jet, instead of its position). */
  inspect?: string[];
  /** The inspector's energy-fraction bar (reconstruction): columns holding fractions (0..1) of the object's energy,
   *  with their names, e.g. a jet's charged and neutral hadron, photon, electron and muon fractions. */
  fractions?: Record<string, string>;
  /** Label the `labels` leading objects (by the size column) in the view, with their `describe` (key L). */
  labels?: number;
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
  /** `association`: links two kinds of object (e.g. reco <-> truth); selections cross it once, without following the
   *  other side's own relations. `best`: the weight that picks one partner where only one can be shown (colours).
   *  `inverseOf`: the relation points from a part back up to its container, the inverse of the named relation (a
   *  track's vertex, next to the vertex's tracks). `fact`: truth -> hits, the simulated energy per particle and cell
   *  (a simulation fact, not a match; model/facts.ts). */
  relations: Record<string, { from: string; to: string; weights: string[]; association?: boolean; best?: { weight: string; order: "min" | "max" }; inverseOf?: string; match?: Match; fact?: Fact }>;
  display: DisplayLayer[];
  /** How particles move through the detector, for the reconstruction replay: away from a point (default: the
   *  origin, i.e. collisions), along a direction (e.g. [0, -1, 0] for cosmics), or in a fixed random order (hits
   *  without meaningful arrival times, e.g. noise). */
  replay?: { from?: [number, number, number]; direction?: [number, number, number]; order?: "random" };
  /** Camera hints: starting preset; smallest radius (cm) framed around objects, e.g. small for a test-beam stack;
   *  tour style, "beam" (collider: starts on the whole detector, never enters it) or "orbit" (default). */
  view?: { start?: "3d" | "front" | "side" | "rz"; minRadius?: number; tour?: "beam" | "orbit"; domain?: string };
  summaries?: Summary[];
  /** Title of a run from its information (RunEntry.info), e.g. "{Beam} {Energy} GeV"; parts (between " · ") that
   *  name a field the run lacks are left out. */
  runTitle?: string;
  runFields?: string[]; // which run information to show, in this order (default: all)
  presets?: Preset[];
  /** Parts of the detector, each with its region (cm; z is |z|) and the view that suits it: choosing one draws only
   *  its layers and those without a domain, framed on the region. */
  domains?: Domain[];
  /** Solenoid field for `helix` layers: Bz (T), uniform inside the cylinder r < rMax, |z| < zMax (cm), none outside. */
  field?: { bz: number; rMax: number; zMax: number };
  /** Faint outlines of the parts of the detector: cylinders (cm; `z` as a |z| range, drawn at both ends). */
  outlines?: Outline[];
}
/** How a reco <-> truth association measures a match (docs/truth.md), on the relation. On reco -> truth: the truth
 *  level the reco kind reconstructs (`target`), what is shared (`measure`: detector hits, or rechit energy) and where
 *  (`in`), the weight holding the shared amount (`shared`) and the object's own amount as expressions on its table,
 *  the first that can be computed (`over`), so purity = shared / over; `good`: the purity from which a match is clean.
 *  On truth -> reco: `completeness`, the weight giving the share of the particle's amount in the object (or 1 minus
 *  it, `complement`). Vertices are matched to truth vertices (`target` "interaction" or "decayVertex", `measure`
 *  "pt2": the pT² of their tracks), with the purity as a weight (`purity`). */
/** A truth -> hit relation of simulated energy per particle and cell, in detector `in` (model/facts.ts). `unit`: what
 *  one row of the simulation's record covers when it is coarser than a hit, in words: a phrase, or one per value of a
 *  hit column (e.g. {"column": "subdet", "names": {"2": "CSC layer"}}), so a hit says "in this CSC layer". */
export interface Fact { in: string; unit?: string | { column: string; names: Record<string, string> } }
export interface Match {
  measure: "hits" | "energy" | "pt2"; in: string; target?: "trackerHits" | "caloBoundary" | "particle" | "interaction" | "decayVertex";
  shared?: string; over?: string[]; good?: number; completeness?: { weight: string; complement?: boolean };
  /** A weight that already is the purity (constituent-based maps, e.g. a vertex's pT² share), instead of shared / over. */
  purity?: string;
}
export interface Outline { name: string; r: [number, number]; z: [number, number] }
export interface Domain {
  name: string; region: { rMax: number; zMax: number }; view?: "3d" | "front" | "side" | "rz";
  /** Its layers are drawn in every domain's view (e.g. physics objects); seen from another domain, as outlines. */
  shared?: boolean;
  /** A colour mode id: "layers": while this domain is looked at, each layer takes its own colours, also in a bundle
   *  with candidates; "pid" (the default with candidates): particle types. */
  colourMode?: "pid" | "layers";
  /** Smallest radius (cm) framed around its objects (a vertex, a pixel hit), instead of `view.minRadius`. */
  minRadius?: number;
}
/** The unit in a column's documentation, written as "[GeV]". */
export const unitOf = (doc = "") => doc.match(/\[([^\]]+)\]/)?.[1] ?? "";
/** Short name of a layer's kind of object: its group for a layer with a kind ("Tracksters"), else its label. */
export const kindName = (d: DisplayLayer) => (d.kind ? d.group : d.label);

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
  // A file replaced under the same name (a data set converted again) must not be read from the browser's cache of the
  // old one: the probe bypasses the cache, and every read names the version it found (the server ignores the query),
  // so cached ranges of another version are never used, while those of this one still are.
  const probe = await fetch(url, { headers: { Range: "bytes=0-0" }, cache: "no-store" });
  if (!probe.ok) throw new Error(`${url}: HTTP ${probe.status}`);
  if (probe.status === 200) return blobSource(await probe.blob()); // server ignores Range: keep the whole file
  const size = Number(probe.headers.get("Content-Range")?.split("/")[1]);
  const version = probe.headers.get("ETag") ?? probe.headers.get("Last-Modified");
  const at = version ? `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}` : url;
  // Servers (or caches in between) may answer any range request with the whole file (HTTP 200): from then on
  // keep that copy and serve every read from it.
  let whole: Promise<Blob> | null = null;
  return {
    size,
    async read(offset, length) {
      if (!whole) {
        const r = await fetch(at, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
        if (r.status === 206) return r.arrayBuffer();
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        whole = r.blob();
      }
      return (await whole).slice(offset, offset + length).arrayBuffer();
    },
  };
}

const text = (buf: ArrayBuffer) => new TextDecoder().decode(buf);
const inflate = (buf: ArrayBuffer) =>
  new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
// Inflating a PU200 record (~35 MB to ~100 MB) blocks the thread that does it for a few hundred ms: a worker does it,
// so the view keeps responding, also while the next event is read ahead. Without workers (tests), it is done here.
let worker: Worker | null = null, jobs = 0, noWorker = false;
const waiting = new Map<number, { done: (buf: ArrayBuffer) => void; fail: (e: Error) => void }>();
function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof Worker === "undefined" || noWorker) return inflate(buf);
  if (!worker) {
    worker = new Worker(new URL("./gunzip.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<{ id: number; buf?: ArrayBuffer; error?: string }>) => {
      const job = waiting.get(data.id);
      waiting.delete(data.id);
      if (data.buf) job?.done(data.buf);
      else job?.fail(new Error(data.error));
    };
    worker.onerror = () => { // it could not start (e.g. its file is missing): the reads waiting on it fail, later
      for (const job of waiting.values()) job.fail(new Error("the decompression worker failed")); // ones inflate here
      waiting.clear();
      worker?.terminate();
      worker = null;
      noWorker = true;
    };
  }
  const id = jobs++;
  return new Promise((done, fail) => {
    waiting.set(id, { done, fail });
    worker!.postMessage({ id, buf }, [buf]); // moved, not copied: `buf` is empty here afterwards
  });
}

/** The events to keep decoded once event `i` of `n` is shown, coming from event `from`: it and its neighbours; and the
 *  one to read ahead, the next in the direction of travel (forward after a jump; the events wrap around). */
export function around(i: number, from: number, n: number): { keep: number[]; next: number | null } {
  const step = (from - i + n) % n === 1 ? -1 : 1, at = (k: number) => (((i + k) % n) + n) % n;
  return { keep: [...new Set([i, at(step), at(-step)])], next: n > 1 ? at(step) : null };
}

export class Bundle {
  private readonly runTables = new Map<number, Promise<Record<string, Table>>>(); // read once per run
  private readonly decoded = new Map<number, Promise<EventData>>(); // events read, until keep() lets them go
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

  /** Event i, with the per-run tables of its run (if the bundle has any) added to its own. Read once while kept (see
   *  keep); a read that fails is tried again on the next call. */
  event(i: number): Promise<EventData> {
    let ev = this.decoded.get(i);
    if (!ev) {
      const read = (ev = this.read(i));
      this.decoded.set(i, read);
      read.catch(() => { if (this.decoded.get(i) === read) this.decoded.delete(i); });
    }
    return ev;
  }

  /** Keep only these events read: the others are freed once nothing else holds them (a PU200 event is ~100 MB). */
  keep(indices: number[]) {
    for (const i of [...this.decoded.keys()]) if (!indices.includes(i)) this.decoded.delete(i);
  }

  private async read(i: number): Promise<EventData> {
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

function parseRecord(buf: ArrayBuffer, header: Header): EventData {
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
