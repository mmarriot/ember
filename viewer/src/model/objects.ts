// The object rows of a layer with a `list` hint (the Physics section's event summary): the largest objects that pass the
// layer's cut and filter, and the headline that counts them.
import type { DisplayLayer, Table } from "../io/format";

/** The rows of `t` that `pass`, largest first by column `sort` (all of them if `t` has no such column, in row order),
 *  at most `max`. For a short list (the side panel's object rows) one pass keeps the `max` largest in order, without
 *  sorting the table: 110k layer clusters at PU200 are a scan, not a 40 ms sort on every render. Otherwise (N steps
 *  through all of them) a sort, O(n log n) in the passing rows. */
export function topRows(t: Table, sort: string | undefined, pass: (row: number) => boolean, max: number): number[] {
  const key = sort ? t.columns[sort] : undefined,
    rows: number[] = [];
  if (key && max <= 64) {
    for (let i = 0; i < t.n; i++) {
      if (!pass(i) || (rows.length === max && !(Number(key[i]) > Number(key[rows[max - 1]])))) continue;
      let at = Math.min(rows.length, max - 1); // insert before the first smaller one; equal ones keep row order
      while (at > 0 && Number(key[rows[at - 1]]) < Number(key[i])) at--;
      rows.splice(at, 0, i);
      if (rows.length > max) rows.pop();
    }
    return rows;
  }
  for (let i = 0; i < t.n; i++) if (pass(i)) rows.push(i);
  if (key) rows.sort((a, b) => Number(key[b]) - Number(key[a]));
  return rows.slice(0, max);
}

/** Each row's place among `n` values, largest first, from 1 (equal values keep row order; NaN last): an object's number
 *  in its name, so the leading jet is "Jet 1" (store/names.ts numberOf). One sort of the rows, O(n log n). */
export function ranks(values: ArrayLike<number | bigint>, n: number): Uint32Array {
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = Number(values[i]);
    v[i] = x === x ? x : -Infinity; // NaN, which compares with nothing, last
  }
  const order = new Uint32Array(n).map((_, i) => i).sort((a, b) => (v[b] > v[a] ? 1 : v[b] < v[a] ? -1 : a - b)),
    out = new Uint32Array(n);
  order.forEach((row, k) => (out[row] = k + 1));
  return out;
}

/** Whether row `i` of a layer's table passes its cut (minimum `min` on the cut column) and its filter (`keep`, from
 *  filterMask: non-zero to keep). */
export function passes(d: Pick<DisplayLayer, "cut">, t: Table, min: number, keep: Float32Array | null) {
  const c = d.cut ? t.columns[d.cut.column] : undefined;
  return (i: number) => (!keep || !!keep[i]) && (!c || Number(c[i]) >= min);
}

/** Why row `i` does not pass its layer's cut and filter (see passes): "cut" when the cut alone leaves it out (the
 *  filter keeps it), "filter" when the filter does, "both"; undefined when it passes. */
export function whyHidden(d: Pick<DisplayLayer, "cut">, t: Table, min: number, keep: Float32Array | null, i: number) {
  const c = d.cut ? t.columns[d.cut.column] : undefined,
    cut = !!c && !(Number(c[i]) >= min),
    filter = !!keep && !keep[i];
  return cut && filter ? "both" : cut ? "cut" : filter ? "filter" : undefined;
}

/** Readable names of common physics columns in the object rows' heading and in object names (store/names.ts
 *  describe); others keep their own name. */
const NAMES: Record<string, string> = {
  pt: "pT",
  eta: "η",
  phi: "φ",
  energy: "E",
  raw_energy: "E raw",
  rawEnergy: "E raw",
  rechit_energy: "E",
  mass: "m",
  nTracks: "tracks",
  ntracks: "tracks",
  sumPt2: "ΣpT²",
  time: "t",
  wheelOrRing: "wheel/ring",
};
export const columnName = (c: string) => NAMES[c] ?? c;

/** The row after (`by` 1) or before (-1) `current` in `rows`, cycling; from outside them (or none), the first (or the
 *  last going back). Undefined for no rows. */
export function stepRow(rows: number[], current: number | undefined, by: number): number | undefined {
  if (!rows.length) return undefined;
  const at = current === undefined ? -1 : rows.indexOf(current);
  return rows[at < 0 ? (by > 0 ? 0 : rows.length - 1) : (at + by + rows.length) % rows.length];
}
