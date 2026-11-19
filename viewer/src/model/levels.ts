// The levels of a focus: the kinds of object it is made of, from the top down (a candidate: interpretations, linked
// tracksters, tracksters, layer clusters, hits). The view shows the focus and its bottom levels (its smallest objects,
// one per branch: a candidate's hits and its track's hits), with the levels drawn as lines (its track: lines do not
// hide the hits); the other levels in between are shown one at a time, on request, so they do not cover each other.
import { type DisplayLayer, type Header, kindName } from "../io/format";
import { ownDomains } from "./domains";
import type { Related } from "./relations";

/** `count`: the focus's objects in it; `leaf`: it holds no other level; `always`: drawn whenever the focus is (a leaf,
 *  or a level drawn as lines), not one at a time; `holders`: the levels that hold it directly (see focusLevels). */
export interface Level {
  name: string;
  layers: DisplayLayer[];
  count: number;
  leaf: boolean;
  always: boolean;
  depth?: number;
  holders?: string[];
}
type Relations = Header["relations"];

/** The levels below the focus (`focus`: its table) that `hl` (its highlight) has objects in, top first. `own`: whether
 *  a table is reached through the focus's own relations (what it is made of or contains), not only through an
 *  association (e.g. its truth particle). Left out: the focus's own kind and reconstruction stage (e.g. a candidate's
 *  track), truth and background layers. Ordered by display order, as profiles list kinds from the top down
 *  (candidates first, hits last). With `relations`, a focus can have several branches (a candidate's tracksters and
 *  its track, each down to its own hits): a level that holds another (a chain of plain relations from one of its tables
 *  to the other's) comes before it, and the levels that hold none (the leaves: each branch's smallest objects) come
 *  last; without, the last level is the only leaf. Kinds that only share objects (jets and taus) hold each other only
 *  as reconstruction stages: the later holds the earlier. `holders`: with `relations`, the levels with a chain of
 *  relations to it that passes no table of another kind, or else the nearest that hold it; without, the level before
 *  it. */
export function focusLevels(
  display: DisplayLayer[],
  focus: string,
  hl: Related,
  own: (table: string) => boolean,
  relations?: Relations,
): Level[] {
  const top = display.find((d) => d.table === focus);
  const levels: (Level & { tables: Set<string> })[] = [];
  for (const d of display) {
    const rows = hl.get(d.table);
    if (!rows?.size || !own(d.table) || d.table === focus || d.context || d.truth) continue;
    if (top && (kindName(d) === kindName(top) || (d.stage !== undefined && d.stage === top.stage))) continue;
    const name = kindName(d);
    let level = levels.find((l) => l.name === name);
    if (!level) levels.push((level = { name, layers: [], count: 0, leaf: false, always: false, tables: new Set() }));
    level.layers.push(d);
    if (!level.tables.has(d.table)) {
      level.tables.add(d.table);
      level.count += rows.size;
    }
  }
  const lines = (l: { layers: DisplayLayer[] }) =>
    l.layers.every((d) => d.repr === "helix" || d.repr === "segments" || d.repr === "polyline");
  if (!relations)
    return levels.map(({ name, layers, count }, i) => ({
      name,
      layers,
      count,
      leaf: i === levels.length - 1,
      always: i === levels.length - 1 || lines({ layers }),
      depth: i,
      holders: i ? [levels[i - 1].name] : [],
    }));
  // What each level holds: the tables its objects lead to through plain relations, also through tables that are not
  // levels (a candidate's interpretations hold its hits through layer clusters missing from a pair view's levels). Not
  // through a relation that points back up (`inverseOf`: a track's vertex).
  const down = Object.values(relations).filter((r) => !r.association && !r.inverseOf);
  type L = (typeof levels)[number];
  // The tables a level's objects lead to; `near`: not going on through a table drawn as another kind (a jet's PF
  // candidates reach calorimeter hits through PF clusters, and through electrons and their superclusters, not near).
  const kindOf = new Map(display.map((d) => [d.table, kindName(d)]));
  const reached = (l: L, near: boolean) => {
    const seen = new Set<string>(),
      todo = [...l.tables];
    while (todo.length) {
      const t = todo.pop()!;
      for (const r of down)
        if (r.from === t && !seen.has(r.to)) {
          seen.add(r.to);
          if (!near || (kindOf.get(r.to) ?? l.name) === l.name) todo.push(r.to);
        }
    }
    return seen;
  };
  const reach = new Map(levels.map((l) => [l, reached(l, false)] as const)),
    nearby = new Map(levels.map((l) => [l, reached(l, true)] as const));
  const leads = (a: L, b: L) => a !== b && [...b.tables].some((t) => reach.get(a)!.has(t));
  // Two reconstruction stages that lead to the same objects without leading to each other (a hit's pair: its
  // interpretations, linked tracksters and tracksters, each through layer clusters): the later stage holds the other.
  // Not other kinds that share objects (jets and taus, both made of PF candidates): nothing says one holds the other.
  const stage = (l: L) => Math.max(-1, ...l.layers.map((d) => d.stage ?? -1));
  const shares = (a: L, b: L) => [...reach.get(a)!].some((t) => reach.get(b)!.has(t));
  const holds = (a: L, b: L) => leads(a, b) || (stage(b) >= 0 && stage(a) > stage(b) && !leads(b, a) && shares(a, b));
  const above = (a: L, b: L) => holds(a, b) && !holds(b, a);
  // Holds it directly: a chain of relations to it that passes no other kind, or else no level in between (linked
  // tracksters hold tracksters, and candidates hold them only through those).
  const direct = (a: L, b: L) =>
    above(a, b) &&
    ([...b.tables].some((t) => nearby.get(a)!.has(t)) || !levels.some((c) => above(a, c) && above(c, b)));
  // Kahn's order: a level once every level holding it is placed; of several, the first in display order.
  const order: typeof levels = [],
    left = [...levels];
  while (left.length) {
    const next = left.find((l) => !left.some((o) => above(o, l))) ?? left[0]; // a cycle: display order
    order.push(next);
    left.splice(left.indexOf(next), 1);
  }
  // Depth: the longest chain of levels holding it (0: held by none), so levels of different branches can be compared.
  const depth = new Map<(typeof levels)[number], number>();
  const depthOf = (l: (typeof levels)[number], seen = new Set<typeof l>()): number => {
    if (depth.has(l)) return depth.get(l)!;
    seen.add(l);
    const up = levels.filter((o) => !seen.has(o) && above(o, l)).map((o) => depthOf(o, seen) + 1);
    seen.delete(l);
    const d = Math.max(0, ...up);
    depth.set(l, d);
    return d;
  };
  const out = order.map((l) => {
    const leaf = !levels.some((o) => holds(l, o));
    const holders = order.filter((o) => direct(o, l)).map((o) => o.name);
    return {
      name: l.name,
      layers: l.layers,
      count: l.count,
      leaf,
      always: leaf || lines(l),
      depth: depthOf(l),
      holders,
    };
  });
  return [...out.filter((l) => !l.always), ...out.filter((l) => l.always)];
}

/** The levels as the card's chain lists them, so that each branch reads down to its end before the next (a jet's TICL
 *  candidates down to their hits, then its tracks down to theirs): depth first from the levels held by none, each
 *  level as soon as the last of its holders is listed, ties in the order given. `indent`: one more than that last
 *  holder's, so a step sits under the closest step holding it; `via`: its other holders (a kind several kinds hold: a
 *  jet's tracks, through its PF candidates and its TICL candidates). The levels' own order (what the view steps
 *  through) is left as it is. */
export function chainOrder(levels: Level[]): { level: Level; indent: number; via: string[] }[] {
  const names = new Set(levels.map((l) => l.name)),
    holders = (l: Level) => (l.holders ?? []).filter((h) => names.has(h));
  // How many of each level's holders are not listed yet; -1 once it is listed.
  const left = new Map(levels.map((l) => [l, holders(l).length])),
    out: { level: Level; indent: number; via: string[] }[] = [];
  const visit = (l: Level, indent: number, under?: string) => {
    left.set(l, -1);
    out.push({ level: l, indent, via: holders(l).filter((h) => h !== under) });
    const ready: Level[] = [];
    for (const c of levels)
      if (left.get(c)! > 0 && holders(c).includes(l.name)) {
        left.set(c, left.get(c)! - 1);
        if (!left.get(c)) ready.push(c);
      }
    for (const c of ready) if (left.get(c) === 0) visit(c, indent + 1, l.name);
  };
  for (const l of levels) if (left.get(l) === 0) visit(l, 0);
  for (const l of levels) if (left.get(l)! >= 0) visit(l, 0); // a cycle of holders
  return out;
}

/** Which layers of the levels are drawn: those of the levels always drawn (the smallest objects, lines) and of the
 *  `chosen` level, each by its layers ticked in the side panel, or all of them if none is; the others are not. */
export function levelLayers(levels: Level[], chosen: string | null, ticked: (d: DisplayLayer) => boolean) {
  const draw: DisplayLayer[] = [],
    hide: DisplayLayer[] = [];
  levels.forEach((l) => {
    if (!l.always && l.name !== chosen) return hide.push(...l.layers);
    const on = l.layers.filter(ticked);
    draw.push(...(on.length ? on : l.layers));
  });
  return { draw, hide };
}

/** The level to show after stepping `by` levels down (+1) or up (-1) from `chosen`, among those not always drawn:
 *  from none to the first, and from the first back to none (null). */
export function stepLevel(levels: Level[], chosen: string | null, by: number): string | null {
  const names = levels.filter((l) => !l.always).map((l) => l.name);
  const i = Math.min(Math.max((chosen ? names.indexOf(chosen) : -1) + by, -1), names.length - 1);
  return i < 0 ? null : names[i];
}

/** The parts of the detector (layer `domain`, not a shared one) a level's layers are in: none for shared or
 *  domain-less layers (e.g. physics objects), which every domain draws. */
const domainsOf = (l: Level, shared: Set<string>) => ownDomains(l.layers, shared);

/** Levels at the same depth (see focusLevels) that lie in different parts of the detector become one level (e.g. a
 *  jet's tracks and calorimeter clusters): they cannot cover each other, and the bar gets shorter. For the view of
 *  everything; levels drawn always (leaves, lines) are left as they are. */
export function mergeAcrossDomains(levels: Level[], shared: Set<string>): Level[] {
  const out: Level[] = [],
    merged = new Map<number, Level>();
  for (const l of levels) {
    const ds = domainsOf(l, shared),
      same = l.always || l.depth === undefined || ds.size !== 1 ? undefined : merged.get(l.depth);
    const other = same && domainsOf(same, shared);
    if (same && other && ![...ds].some((d) => other.has(d))) {
      const i = out.indexOf(same),
        m = {
          ...same,
          name: `${same.name} · ${l.name}`,
          layers: [...same.layers, ...l.layers],
          count: same.count + l.count,
        };
      out[i] = m;
      merged.set(l.depth!, m);
      continue;
    }
    out.push(l);
    if (!l.always && l.depth !== undefined && ds.size === 1 && !merged.has(l.depth)) merged.set(l.depth, l);
  }
  return out;
}

/** The levels that ↓ ↑ step through and the card's chain offers to show in domain `current` (null: everything): those
 *  it draws as its own or shares with every domain. */
export function scopeLevels(levels: Level[], current: string | null, shared: Set<string>) {
  if (!current) return levels;
  return levels.filter((l) => {
    const ds = domainsOf(l, shared);
    return !ds.size || (!shared.has(current) && ds.has(current));
  });
}
