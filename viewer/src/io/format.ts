// The bundle format's types: the header, the index of events, and an event as the reader hands it over (tables of
// typed-array columns, relations in CSR form). Each field is described in docs/format.md; io/bundle.ts reads the bytes.

/** The column types a header can name, and the typed array each is read into. */
export const COLUMN_TYPES = {
  f32: Float32Array,
  f64: Float64Array,
  i8: Int8Array,
  u8: Uint8Array,
  i16: Int16Array,
  u16: Uint16Array,
  i32: Int32Array,
  u32: Uint32Array,
  i64: BigInt64Array,
  u64: BigUint64Array,
} as const;
export type TypeCode = keyof typeof COLUMN_TYPES;
export type Column = InstanceType<(typeof COLUMN_TYPES)[TypeCode]>;

/** What the bundle holds and how to draw it, the same for every event (docs/format.md "Header JSON"). */
export interface Header {
  schema: string;
  source: { files: string[]; created?: string; converter?: string; cmssw?: string; data_time?: string };
  profile: string;
  /** `scope: "run"`: written once per run (see RunEntry) and added to every event of that run. */
  tables: Record<string, { doc: string; scope?: "run"; columns: Record<string, { type: TypeCode; doc: string }> }>;
  relations: Record<string, RelationInfo>;
  display: DisplayLayer[];
  /** How particles move through the detector, for the replay: from a point (default: the origin), along a direction
   *  (cosmics), or in a fixed random order (hits without meaningful times). */
  replay?: { from?: [number, number, number]; direction?: [number, number, number]; order?: "random" };
  view?: { start?: ViewName; minRadius?: number; tour?: "beam" | "orbit"; domain?: string; colourRoot?: string };
  summaries?: Summary[];
  /** A run's title from its information (RunEntry.info), e.g. "{Beam} {Energy} GeV". */
  runTitle?: string;
  runFields?: string[]; // which run information to show, in this order (default: all)
  presets?: Preset[];
  domains?: Domain[];
  /** Solenoid field for `helix` layers: Bz (T), uniform for r < rMax, |z| < zMax (cm). */
  field?: { bz: number; rMax: number; zMax: number };
  outlines?: Outline[];
}

/** A relation's hints (docs/format.md "Relations"). `association`: links two kinds of object (reco <-> truth), crossed
 *  once. `best`: the weight that picks one partner. `inverseOf`: points from a part back up to its container. */
export interface RelationInfo {
  from: string;
  to: string;
  weights: string[];
  association?: boolean;
  best?: { weight: string; order: "min" | "max" };
  inverseOf?: string;
  match?: Match;
  fact?: Fact;
}

/** How a reco <-> truth association measures a match (docs/truth.md "Each kind's contract"). On reco -> truth:
 *  purity = `shared` / `over` (the first expression that can be computed on the object's table), clean from `good`.
 *  On truth -> reco: `completeness`, a weight (or 1 minus it, `complement`). */
export interface Match {
  measure: "hits" | "energy" | "pt2";
  in: string;
  target?: "trackerHits" | "caloBoundary" | "particle" | "interaction" | "decayVertex";
  shared?: string;
  over?: string[];
  good?: number;
  completeness?: { weight: string; complement?: boolean };
  /** A weight that already is the purity (a vertex's pT² share), instead of shared / over. */
  purity?: string;
}
/** A truth -> hit relation of simulated energy per particle and cell, in detector `in` (truth/facts.ts). `unit`: what
 *  one record row covers when coarser than a hit, as a phrase or per value of a hit column ("CSC layer"). */
export interface Fact {
  in: string;
  unit?: string | { column: string; names: Record<string, string> };
}

/** How layers can be drawn (render/layers); a newer bundle may name others. */
export const REPRS = ["cells", "markers", "ellipsoids", "segments", "helix", "cones", "polyline"] as const;
/** `cells`: the cell's shape (docs/format.md "Display hints"); default a hexagon in the z plane. `box` `size`: [half
 *  width at -v, at +v, half length, half thickness]. */
export type CellShape =
  | { shape: "hexagon" }
  | { shape: "tower"; face?: "cylinder" | "disc"; dEta?: PerRow; dPhi?: PerRow; depth?: PerRow }
  | { shape: "box"; u: [string, string, string]; v: [string, string, string]; size: [PerRow, PerRow, PerRow, PerRow] };
/** How to draw one table as one layer (docs/format.md "Display hints", where every field is described). */
export interface DisplayLayer {
  table: string;
  repr: (typeof REPRS)[number];
  group: string;
  label: string;
  kind?: string; // object type from the profile (e.g. "trackster"); `group` is then its label
  doc?: string;
  source?: string; // which reconstruction path produced it, e.g. "SoA" or "legacy"
  domain?: string; // the part of the detector it belongs to (none: drawn in every domain's view)
  position: [string, string, string];
  end?: [string, string, string]; // segments: where the line ends (it starts at `position`); helix: where the path stops
  momentum?: [string, string, string]; // helix: px, py, pz at the start [GeV]
  charge?: string; // helix: charge column [e]; 0 (or none) draws a straight line
  colour?: string | null;
  fixedColour?: string; // "#rrggbb" for every row
  palette?: "heat" | "cool";
  /** Categorical colouring (docs/format.md "`colourBy` values"). */
  colourBy?:
    | "row"
    | "identity"
    | "none"
    | { relation: string }
    | { content: string }
    | { category: string; abs?: boolean; names?: Record<string, string> | [string | number, string][] };
  stage?: number; // reconstruction step (0, 1, ...) of the replay
  grow?: { parts: string; seed?: number }; // helix: the replay builds each path from its parts
  size?: string | null; // cells: half-width column [cm]; markers: a column whose larger values draw larger discs
  time?: string | null; // column with the arrival time in ns (missing: <= -50), for the replay
  axis?: [string, string, string];
  extent?: [string, string, string];
  /** A minimum on `column`, one slider per `group`. */
  cut?: { group: string; column: string; unit?: string; default?: number; label?: string };
  context?: boolean; // a background layer (the whole readout): not framed or replayed, drawn thin
  dim?: number; // 0..1: how far its colours are mixed towards the background
  /** How to name an object: these columns' values, by `names` (pdgId 211 -> "π+"), else after their `prefix`. */
  describe?: {
    columns: string[];
    names?: Record<string, Record<string, string>>;
    prefix?: Record<string, string>;
  };
  filter?: string; // the layer's filter until the user changes it (e.g. "isSignal")
  shape?: "solid" | "shell" | "cage" | "core"; // ellipsoids: the surface drawn
  truth?: boolean; // simulation truth rather than reconstruction
  /** Truth particles: the level that is "the particle" (docs/truth.md): rows with `bit` set in the column `flags`;
   *  colours go first to rows with `first` non-zero (isSignal). */
  particle?: { flags: string; bit: number; first?: string };
  /** A reco kind the truth graph says nothing about: why, and the gap's number in docs/truth-graph.md. `derived`:
   *  from bundles made before Ember stopped deriving truth; ignored. */
  truthGap?: { reason: string; gap?: number; derived?: "content" };
  onSelection?: boolean; // draw only the objects related to the selection, until the user chooses all
  cell?: CellShape;
  /** `segments`: the direction columns of a line of `length` (instead of `end`); `cones`: [eta, phi] of the axis. */
  direction?: string[];
  /** `segments`, `cones`: the length (cm); `helix`: with `to`, where a path without a finite `end` stops. */
  length?: PerRow | ToCylinder;
  centred?: boolean; // segments with `direction`: `length` split evenly around `position`
  arrow?: boolean; // segments: an arrow head at the end
  width?: number; // segments, helix, polyline: line width in px (default 1)
  /** `polyline`: the path of each row through the rows of a relation's `to` table, in stored order. */
  points?: { relation: string; position?: [string, string, string] };
  radius?: number | string; // cones: half-opening in eta-phi
  views?: ViewName[]; // the views that draw the layer (default: all)
  visible: boolean;
  /** Object rows under the layer in the side panel: the `max` largest by `sort` that pass its cut and filter; the
   *  headline counts them, or gives a one-object table's value. */
  list?: { columns: string[]; sort?: string; max?: number; headline?: "count" | "value" };
  inspect?: string[]; // the columns the card shows first
  inspectGroups?: { name: string; columns: string[] }[]; // named groups of columns in the card's physics block
  missing?: Record<string, number>; // per column, the value that means "not set" (-99 for no time)
  fractions?: Record<string, string>; // columns holding fractions of the object's energy, with their names
  labels?: number; // label this many leading objects in the view
}
/** A view preset: 3D, or the front (x-y), side (z-y) and rho-z projections. */
export type ViewName = "3d" | "front" | "side" | "rz";
/** A value per row from a column, scaled and clamped (cm per unit; `log`: cm per decade of 1 + |value|). */
export interface Scaled {
  column: string;
  scale: number;
  min?: number;
  max?: number;
  log?: boolean;
}
/** A length to a cylinder around the beam (cm): from the object's start along its direction until it leaves it. */
export interface ToCylinder {
  to: { r: number; z: number };
}
/** A number per row: a constant, a column, or a scaled column. */
export type PerRow = number | string | Scaled;

/** A per-event chart: `table` rows grouped by the integer column `groupBy`, counted or summed over `value`, of the
 *  rows where `where` holds. */
export interface Summary {
  title: string;
  table: string;
  groupBy: string;
  value?: string;
  op: "sum" | "count" | "mean";
  unit?: string;
  where?: string;
}
/** A named way of looking at the data: colour columns per table and row filters (expressions) per table. */
export interface Preset {
  name: string;
  colour?: Record<string, string>;
  filters?: Record<string, string>;
  /** Tables whose layers the preset ticks. */
  show?: string[];
}
/** A part of the detector (header `domains`): its region (cm; z is |z|) and the view that suits it. */
export interface Domain {
  name: string;
  region: { rMax: number; zMax: number };
  view?: ViewName;
  shared?: boolean; // its layers are drawn in every domain's view (physics objects)
  colourMode?: "pid" | "layers"; // "layers": each layer takes its own colours while this domain is looked at
  minRadius?: number; // smallest radius (cm) framed around its objects, instead of `view.minRadius`
}
/** One part of the detector drawn as a faint cylinder outline (header `outlines`). */
export interface Outline {
  name: string;
  r: [number, number];
  z: [number, number];
}
/** What is known about a run (type, setup, beam, ...), from the index. */
export type RunInfo = Record<string, string | number | boolean>;

/** An event in the index: its ids, where its record is in the file, and how many rows each table has. */
export interface IndexEntry {
  run: number;
  lumi: number;
  event: number;
  offset: number;
  length: number;
  counts: Record<string, number>;
}
/** A run of the bundle: where its per-run tables are (if it has any), and what is known about it. */
export interface RunEntry {
  run: number;
  offset?: number;
  length?: number;
  counts?: Record<string, number>;
  info?: RunInfo;
}

/** A table of one event: `n` rows, one typed array per column. */
export interface Table {
  n: number;
  columns: Record<string, Column>;
}
/** A relation of one event in CSR form: the `to` rows of `from` row i are indices[offsets[i]] to
 *  indices[offsets[i + 1] - 1], with one weight per entry for each named weight. */
export interface Relation {
  offsets: Uint32Array;
  indices: Uint32Array;
  weights: Record<string, Float32Array>;
}
/** One event as read: its ids (run, lumi, event), its tables and its relations. */
export interface EventData {
  id: [number, number, number];
  tables: Record<string, Table>;
  relations: Record<string, Relation>;
}

/** A column as 32-bit floats, as the shaders and the cuts take it: the column itself if it already is, else a copy; a
 *  missing column is `n` times `fill`. */
export const toF32 = (c: Column | undefined, n: number, fill = 0) =>
  c instanceof Float32Array
    ? c
    : c
      ? Float32Array.from(c as ArrayLike<number | bigint>, Number)
      : new Float32Array(n).fill(fill);

/** The unit in a column's documentation, written as "[GeV]". */
export const unitOf = (doc = "") => doc.match(/\[([^\]]+)\]/)?.[1] ?? "";
/** Short name of a layer's kind of object: its group for a layer with a kind ("Tracksters"), else its label. */
export const kindName = (d: DisplayLayer) => (d.kind ? d.group : d.label);
