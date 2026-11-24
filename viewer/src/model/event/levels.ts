// The levels of a focus: the kinds of object it is made of, from the top down (a candidate: interpretations, linked
// tracksters, tracksters, layer clusters, hits). The view draws those whose collections are ticked; ↓ ↑ move the tick
// through the levels in between, one at a time, so they need not cover each other (store/selection.ts).
import { type DisplayLayer, type Header, kindName } from "../../io/format";
import { ownDomains } from "./domains";
import type { Related } from "./relations";

/** `count`: the focus's objects in it; `leaf`: it holds no other level; `always`: not stepped through by ↓ ↑ (a leaf,
 *  or a level drawn as lines, which hides nothing); `holders`: the levels that hold it directly (see focusLevels);
 *  `beside`: not the focus's own parts, only built from them (a jet's taus; see partsFirst). */
export interface Level {
  name: string;
  layers: DisplayLayer[];
  count: number;
  leaf: boolean;
  always: boolean;
  depth?: number;
  holders?: string[];
  beside?: boolean;
}
type Relations = Header["relations"];

/** The levels below the focus (`focus`: its table) that its highlight `hl` has objects in, top first, in display order
 *  (profiles list kinds top down). `own`: whether a table is reached through the focus's own relations, not only
 *  through an association (its truth particle). Left out: the focus's own kind and stage (a candidate's track), truth
 *  and background layers. With `relations`, a focus can have several branches (a candidate's tracksters and its
 *  track): a level that holds another (through plain relations) comes before it, and the leaves (each branch's
 *  smallest objects) come last; kinds that only share objects (jets and taus) hold each other only as stages, the
 *  later holding the earlier. Without, the last level is the only leaf, held by the one before it. */
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
  // levels (a pair view's levels may lack the layer clusters); never back up (`inverseOf`: a track's vertex).
  const down = Object.values(relations).filter((r) => !r.association && !r.inverseOf);
  type L = (typeof levels)[number];
  // `near`: not going on through a table drawn as another kind (a jet's PF candidates reach calorimeter hits through
  // PF clusters, and, not near, through electrons and their superclusters).
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
  // Two stages that lead to the same objects without leading to each other (a hit's pair: interpretations, linked
  // tracksters and tracksters, each through layer clusters): the later holds the other. Not other kinds that share
  // objects (jets and taus): nothing says one holds the other.
  const stage = (l: L) => Math.max(-1, ...l.layers.map((d) => d.stage ?? -1));
  const shares = (a: L, b: L) => [...reach.get(a)!].some((t) => reach.get(b)!.has(t));
  const holds = (a: L, b: L) => leads(a, b) || (stage(b) >= 0 && stage(a) > stage(b) && !leads(b, a) && shares(a, b));
  const above = (a: L, b: L) => holds(a, b) && !holds(b, a);
  // Holds it directly: through no other kind, or else with no level in between (candidates hold tracksters only
  // through linked tracksters).
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
  // Depth: the longest chain of levels holding it (0: none), comparable across branches.
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

/** The levels as the card's chain lists them, each branch down to its end before the next: depth first from the
 *  levels held by none, each as soon as the last of its holders is listed, ties in the order given. `indent`: one more
 *  than that last holder's; `via`: its other holders (a jet's tracks, through its PF and its TICL candidates). */
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

/** The levels with the object's own parts first (`part`: a table it is made of), then those only built from its
 *  parts (a jet's taus), marked `beside`: ↓ steps through its own parts only. */
export const partsFirst = (levels: Level[], part: (table: string) => boolean) => {
  const own = (l: Level) => l.layers.some((d) => part(d.table));
  return [...levels.filter(own), ...levels.filter((l) => !own(l)).map((l) => ({ ...l, beside: true }))];
};

/** The level shown after stepping `by` down (+1) or up (-1) from `chosen`, among the own parts not always drawn;
 *  null (none) before the first. */
export function stepLevel(levels: Level[], chosen: string | null, by: number): string | null {
  const names = levels.filter((l) => !l.always && !l.beside).map((l) => l.name);
  const i = Math.min(Math.max((chosen ? names.indexOf(chosen) : -1) + by, -1), names.length - 1);
  return i < 0 ? null : names[i];
}

/** The detector parts a level's layers are in: none for shared or domain-less layers, which every domain draws. */
const domainsOf = (l: Level, shared: Set<string>) => ownDomains(l.layers, shared);

/** For the view of everything: levels at the same depth in different parts of the detector become one (a jet's
 *  tracks and calorimeter clusters), as they cannot cover each other. Levels always drawn are left as they are. */
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

/** The levels ↓ ↑ step through in domain `current` (null: everything): those it draws as its own or shares. */
export function scopeLevels(levels: Level[], current: string | null, shared: Set<string>) {
  if (!current) return levels;
  return levels.filter((l) => {
    const ds = domainsOf(l, shared);
    return !ds.size || (!shared.has(current) && ds.has(current));
  });
}
