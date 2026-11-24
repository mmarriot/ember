// The level graph as the rows of a tree (TreeView.tsx): each particle under its primary parent, the vertices its
// daughters were made at between them, and, when asked ("▸ N below"), the particles at no shown level under a node.
// Only what is unfolded is listed, and a long list in parts, so the rows stay few at any pile-up.
import { copiesBelow, type Graph } from "../../../model/truth/graph";
import {
  GRAPH_LEVELS,
  type Group,
  type GroupId,
  type LevelGraph,
  type ParticleNode,
} from "../../../model/truth/levelGraph";

/** How many particles a list shows at first, and how many more each "show more" adds. */
export const LIST = 50;

/** What is folded and listed: the tree's display state. Particles by their first copy's row (graph.ts top). */
export interface TreeState {
  /** Groups folded or unfolded by hand; else the hard process is open and the others folded. */
  groups: Partial<Record<GroupId, boolean>>;
  /** Particles folded or unfolded by hand; else defaultOpen (a particle at no shown level: folded). */
  folds: Map<number, boolean>;
  /** Particles whose particles at no shown level are listed under them ("▸ N below"). */
  below: Set<number>;
  /** How many particles a list shows (by Row "more" list), when not LIST. */
  more: Map<string, number>;
}
export const emptyState = (): TreeState => ({ groups: {}, folds: new Map(), below: new Set(), more: new Map() });

/** Where a row sits: its depth; for each ancestor level, whether the line joining that level's siblings passes beside
 *  it (`rails[d]` for depth d + 1); whether it is the last of its siblings (its own line stops at it). */
export interface Place {
  key: string;
  depth: number;
  rails: boolean[];
  last: boolean;
}
/** A row of the tree. `open` is undefined for a particle with nothing to fold. A vertex row stands on the line of the
 *  daughters made at it, which follow it. "more": the rest of list `list`, `left` particles. */
export type Row =
  | { kind: "group"; key: string; group: Group; open: boolean; size: number }
  | (Place & { kind: "particle"; node: number; open?: boolean })
  | (Place & { kind: "hidden"; top: number; open?: boolean })
  | (Place & { kind: "vertex"; vertex: number })
  | (Place & { kind: "more"; list: string; left: number });

type Entry =
  | { kind: "particle"; node: number }
  | { kind: "hidden"; top: number }
  | { kind: "vertex"; vertex: number }
  | { kind: "more"; list: string; left: number };

const RECO = GRAPH_LEVELS.findIndex((l) => l.id === "reco");
/** A particle is unfolded by default in the hard process, down to its b / c hadrons and τ (the levels above
 *  "reconstructable"); the rest is folded. */
export const defaultOpen = (p: ParticleNode) => p.group === "hard" && p.level < RECO;

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

/** The way down the tree to a particle: the particles (by top) from its root, the shown ones first (`tops[0 ..
 *  hidden - 1]`), then for a particle at no shown level, those at no shown level from below the node it hides under.
 *  As the level graph places it, each climbs through its parent of highest energy that is shown or has a shown
 *  particle above it (not a dead end such as a beam remnant's string). */
export interface Path {
  group: GroupId;
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
  for (let i = lg.nodeOf[t]; i >= 0 && tops.length <= P.length; i = P[i].parents[0] ?? -1) tops.unshift(P[i].top);
  return { group: P[lg.nodeOf[t]].group, tops: [...tops, ...chain], hidden: tops.length };
}

/** `s` with `path` unfolded down to its particle: its group, the particles above it, and the list of particles at no
 *  shown level of the node it hides under. */
export function reveal(s: TreeState, path: Path): TreeState {
  const folds = new Map(s.folds),
    below = new Set(s.below);
  path.tops.slice(0, -1).forEach((t, k) => (k === path.hidden - 1 ? below.add(t) : folds.set(t, true)));
  return { ...s, groups: { ...s.groups, [path.group]: true }, folds, below };
}

/** The rows of the tree of `lg` in state `s`: the groups, and under each open one its roots and what is unfolded
 *  below them. `vertices`: vertex rows between a particle and its daughters. A list shows its first particles (LIST,
 *  or `s.more`) and those in `keep` (by top: the ways to the picks and to what the search found). */
export function treeRows(lg: LevelGraph, g: Graph, s: TreeState, vertices: boolean, keep: Set<number>): Row[] {
  const P = lg.particles,
    out: Row[] = [];
  /** The particles of list `list` shown, and a "more" entry for the rest. */
  const part = (list: string, items: number[], top: (x: number) => number) => {
    const n = s.more.get(list) ?? LIST,
      shown = items.filter((x, k) => k < n || keep.has(top(x)));
    const more: Entry[] =
      shown.length < items.length ? [{ kind: "more", list, left: items.length - shown.length }] : [];
    return { shown, more };
  };
  /** Particle nodes as entries, each run of those made at one vertex after a row for it. */
  const daughters = (nodes: number[]): Entry[] => {
    if (!vertices) return nodes.map((node) => ({ kind: "particle", node }));
    const at = new Map<number, number[]>();
    for (const i of nodes) {
      const k = P[i].made;
      if (!at.has(k)) at.set(k, []);
      at.get(k)!.push(i);
    }
    return [...at].flatMap(([vertex, is]): Entry[] => [
      ...(vertex >= 0 ? [{ kind: "vertex" as const, vertex }] : []),
      ...is.map((node) => ({ kind: "particle" as const, node })),
    ]);
  };
  const hidden = (list: string, tops: number[]): Entry[] => {
    const h = part(list, tops, (t) => t);
    return [...h.shown.map((top): Entry => ({ kind: "hidden", top })), ...h.more];
  };
  /** Adds the row of `e` at `place`; returns the entries listed under it. */
  const add = (e: Entry, place: Place): Entry[] => {
    if (e.kind === "particle") {
      const p = P[e.node],
        kids = treeChildren(lg, e.node),
        open = kids.length ? (s.folds.get(p.top) ?? defaultOpen(p)) : undefined;
      out.push({ ...place, ...e, open });
      const c = part(`c${p.top}`, open ? kids : [], (i) => P[i].top);
      const below = p.below && s.below.has(p.top) ? hiddenChildren(g, lg, p.top) : [];
      return [...daughters(c.shown), ...c.more, ...hidden(`h${p.top}`, below)];
    }
    if (e.kind === "hidden") {
      const kids = hiddenChildren(g, lg, e.top),
        open = kids.length ? (s.folds.get(e.top) ?? false) : undefined;
      out.push({ ...place, ...e, open });
      return open ? hidden(`h${e.top}`, kids) : [];
    }
    out.push({ ...place, ...e });
    return [];
  };
  const keyOf = (e: Entry) =>
    e.kind === "particle"
      ? `p${P[e.node].top}`
      : e.kind === "hidden"
        ? `h${e.top}`
        : e.kind === "vertex"
          ? `v${e.vertex}`
          : `m${e.list}`;
  const walk = (entries: Entry[], depth: number, rails: boolean[], parent: string) =>
    entries.forEach((e, k) => {
      const last = k === entries.length - 1,
        key = `${parent}/${keyOf(e)}`,
        kids = add(e, { key, depth, rails, last });
      if (kids.length) walk(kids, depth + 1, depth ? [...rails, !last] : [], key);
    });

  const size: Partial<Record<GroupId, number>> = {};
  for (const p of P) size[p.group] = (size[p.group] ?? 0) + 1;
  for (const group of lg.groups) {
    const open = s.groups[group.id] ?? group.id === "hard";
    out.push({ kind: "group", key: group.id, group, open, size: size[group.id] ?? 0 });
    if (!open) continue;
    const r = part(`g${group.id}`, group.roots, (i) => P[i].top);
    walk([...r.shown.map((node): Entry => ({ kind: "particle", node })), ...r.more], 0, [], group.id);
  }
  return out;
}
