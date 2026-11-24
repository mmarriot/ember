// The truth graph collapsed to the truth levels chosen in the Truth tab (docs/viewer.md "Truth tab"): one node per
// particle at a shown level (its generator copies folded), the vertices where they were made between them, and the
// particles at no shown level skipped. Built in one pass over the particles per event and choice of levels.
import type { Graph } from "./graph";

/** A level the graph can show: its id, its name, the level-flag bits that put a particle at it (any of them) and what
 *  it means. */
export interface GraphLevel {
  id: string;
  name: string;
  mask: number;
  what: string;
  /** Offered only in an event that has particles at it (a truth preset sets it). */
  optional?: boolean;
}
/** The levels the graph shows, by priority: a particle takes the colour of the first one it is at (levelColour).
 *  "hard process" also takes in the particles its legs came from (t, W⁺: see levelGraph). Not offered: bit 0 (stable
 *  legs of the initial state), bit 5 (the first reconstructable products of the signal process, within
 *  "reconstructable"), bit 6 (the underlying event: a group of the graph, see levelGraph) and bit 7 (parton jets: the
 *  hard-process partons again). */
export const GRAPH_LEVELS: GraphLevel[] = [
  {
    id: "hard",
    name: "hard process",
    mask: 1 << 1,
    what: "the outgoing legs of the hard scatter (HardProcess, bit 1), under the particles they came from (t → b W⁺)",
  },
  {
    id: "signal",
    name: "signal process",
    mask: 1 << 4,
    what: "the particles a truth preset's seeds name (Signal, bit 4)",
    optional: true,
  },
  { id: "bc", name: "b / c hadron", mask: 3 << 8, what: "the weakly decaying hadron of a b or c chain (bits 8, 9)" },
  {
    id: "tau",
    name: "τ visible",
    mask: 3 << 11,
    what: "the visible part of a τ decay: its hadrons, or its lepton (bits 11, 12)",
  },
  {
    id: "reco",
    name: "reconstructable",
    mask: 1 << 10,
    what: "what the detector can see as one object: a π⁰ is one, not two photons; no neutrinos (bit 10)",
  },
  {
    id: "calo",
    name: "entered the calorimeter",
    mask: 1 << 3,
    what: "crossed from the tracker into the calorimeter: it carries the hits of its shower (CaloBoundary, bit 3)",
  },
  {
    id: "gen",
    name: "generator particle",
    mask: 1 << 2,
    what: "stable at generator level: what came out of the collision, before the detector (bit 2)",
  },
];
/** The levels shown by default: all but "entered the calorimeter" and "generator particle". */
export const DEFAULT_LEVELS = GRAPH_LEVELS.filter((l) => l.id !== "calo" && l.id !== "gen").reduce(
  (m, l) => m | l.mask,
  0,
);
const HARD = 1 << 1,
  SIGNAL = 1 << 4;

/** One particle of the level graph: a particle at a shown level, with its generator copies (graph.ts top/last). */
export interface ParticleNode {
  /** Its first copy's row: the node's identity in the graph (graph.ts top). */
  top: number;
  /** Its last copy's row: the one a click selects, whose daughters were made where it ended. */
  last: number;
  /** How many times the generator wrote it (1: once). */
  copies: number;
  /** The level-flag bits of any of its copies, with bit 1 for a particle the hard process's legs came from. */
  levels: number;
  /** Its colour: the index in GRAPH_LEVELS of the first shown level it is at (levelColour). */
  level: number;
  /** The vertex node it was made at (its first copy's production vertex), -1 for none. */
  made: number;
  /** The nearest shown particles above it (particle nodes): through its parent of highest energy first, so the first
   *  is its primary parent (where a tree places it; the others are "also from"). Empty: a root of its group. */
  parents: number[];
  /** The shown particles whose parents it is among (particle nodes), largest energy first. A tree's children of a
   *  node are those whose primary parent it is. */
  children: number[];
  /** The vertex nodes where its children were made. */
  ends: number[];
  /** The particles below it at no shown level with no shown particle between (counted once per particle, its copies
   *  folded): what "▸ N below" offers to show. */
  below: number;
  /** Its group (see Group). */
  group: GroupId;
}
/** A truth vertex where shown particles were made. */
export interface VertexNode {
  /** Its row in the vertex table. */
  row: number;
  /** Why it is there (truth::VertexReason: 2 decay, 11 hadronic inelastic, ...; NaN without the column). The names
   *  are the vertex layer's colour categories (ui/card/chips.tsx categoryNames). */
  reason: number;
  /** The shown particles above it (particle nodes), the first one's primary parent first. Empty for a vertex at the
   *  top (the hard scatter, a pile-up collision). */
  into: number[];
  /** The shown particles made at it (particle nodes), largest energy first. */
  out: number[];
  /** Particles at no shown level lie between `into` and `out` (a b quark's hadronisation, a skipped decay): a particle
   *  made here has a parent at no shown level with a shown particle above it. A parent with nothing shown above it (a
   *  beam remnant in a string) does not count. */
  skips: boolean;
}
/** The graph's groups of roots: the hard process and what came from it; the rest of the signal collision (the
 *  underlying event); the pile-up collisions. */
export type GroupId = "hard" | "underlying" | "pileup";
/** A group: its name and its roots (particle nodes with no shown particle above them), largest energy first. */
export interface Group {
  id: GroupId;
  name: string;
  roots: number[];
}
/** An event's truth graph at the shown levels (levelGraph). Node indices are in the order of the graph (a particle's
 *  parents before it). Its lists are read only: empty ones are one shared, frozen array. */
export interface LevelGraph {
  particles: ParticleNode[];
  vertices: VertexNode[];
  /** The groups that have roots, in the order hard, underlying, pileup. */
  groups: Group[];
  /** For each particle row (any copy): its particle node, -1 if it is at no shown level. */
  nodeOf: Int32Array;
  /** For each particle row at no shown level: the node it is hidden under (its primary nearest shown ancestor), -1
   *  for none (and for a shown particle). Where a UI reveals a particle selected elsewhere (in the view). */
  hiddenUnder: Int32Array;
  /** Per GRAPH_LEVELS level: how many particles of the event are at it, whatever is shown. */
  counts: number[];
}

/** The level of `bits` (a particle's level flags, with HARD added for the particles the legs came from) among the
 *  levels of `mask`: the index of the first GRAPH_LEVELS entry, -1 for none. */
const levelOf = (bits: number, mask: number) => GRAPH_LEVELS.findIndex((l) => bits & l.mask & mask);

/** The empty list every node starts with, shared: frozen, so a change to it fails instead of reaching every node. */
const NONE: number[] = Object.freeze([]) as unknown as number[];

/** The level graph of truth graph `g` at the levels of `mask` (GRAPH_LEVELS bits). `flags`: the particles' level-flags
 *  column; `first`: the column that is 0 for a pile-up particle (isSignal), if any.
 *
 *  - A particle is shown when any of its copies is at a level of `mask`. The hard process is its legs (bit 1) and the
 *    particles they came from (their parents' first copies: t → b W⁺, W⁺ → s̄ c; a Z for its leptons), which no flag
 *    marks.
 *  - Each shown particle hangs from its nearest shown ancestors (every parent path, so a hadron of a string between
 *    a b and an s̄ has both), at the vertex where it was made.
 *  - Groups, from the truth graph alone: "hard" holds the hard process, the signal process (bit 4) and everything
 *    below either; "pileup" every particle whose `first` is 0; "underlying" the rest of the signal collision, which
 *    the generator does not split further (its strings mix initial-state radiation, multiple interactions and the
 *    beam remnants, so a hadron at η 8 and one at η 1 can come from the same string). Bit 6, set by a truth preset,
 *    marks the same particles as stable legs of the underlying event; it is not read. In an event with neither a
 *    hard nor a signal process (a particle gun), "underlying" is the whole signal collision. */
export function levelGraph(g: Graph, flags: string, first: string | undefined, mask: number): LevelGraph {
  const n = g.n,
    top = g.top;
  // The columns read, once each: one typed array per column keeps every read below fast.
  const column = (name: string | undefined) => {
    const c = name === undefined ? undefined : g.column(name),
      out = new Float64Array(n).fill(NaN);
    if (c) for (let r = 0; r < n; r++) out[r] = Number(c[r]);
    return out;
  };
  const energy = column("energy"),
    made = column("prodVertexIdx"),
    signal = column(first),
    flag = column(flags);
  // A particle's level flags: those of any of its copies, kept at its first copy's row.
  const lv = new Uint32Array(n);
  for (let r = 0; r < n; r++) lv[top[r]] |= flag[r] | 0;
  // The hard process: the legs, and the particles they came from.
  const legs: number[] = [];
  for (let r = 0; r < n; r++) if (top[r] === r && lv[r] & HARD) legs.push(r);
  for (const r of legs) for (const p of g.parents(r)) lv[top[p]] |= HARD;
  const counts = GRAPH_LEVELS.map(() => 0),
    level = new Int8Array(n).fill(-1);
  let hardEvent = false,
    signalEvent = false;
  for (let r = 0; r < n; r++) {
    if (top[r] !== r || !lv[r]) continue;
    for (let i = 0; i < GRAPH_LEVELS.length; i++) if (lv[r] & GRAPH_LEVELS[i].mask) counts[i]++;
    level[r] = levelOf(lv[r], mask);
    hardEvent ||= !!(lv[r] & HARD);
    signalEvent ||= !!(lv[r] & SIGNAL);
  }
  const shown = (t: number) => level[t] >= 0;

  // One pass down the graph (Kahn's order over rows): for each particle (at its first copy), its nearest shown
  // ancestors, primary first, and whether it comes from the hard or signal process. The arrays are shared between
  // particles (never changed once made): a shown particle's own, [t], is made once.
  const above: number[][] = new Array(n),
    own: number[][] = new Array(n),
    fromTop = new Uint8Array(n),
    order: number[] = [], // the first copies, in that order
    waiting = new Int32Array(n);
  /** What a particle passes down to its children: itself if shown, else its own nearest shown ancestors. */
  const passed = (p: number) => {
    const t = top[p];
    return shown(t) ? (own[t] ??= [t]) : (above[t] ?? NONE);
  };
  const visit = (r: number) => {
    if (top[r] !== r) return;
    order.push(r);
    const ps = g.parents(r);
    fromTop[r] = lv[r] & (HARD | SIGNAL) ? 1 : 0;
    for (const p of ps) fromTop[r] |= fromTop[top[p]];
    if (ps.length === 1) above[r] = passed(ps[0]);
    else if (!ps.length) above[r] = NONE;
    else {
      const out: number[] = [];
      for (const p of [...ps].sort((a, b) => energy[b] - energy[a]))
        for (const a of passed(p)) if (!out.includes(a)) out.push(a);
      above[r] = out;
    }
  };
  const todo: number[] = [];
  for (let r = 0; r < n; r++) if (!(waiting[r] = g.parents(r).length)) todo.push(r);
  for (let k = 0; k < todo.length; k++) {
    const r = todo[k];
    visit(r);
    for (const c of g.children(r)) if (--waiting[c] === 0) todo.push(c);
  }
  if (todo.length < n) for (let r = 0; r < n; r++) if (waiting[r] > 0) visit(r); // a loop (bad data): as they come

  // The nodes, in that order. Empty lists are the one shared NONE until something is added.
  const nodeOf = new Int32Array(n).fill(-1),
    particles: ParticleNode[] = [];
  for (const r of order)
    if (shown(r))
      nodeOf[r] =
        particles.push({
          top: r,
          last: g.last[r],
          copies: 0,
          levels: lv[r],
          level: level[r],
          made: -1,
          parents: NONE,
          children: NONE,
          ends: NONE,
          below: 0,
          group: signal[r] === 0 ? "pileup" : fromTop[r] ? "hard" : "underlying",
        }) - 1;
  // Their parents once every node is made: a loop of parents (bad data) visits a particle before its parent.
  for (const p of particles)
    if (above[p.top].length) p.parents = above[p.top].filter((a) => a !== p.top).map((a) => nodeOf[a]);
  const hiddenUnder = new Int32Array(n).fill(-1);
  for (let r = 0; r < n; r++) {
    const t = top[r];
    if (shown(t)) {
      nodeOf[r] = nodeOf[t];
      particles[nodeOf[t]].copies++;
    } else {
      hiddenUnder[r] = above[t]?.length ? nodeOf[above[t][0]] : -1;
      if (t === r) for (const a of above[r] ?? NONE) particles[nodeOf[a]].below++;
    }
  }

  // The edges, with the vertex each particle was made at between.
  const vertices: VertexNode[] = [],
    vertexOf = new Map<number, number>();
  const add = (list: number[], x: number) => (list === NONE ? [x] : (list.push(x), list));
  particles.forEach((p, i) => {
    for (const a of p.parents) particles[a].children = add(particles[a].children, i);
    const v = made[p.top];
    if (!(v >= 0 && v < g.nv)) return; // no vertex, or one outside the vertex table
    let k = vertexOf.get(v);
    if (k === undefined) {
      vertexOf.set(v, (k = vertices.length));
      vertices.push({ row: v, reason: g.vcol("reason", v), into: [], out: [], skips: false });
    }
    const vx = vertices[k];
    p.made = k;
    vx.out.push(i);
    for (const a of p.parents) {
      if (!vx.into.includes(a)) vx.into.push(a);
      if (!particles[a].ends.includes(k)) particles[a].ends = add(particles[a].ends, k);
    }
    // a hidden parent with a shown ancestor lies between that ancestor (one of `into`) and this particle
    vx.skips ||= g.parents(p.top).some((q) => !shown(top[q]) && above[top[q]]?.length > 0);
  });
  const nodeEnergy = Float64Array.from(particles, (p) => energy[p.top]),
    byEnergy = (a: number, b: number) => nodeEnergy[b] - nodeEnergy[a];
  for (const p of particles) if (p.children.length > 1) p.children.sort(byEnergy);
  for (const v of vertices) if (v.out.length > 1) v.out.sort(byEnergy);

  const names: Record<GroupId, string> = {
    hard: hardEvent ? "hard process" : "signal process",
    underlying: hardEvent || signalEvent ? "underlying event" : "signal collision",
    pileup: "pile-up",
  };
  const roots: Record<GroupId, number[]> = { hard: [], underlying: [], pileup: [] };
  particles.forEach((p, i) => {
    if (!p.parents.length) roots[p.group].push(i);
  });
  const groups = (["hard", "underlying", "pileup"] as const)
    .filter((id) => roots[id].length)
    .map((id) => ({ id, name: names[id], roots: roots[id].sort(byEnergy) }));
  return { particles, vertices, groups, nodeOf, hiddenUnder, counts };
}
