// The levels of a focus: the kinds of object it is made of, from the top down (a candidate: interpretations, linked
// tracksters, tracksters, layer clusters, hits). The view shows the focus and its bottom level (its smallest
// objects); the levels in between are shown one at a time, on request, so they do not cover each other.
import { type DisplayLayer, kindName } from "../io/bundle";
import type { Related } from "./relations";

export interface Level { name: string; layers: DisplayLayer[]; count: number } // count: the focus's objects in it

/** The levels below the focus (`focus`: its table) that `hl` (its highlight) has objects in, top first. `own`: whether
 *  a table is reached through the focus's own relations (what it is made of or contains), not only through an
 *  association (e.g. its truth particle). Left out: the focus's own kind and reconstruction stage (e.g. a candidate's
 *  track), truth, background and alternative layers. Ordered by reverse display order, as profiles list kinds from
 *  the bottom up (hits first, candidates last). */
export function focusLevels(display: DisplayLayer[], focus: string, hl: Related, own: (table: string) => boolean): Level[] {
  const top = display.find((d) => d.table === focus);
  const levels: (Level & { tables: Set<string> })[] = [];
  for (const d of [...display].reverse()) {
    const rows = hl.get(d.table);
    if (!rows?.size || !own(d.table) || d.table === focus || d.context || d.alternative || d.truth) continue;
    if (top && (kindName(d) === kindName(top) || (d.stage !== undefined && d.stage === top.stage))) continue;
    const name = kindName(d);
    let level = levels.find((l) => l.name === name);
    if (!level) levels.push((level = { name, layers: [], count: 0, tables: new Set() }));
    level.layers.push(d);
    if (!level.tables.has(d.table)) { level.tables.add(d.table); level.count += rows.size; }
  }
  return levels.map(({ name, layers, count }) => ({ name, layers, count }));
}

/** Which layers of the levels are drawn: those of the bottom level and of the `chosen` one (a level above the
 *  bottom, or null), each by its layers ticked in the Layers tab, or all of them if none is; the others are not. */
export function levelLayers(levels: Level[], chosen: string | null, ticked: (d: DisplayLayer) => boolean) {
  const draw: DisplayLayer[] = [], hide: DisplayLayer[] = [];
  levels.forEach((l, i) => {
    if (i < levels.length - 1 && l.name !== chosen) return hide.push(...l.layers);
    const on = l.layers.filter(ticked);
    draw.push(...(on.length ? on : l.layers));
  });
  return { draw, hide };
}

/** The level to show after stepping `by` levels down (+1) or up (-1) from `chosen`, among those above the bottom
 *  one: from none to the first, and from the first back to none (null). */
export function stepLevel(levels: Level[], chosen: string | null, by: number): string | null {
  const names = levels.slice(0, -1).map((l) => l.name);
  const i = Math.min(Math.max((chosen ? names.indexOf(chosen) : -1) + by, -1), names.length - 1);
  return i < 0 ? null : names[i];
}
