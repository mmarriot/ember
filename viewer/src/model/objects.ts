// The object rows of a layer with a `list` hint (the Physics tab's event summary): the largest objects that pass the
// layer's cut and filter, and the headline that counts them.
import type { DisplayLayer, Table } from "../io/bundle";

/** The rows of `t` that `pass`, largest first by column `sort` (all of them if `t` has no such column, in row order),
 *  at most `max`. O(n log n) in the passing rows: a few thousand at most (PF candidates at PU200), well under a ms. */
export function topRows(t: Table, sort: string | undefined, pass: (row: number) => boolean, max: number): number[] {
  const rows: number[] = [];
  for (let i = 0; i < t.n; i++) if (pass(i)) rows.push(i);
  const key = sort ? t.columns[sort] : undefined;
  if (key) rows.sort((a, b) => Number(key[b]) - Number(key[a]));
  return rows.slice(0, max);
}

/** Whether row `i` of a layer's table passes its cut (minimum `min` on the cut column) and its filter (`keep`, from
 *  filterMask: non-zero to keep). */
export function passes(d: Pick<DisplayLayer, "cut">, t: Table, min: number, keep: Float32Array | null) {
  const c = d.cut ? t.columns[d.cut.column] : undefined;
  return (i: number) => (!keep || !!keep[i]) && (!c || Number(c[i]) >= min);
}

/** Readable names of common physics columns in the object rows' heading; others keep their own name. */
const NAMES: Record<string, string> = { pt: "pT", eta: "η", phi: "φ", energy: "E", mass: "m" };
export const columnName = (c: string) => NAMES[c] ?? c;

/** The row after (`by` 1) or before (-1) `current` in `rows`, cycling; from outside them (or none), the first (or the
 *  last going back). Undefined for no rows. */
export function stepRow(rows: number[], current: number | undefined, by: number): number | undefined {
  if (!rows.length) return undefined;
  const at = current === undefined ? -1 : rows.indexOf(current);
  return rows[at < 0 ? (by > 0 ? 0 : rows.length - 1) : (at + by + rows.length) % rows.length];
}
