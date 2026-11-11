// The levels of a focus: the kinds of object it is made of, from the top down (a candidate: interpretations, linked
// tracksters, tracksters, layer clusters, hits). The view shows the focus and its bottom levels (its smallest objects,
// one per branch: a candidate's hits and its track's hits); the levels in between are shown one at a time, on
// request, so they do not cover each other.
import { type DisplayLayer, type Header, kindName } from "../io/bundle";
import type { Related } from "./relations";

export interface Level { name: string; layers: DisplayLayer[]; count: number; leaf: boolean } // count: the focus's objects in it
type Relations = Header["relations"];

/** The levels below the focus (`focus`: its table) that `hl` (its highlight) has objects in, top first. `own`: whether
 *  a table is reached through the focus's own relations (what it is made of or contains), not only through an
 *  association (e.g. its truth particle). Left out: the focus's own kind and reconstruction stage (e.g. a candidate's
 *  track), truth, background and alternative layers. Ordered by reverse display order, as profiles list kinds from
 *  the bottom up (hits first, candidates last). With `relations`, a focus can have several branches (a candidate's
 *  tracksters and its track, each down to its own hits): a level that holds another (a plain relation from one of its
 *  tables to the other's) comes before it, and the levels that hold none (the leaves: each branch's smallest objects)
 *  come last; without, the last level is the only leaf. */
export function focusLevels(display: DisplayLayer[], focus: string, hl: Related, own: (table: string) => boolean, relations?: Relations): Level[] {
  const top = display.find((d) => d.table === focus);
  const levels: (Level & { tables: Set<string> })[] = [];
  for (const d of [...display].reverse()) {
    const rows = hl.get(d.table);
    if (!rows?.size || !own(d.table) || d.table === focus || d.context || d.alternative || d.truth) continue;
    if (top && (kindName(d) === kindName(top) || (d.stage !== undefined && d.stage === top.stage))) continue;
    const name = kindName(d);
    let level = levels.find((l) => l.name === name);
    if (!level) levels.push((level = { name, layers: [], count: 0, leaf: false, tables: new Set() }));
    level.layers.push(d);
    if (!level.tables.has(d.table)) { level.tables.add(d.table); level.count += rows.size; }
  }
  if (!relations) return levels.map(({ name, layers, count }, i) => ({ name, layers, count, leaf: i === levels.length - 1 }));
  const holds = (a: typeof levels[number], b: typeof levels[number]) =>
    a !== b && Object.values(relations).some((r) => !r.association && a.tables.has(r.from) && b.tables.has(r.to));
  // Kahn's order: a level once every level holding it is placed; of several, the first in display order.
  const order: typeof levels = [], left = [...levels];
  while (left.length) {
    const next = left.find((l) => !left.some((o) => holds(o, l) && !holds(l, o))) ?? left[0]; // a cycle: display order
    order.push(next);
    left.splice(left.indexOf(next), 1);
  }
  const out = order.map((l) => ({ name: l.name, layers: l.layers, count: l.count, leaf: !levels.some((o) => holds(l, o)) }));
  return [...out.filter((l) => !l.leaf), ...out.filter((l) => l.leaf)];
}

/** Which layers of the levels are drawn: those of the leaves (the smallest objects) and of the `chosen` level, each by
 *  its layers ticked in the side panel, or all of them if none is; the others are not. */
export function levelLayers(levels: Level[], chosen: string | null, ticked: (d: DisplayLayer) => boolean) {
  const draw: DisplayLayer[] = [], hide: DisplayLayer[] = [];
  levels.forEach((l) => {
    if (!l.leaf && l.name !== chosen) return hide.push(...l.layers);
    const on = l.layers.filter(ticked);
    draw.push(...(on.length ? on : l.layers));
  });
  return { draw, hide };
}

/** The level to show after stepping `by` levels down (+1) or up (-1) from `chosen`, among those that are not leaves:
 *  from none to the first, and from the first back to none (null). */
export function stepLevel(levels: Level[], chosen: string | null, by: number): string | null {
  const names = levels.filter((l) => !l.leaf).map((l) => l.name);
  const i = Math.min(Math.max((chosen ? names.indexOf(chosen) : -1) + by, -1), names.length - 1);
  return i < 0 ? null : names[i];
}
