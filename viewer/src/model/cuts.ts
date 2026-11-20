// What passes the cuts and filters. A layer gets one value per object (its cut column, or a placeholder) that the
// shader and Layer.passes() compare with the cut's minimum, so filters and "only the selection's objects" ride on
// the same comparison: a hidden object's value is below any minimum, a forced one above.
import { type DisplayLayer, type Table, toF32 } from "../io/format";
import { filterMask } from "./custom";

export const HIDDEN = -3e38; // below any minimum: never shown
const SHOWN = 3e38,
  NO_CUT = -1e30; // NO_CUT: the minimum of a layer with a filter but no cut

/** Per-object values to compare with cutMin: the cut column with filtered-out rows hidden, or (`only`) just those
 *  rows shown; undefined when nothing applies. Rows of the `focus` (the selected object and what it is related to)
 *  are not hidden by the filter, only by the cut: a filter chooses what to show, not what a selection may reach. */
export function cutValues(
  d: DisplayLayer,
  t: Table,
  filter?: string,
  only?: Set<number>,
  focus?: Set<number>,
): Float32Array | undefined {
  if (only) {
    const out = new Float32Array(t.n).fill(HIDDEN);
    for (const i of only) out[i] = SHOWN;
    return out;
  }
  const base = d.cut && t.columns[d.cut.column] ? toF32(t.columns[d.cut.column], t.n) : undefined;
  const keep = filterMask(t, filter);
  if (!keep) return base;
  const out = base ? Float32Array.from(base) : new Float32Array(t.n); // a copy: `base` may be the event's own column
  for (let i = 0; i < t.n; i++) if (!keep[i] && !focus?.has(i)) out[i] = HIDDEN;
  return out;
}

/** The rows of the `focus` that the filter (`keep`, from filterMask) hides, as a key: those cutValues shows only for
 *  the focus. "" for none. */
export function rescued(keep: Float32Array | null, focus?: Set<number>): string {
  if (!keep || !focus) return "";
  const rows: number[] = [];
  for (const i of focus) if (!keep[i]) rows.push(i);
  return rows.sort((a, b) => a - b).join(",");
}

/** The minimum an object's cut value must reach for the layer to show it. */
export const cutMin = (d: DisplayLayer, values: Float32Array | undefined, cuts: Record<string, number>) =>
  d.cut ? (cuts[d.cut.group] ?? 0) : values ? NO_CUT : -Infinity;

/** What a cut is on, in words: the profile's `label`, else its group's name ("Hit energy" -> "hit energy"), never
 *  the raw column. On a collection's own row, the part of it that repeats the row's name goes ("ECAL barrel energy"
 *  on the ECAL barrel row -> "energy"). */
export function cutName(cut: { group: string; label?: string }, row?: string): string {
  const name = cut.label ?? cut.group.charAt(0).toLowerCase() + cut.group.slice(1);
  if (!row) return name;
  if (name === row) return cut.group.startsWith(`${row} `) ? cut.group.slice(row.length + 1) : "";
  return name.startsWith(`${row} `) ? name.slice(row.length + 1) : name;
}

/** A cut's minimum with its unit, energies below 1 GeV in MeV: "35 MeV", "1 GeV". */
export function cutAmount(v: number, unit: string): string {
  const [x, u] = unit === "GeV" && v > 0 && v < 1 ? [v * 1000, "MeV"] : [v, unit];
  const s = Number.isInteger(x) || Math.abs(x) >= 100 ? x.toFixed(0) : String(Number(x.toPrecision(3)));
  return u ? `${s} ${u}` : s;
}
