// The level graph as the rows of a tree (TreeView.tsx): the collisions it hangs from (the signal collision, its hard
// scatter and underlying event; the pile-up collisions), each particle under its primary parent, the vertices its
// daughters were made at between them, and, when asked ("▸ N below"), the particles at no shown level under a node.
// Only what is unfolded is listed, and a long list in parts, so the rows stay few at any pile-up.
import { copiesBelow, type Graph } from "../../../model/truth/graph";
import { type Collision, GRAPH_LEVELS, type LevelGraph, type ParticleNode } from "../../../model/truth/levelGraph";

/** How many particles a list shows at first, and how many more each "show more" adds. */
export const LIST = 50;

/** What is folded and listed: the tree's display state. Particles by their first copy's row (graph.ts top). */
export interface TreeState {
  /** Heads (by headKey) folded or unfolded by hand; else the signal collision and its hard scatter are open, the
   *  rest folded. */
  heads: Map<string, boolean>;
  /** Particles folded or unfolded by hand; else defaultOpen (a particle at no shown level: folded). */
  folds: Map<number, boolean>;
  /** Particles whose particles at no shown level are listed under them ("▸ N below"). */
  below: Set<number>;
  /** How many particles a list shows (by Row "more" list), when not LIST. */
  more: Map<string, number>;
}
export const emptyState = (): TreeState => ({ heads: new Map(), folds: new Map(), below: new Set(), more: new Map() });

/** A row above the particles: a collision (a vertex: the signal one, or one of pile-up), the signal collision's hard
 *  scatter (a vertex too) or its underlying event, or the pile-up, which holds the pile-up collisions. */
export type Head = { kind: "collision" | "scatter" | "underlying"; c: Collision } | { kind: "pileup" };
/** A head's key, for its fold and its list: a pile-up collision by its id, stable between the levels shown. */
export const headKey = (h: Head) =>
  h.kind === "pileup" ? "pileup" : h.kind !== "collision" ? h.kind : h.c.signal ? "signal" : `pu${h.c.id}`;
const openHead = (h: Head) => (h.kind === "collision" && h.c.signal) || h.kind === "scatter";

/** Where a row sits: its depth; for each ancestor level, whether the line joining that level's siblings passes beside
 *  it (`rails[d]` for depth d + 1); whether it is the last of its siblings (its own line stops at it). */
export interface Place {
  key: string;
  depth: number;
  rails: boolean[];
  last: boolean;
}
/** A row of the tree. `open` is undefined for a particle with nothing to fold. A particle's `below`: how many particles
 *  at no shown level it made, which "▸ N below" lists. A vertex row (`vertex`, its row in the vertex table; `node`, its
 *  node in the level graph, -1 if no shown particle was made there) stands on the line of the daughters made at it,
 *  shown or listed below, which follow it. "more": the rest of list `list`, `left` particles or collisions. */
export type Row =
  | (Place & { kind: "head"; head: Head; open: boolean })
  | (Place & { kind: "particle"; node: number; open?: boolean; below: number })
  | (Place & { kind: "hidden"; top: number; open?: boolean })
  | (Place & { kind: "vertex"; vertex: number; node: number })
  | (Place & { kind: "more"; list: string; left: number });

type Entry =
  | { kind: "head"; head: Head }
  | { kind: "particle"; node: number }
  | { kind: "hidden"; top: number }
  | { kind: "vertex"; vertex: number; node: number }
  | { kind: "more"; list: string; left: number };

const RECO = GRAPH_LEVELS.findIndex((l) => l.id === "reco");
/** A particle is unfolded by default under the hard scatter, or straight under a signal collision without one (a
 *  particle gun: its particles are the signal) (`hard`), down to its b / c hadrons and τ (the levels above
 *  "reconstructable"); the rest is folded. */
export const defaultOpen = (p: ParticleNode, hard: boolean) => hard && p.level < RECO;
/** The signal collision of a particle gun (no hard scatter): its particles open as the hard scatter's do. */
const gunOf = (h: Head) => h.kind === "collision" && h.c.signal && !h.c.scatter;

/** The particles a tree lists under node `i`: those whose primary parent it is, largest energy first. */
export const treeChildren = (lg: LevelGraph, i: number) =>
  lg.particles[i].children.filter((c) => lg.particles[c].parents[0] === i);

/** The particles at no shown level that particle `top` (any of its copies) made, by their first copy's row, largest
 *  energy first. */
export function hiddenChildren(g: Graph, lg: LevelGraph, top: number): number[] {
  const out = new Set<number>();
  for (const r of copiesBelow(g, top))
    for (const c of g.children(r)) if (g.top[c] !== top && lg.nodeOf[c] < 0) out.add(g.top[c]);
  return [...out].sort((a, b) => g.col("energy", b) - g.col("energy", a));
}

/** The way down the tree to a particle: its root's collision and whether the root hangs from the hard scatter (`hard`,
 *  else from the underlying event or straight from the collision), the particles (by top) from its root, the shown
 *  ones first (`tops[0 .. hidden - 1]`), then for a particle at no shown level, those at no shown level from below the
 *  node it hides under. As the level graph places it, each climbs through its parent of highest energy that is shown
 *  or has a shown particle above it (not a dead end such as a beam remnant's string). */
export interface Path {
  collision: Collision;
  hard: boolean;
  tops: number[];
  hidden: number;
}
/** The path to particle row `row` (any copy); null if no shown particle is above it (a beam proton). */
export function pathTo(g: Graph, lg: LevelGraph, row: number): Path | null {
  const P = lg.particles,
    chain: number[] = [];
  let t = g.top[row];
  for (let steps = 0; lg.nodeOf[t] < 0; steps++) {
    chain.unshift(t);
    const ps = g.parents(t).filter((q) => lg.nodeOf[g.top[q]] >= 0 || lg.hiddenUnder[g.top[q]] >= 0);
    if (!ps.length || steps > g.n) return null;
    t = g.top[ps.reduce((a, b) => (g.col("energy", b) > g.col("energy", a) ? b : a))];
  }
  const tops: number[] = [];
  let root = -1;
  for (let i = lg.nodeOf[t]; i >= 0 && tops.length <= P.length; i = P[i].parents[0] ?? -1)
    tops.unshift(P[(root = i)].top);
  const c = P[root].collision;
  return { collision: c, hard: c.hard.includes(root), tops: [...tops, ...chain], hidden: tops.length };
}

/** The heads (by headKey) above the particles of `path`: the pile-up and its collision, or the signal collision and
 *  its hard scatter or underlying event. */
const headsOf = ({ collision: c, hard }: Path) =>
  !c.signal
    ? ["pileup", headKey({ kind: "collision", c })]
    : !c.scatter
      ? ["signal"]
      : ["signal", hard ? "scatter" : "underlying"];

/** `s` with `path` unfolded down to its particle: the heads above it, the particles above it, and the list of
 *  particles at no shown level of the node it hides under; `s` itself when all that is open already. */
export function reveal(s: TreeState, path: Path): TreeState {
  const heads = headsOf(path),
    open = path.tops.slice(0, -1),
    under = path.hidden < path.tops.length ? path.tops[path.hidden - 1] : -1;
  if (heads.every((k) => s.heads.get(k)) && open.every((t) => s.folds.get(t)) && (under < 0 || s.below.has(under)))
    return s;
  const below = new Set(s.below);
  if (under >= 0) below.add(under);
  return {
    ...s,
    heads: new Map([...s.heads, ...heads.map((k): [string, boolean] => [k, true])]),
    folds: new Map([...s.folds, ...open.map((t): [number, boolean] => [t, true])]),
    below,
  };
}

const NONE = emptyState();

/** The rows of the tree of `lg` in state `s`: the signal collision, with its hard scatter and underlying event, then
 *  the pile-up and its collisions, under each open one its roots and what is unfolded below them; a folded one lists
 *  nothing. `vertices`: vertex rows between a particle and its daughters. A list shows its first particles or
 *  collisions (LIST, or `s.more`) and those in `keep` (by top: the ways to the picks and to what the search found; a
 *  collision with one of them). `force`: what is open besides, whatever `s` says (the ways to what the search finds,
 *  while it is typed). A particle's list of particles at no shown level shows only while it is unfolded. */
export function treeRows(
  lg: LevelGraph,
  g: Graph,
  s: TreeState,
  vertices: boolean,
  keep: Set<number>,
  force: TreeState = NONE,
): Row[] {
  const P = lg.particles,
    out: Row[] = [];
  // The collisions that hold a kept particle: listed whatever the length of the pile-up's list.
  const kept = new Set<Collision>();
  for (const t of keep) if (lg.nodeOf[t] >= 0) kept.add(P[lg.nodeOf[t]].collision);
  /** The items of list `list` shown (its first ones, unless only `kept` ones are asked for, and those `kept`), and a
   *  "more" entry for the rest. */
  const part = <T>(list: string, items: T[], kept: (x: T) => boolean, first = true) => {
    const n = s.more.get(list) ?? (first ? LIST : 0),
      shown = keep.size ? items.filter((x, k) => k < n || kept(x)) : items.slice(0, n);
    const more: Entry[] =
      shown.length < items.length ? [{ kind: "more", list, left: items.length - shown.length }] : [];
    return { shown, more };
  };
  /** Daughters as entries: particle nodes, then particles at no shown level (by top), each run of those made at one
   *  vertex after a row for it, in the order the vertices first come. */
  const daughters = (nodes: number[], tops: number[] = []): Entry[] => {
    const all: Entry[] = [
      ...nodes.map((node): Entry => ({ kind: "particle", node })),
      ...tops.map((top): Entry => ({ kind: "hidden", top })),
    ];
    if (!vertices) return all;
    const at = new Map<number, Entry[]>(),
      node = new Map<number, number>();
    for (const e of all) {
      const v = e.kind === "particle" ? P[e.node].made : -1,
        row =
          e.kind === "particle"
            ? v >= 0
              ? lg.vertices[v].row
              : -1
            : e.kind === "hidden"
              ? g.col("prodVertexIdx", e.top)
              : -1,
        k = row >= 0 && row < g.nv ? row : -1;
      if (!at.has(k)) at.set(k, []);
      at.get(k)!.push(e);
      if (v >= 0) node.set(k, v);
    }
    return [...at].flatMap(([vertex, es]): Entry[] => [
      ...(vertex >= 0 ? [{ kind: "vertex" as const, vertex, node: node.get(vertex) ?? -1 }] : []),
      ...es,
    ]);
  };
  const hidden = (list: string, tops: number[]): Entry[] => {
    const h = part(list, tops, (t) => keep.has(t));
    return [...daughters([], h.shown), ...h.more];
  };
  /** A collision's roots, or what else a head holds, while it is open; `first`: its first ones too (else only the kept
   *  ones: the head is open only for the search, which opens the way to its matches and not 50 roots of each of up
   *  to 20 collisions). */
  const roots = (list: string, nodes: number[], first: boolean): Entry[] => {
    const r = part(list, nodes, (i) => keep.has(P[i].top), first);
    return [...r.shown.map((node): Entry => ({ kind: "particle", node })), ...r.more];
  };
  const held = (h: Head, list: string, first: boolean): Entry[] => {
    if (h.kind === "pileup") {
      const r = part(list, lg.pileup, (c) => kept.has(c), first);
      return [...r.shown.map((c): Entry => ({ kind: "head", head: { kind: "collision", c } })), ...r.more];
    }
    const c = h.c;
    if (h.kind !== "collision") return roots(list, h.kind === "scatter" ? c.hard : c.rest, first);
    if (!c.scatter) return roots(list, c.rest, first);
    return (["scatter", "underlying"] as const)
      .filter((kind) => (kind === "scatter" ? c.hard : c.rest).length)
      .map((kind): Entry => ({ kind: "head", head: { kind, c } }));
  };
  /** Adds the row of `e` at `place` (`hard`: under the hard scatter); returns the entries listed under it. */
  const add = (e: Entry, place: Place, hard: boolean): Entry[] => {
    if (e.kind === "head") {
      const k = headKey(e.head),
        mine = s.heads.get(k) ?? openHead(e.head),
        open = mine || !!force.heads.get(k);
      out.push({ ...place, ...e, open });
      return open ? held(e.head, k, mine) : [];
    }
    if (e.kind === "particle") {
      const p = P[e.node],
        kids = treeChildren(lg, e.node),
        open = kids.length ? force.folds.get(p.top) || (s.folds.get(p.top) ?? defaultOpen(p, hard)) : undefined,
        below = p.below ? hiddenChildren(g, lg, p.top) : [];
      out.push({ ...place, ...e, open, below: below.length });
      const c = part(`c${p.top}`, open ? kids : [], (i) => keep.has(P[i].top)),
        listed = open !== false && (s.below.has(p.top) || force.below.has(p.top)),
        h = part(`h${p.top}`, listed ? below : [], (t) => keep.has(t));
      return [...daughters(c.shown, h.shown), ...c.more, ...h.more];
    }
    if (e.kind === "hidden") {
      const kids = hiddenChildren(g, lg, e.top),
        open = kids.length ? force.folds.get(e.top) || (s.folds.get(e.top) ?? false) : undefined;
      out.push({ ...place, ...e, open });
      return open ? hidden(`h${e.top}`, kids) : [];
    }
    out.push({ ...place, ...e });
    return [];
  };
  const keyOf = (e: Entry) =>
    e.kind === "head"
      ? headKey(e.head)
      : e.kind === "particle"
        ? `p${P[e.node].top}`
        : e.kind === "hidden"
          ? `h${e.top}`
          : e.kind === "vertex"
            ? `v${e.vertex}`
            : `m${e.list}`;
  const walk = (entries: Entry[], depth: number, rails: boolean[], parent: string, hard: boolean) =>
    entries.forEach((e, k) => {
      const last = k === entries.length - 1,
        key = `${parent}/${keyOf(e)}`,
        under = hard || (e.kind === "head" && (e.head.kind === "scatter" || gunOf(e.head))),
        kids = add(e, { key, depth, rails, last }, hard);
      if (kids.length) walk(kids, depth + 1, depth ? [...rails, !last] : [], key, under);
    });

  const tops: Entry[] = [
    ...(lg.signal ? [{ kind: "head" as const, head: { kind: "collision" as const, c: lg.signal } }] : []),
    ...(lg.pileup.length ? [{ kind: "head" as const, head: { kind: "pileup" as const } }] : []),
  ];
  walk(tops, 0, [], "", false);
  return out;
}
