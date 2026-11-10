// Colours per theme. Sequential scales fade towards the background at low values and stand out at high values
// (log10 for positive quantities such as energies, linear otherwise); categorical colours tell objects apart
// (one per trackster; its layer clusters share it). Computed once per event on the CPU, so shaders and legend agree.
import type { Column, DisplayLayer, EventData, Header, Table } from "../io/bundle";

export const PALETTES = {
  light: {
    background: 0xffffff, rim: [0.1, 0.1, 0.1], unassigned: "#cdd2d8", flash: 0, // replay: how far a new object flashes to white
    ramps: { heat: ["#fff1a8", "#fdb863", "#f4743b", "#c7253e", "#5c0a1e"], cool: ["#d6e6f5", "#8fbbe0", "#4a8cc4", "#22589b", "#0b2a5c"] },
    categories: ["#1f77b4", "#2ca02c", "#9467bd", "#17becf", "#e377c2", "#393b79", "#637939", "#7b4173", "#3182bd", "#31a354"],
  },
  dark: {
    background: 0x0f1419, rim: [0.93, 0.95, 0.97], unassigned: "#3a424d", flash: 0.8,
    ramps: { heat: ["#6a2450", "#a0303f", "#d4533a", "#f59e42", "#fde89a"], cool: ["#1d4166", "#2563a0", "#3a8fd0", "#72c3ee", "#cdf0ff"] },
    categories: ["#4ea1ff", "#5fd068", "#b48cff", "#3dd6e0", "#ff8fd1", "#8e95ff", "#b5d94c", "#e08fd0", "#76b8ff", "#7be39a"],
  },
} as const;
export type ThemeName = keyof typeof PALETTES;
export type Pal = (typeof PALETTES)[ThemeName];
export type Palette = keyof Pal["ramps"];
export interface Range { scale: "log" | "linear"; lo: number; hi: number } // lo/hi in log10 units for "log"

export type Legend =
  | { kind: "ramp"; palette: Palette; range: Range; column: string; unit: string }
  | { kind: "category"; text: string; items?: { label: string; colour: string }[] };

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
export function ramp(stops: readonly string[], t: number): number[] {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2), f = x - i;
  const a = rgb(stops[i]), b = rgb(stops[i + 1]);
  return a.map((v, k) => v + (b[k] - v) * f);
}

export const toF32 = (c: Column | undefined, n: number, fill = 0) =>
  c instanceof Float32Array ? c : c ? Float32Array.from(c as ArrayLike<number | bigint>, Number) : new Float32Array(n).fill(fill);

/** Colour scale over the bulk of the values (<= 50k samples): log10 from the 5th to the 99.5th percentile when
 *  (nearly) all values are positive, otherwise linear from the 1st to the 99th. */
export function valueRange(values: ArrayLike<number>): Range {
  const step = Math.max(1, Math.floor(values.length / 50000));
  const finite: number[] = [];
  for (let i = 0; i < values.length; i += step) if (Number.isFinite(values[i])) finite.push(values[i]);
  const positive = finite.filter((v) => v > 0);
  const log = positive.length > 0 && positive.length >= 0.95 * finite.length;
  const xs = (log ? positive.map(Math.log10) : finite).sort((a, b) => a - b);
  if (!xs.length) return { scale: "linear", lo: 0, hi: 1 };
  const q = (f: number) => xs[Math.floor(f * (xs.length - 1))];
  const [lo, hi] = log ? [q(0.05), q(0.995)] : [q(0.01), q(0.99)];
  return hi > lo ? { scale: log ? "log" : "linear", lo, hi } : { scale: log ? "log" : "linear", lo: lo - 0.5, hi: lo + 0.5 };
}

const position = (r: Range, v: number) => ((r.scale === "log" ? Math.log10(Math.max(v, 1e-12)) : v) - r.lo) / (r.hi - r.lo);

const unitOf = (doc = "") => doc.match(/\[([^\]]+)\]/)?.[1] ?? "";

/** Per-object RGB (n * 3), the legend describing it, and (for relation colouring) which objects to emphasise:
 *  0 for objects not related to anything, which are drawn as background. `range` shares one value scale
 *  between layers; without it the layer's own values set the scale. */
export function colours(d: DisplayLayer, t: Table, ev: EventData, header: Header, pal: Pal, range?: Range): { rgb: Float32Array; legend: Legend; emphasis?: Uint8Array } {
  const out = new Float32Array(3 * t.n);
  const category = (i: number) => pal.categories[i % pal.categories.length];
  const set = (i: number, c: number[]) => out.set(c, 3 * i);

  if (d.colourBy === "row") {
    for (let i = 0; i < t.n; i++) set(i, rgb(category(i)));
    return { rgb: out, legend: { kind: "category", text: "one colour per object" } };
  }
  if (typeof d.colourBy === "object" && "category" in d.colourBy) {
    // Colours follow the order of `names`, so a value keeps its colour from event to event.
    const { category: column, abs = false, names = {} } = d.colourBy, col = t.columns[column];
    const order = Object.keys(names), used = new Map<string, number>();
    for (let i = 0; i < t.n; i++) {
      const raw = col ? Number(col[i]) : 0, v = String(abs ? Math.abs(raw) : raw);
      if (!used.has(v)) used.set(v, order.includes(v) ? order.indexOf(v) : order.length + used.size);
      set(i, rgb(category(used.get(v)!)));
    }
    const items = [...used].sort((a, b) => a[1] - b[1]).map(([v, k]) => ({ label: names[v] ?? v, colour: category(k) }));
    return { rgb: out, legend: { kind: "category", text: `by ${column}`, items } };
  }
  const relName = typeof d.colourBy === "object" && "relation" in d.colourBy ? d.colourBy.relation : undefined;
  const rel = relName ? ev.relations[relName] : undefined;
  if (rel && header.relations[relName!].to === d.table) {
    const owner = new Int32Array(t.n).fill(-1);
    for (let f = 0; f + 1 < rel.offsets.length; f++)
      for (let k = rel.offsets[f]; k < rel.offsets[f + 1]; k++) if (owner[rel.indices[k]] < 0) owner[rel.indices[k]] = f;
    // An object takes its owner's colour when the owner has categorical colours of its own (e.g. a candidate's
    // particle type), otherwise one colour per owner.
    const fromTable = header.relations[relName!].from, od = header.display.find((l) => l.table === fromTable), ot = ev.tables[fromTable];
    const ownerRgb = od && ot && (od.colourBy === "row" || (typeof od.colourBy === "object" && "category" in od.colourBy))
      ? colours(od, ot, ev, header, pal).rgb : null;
    for (let i = 0; i < t.n; i++)
      if (owner[i] < 0) set(i, rgb(pal.unassigned));
      else if (ownerRgb) out.set(ownerRgb.subarray(3 * owner[i], 3 * owner[i] + 3), 3 * i);
      else set(i, rgb(category(owner[i])));
    const from = od?.label ?? fromTable;
    const emphasis = Uint8Array.from(owner, (o) => (o < 0 ? 0 : 1));
    return { rgb: out, emphasis, legend: { kind: "category", text: `colour of its ${from.toLowerCase().replace(/s$/, "")}; small grey: none` } };
  }

  const palette = d.palette ?? "heat", column = d.colour ?? "";
  const values = toF32(column ? t.columns[column] : undefined, t.n, 1);
  const r = range ?? valueRange(values), stops = pal.ramps[palette];
  for (let i = 0; i < t.n; i++) set(i, ramp(stops, position(r, values[i])));
  return { rgb: out, legend: { kind: "ramp", palette, range: r, column, unit: unitOf(header.tables[d.table]?.columns[column]?.doc) } };
}
