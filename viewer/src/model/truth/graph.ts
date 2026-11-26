// The truth graph (particles, their parents and children, their vertices) and the physics read from it: copies,
// brem, conversions, decays (owner decision D1, docs/truth.md "Physics from the graph").
import type { EventData, Header } from "../../io/format";
import { endsAtBoundary } from "./ends";

/** One event's truth particles and vertices, from the truth graph's tables (docs/truth-graph.md). Missing columns
 *  read as NaN. A particle's `decayVertexIdx` is only the latest vertex where its kept daughters were made, and its
 *  children are those of all of them: what happened where is read from each child's own production vertex. */
export interface Graph {
  n: number;
  nv: number; // vertices (0 without the vertex table)
  col: (name: string, r: number) => number; // a particle's column
  /** A particle column as stored, for code that reads it for every particle (truth/levelGraph.ts). */
  column: (name: string) => ArrayLike<number | bigint> | undefined;
  vcol: (name: string, v: number) => number; // a vertex's column (NaN without the vertex table)
  children: (r: number) => number[];
  parents: (r: number) => number[];
  /** The particles a vertex produced (their production vertex is it). */
  outOf: (v: number) => number[];
  /** The particle that made the particles of vertex `v` (the parent of the first of them), -1 for none. */
  into: (v: number) => number;
  /** The first and the last of a particle's generator copies (copiesBelow), worked out once per event. */
  top: Int32Array;
  last: Int32Array;
}

/** The graph of `particles`, their parent -> child relation `children` and their `vertices`. Built once per event
 *  (store/colours.ts truthGraph). */
export function graphOf(
  particles: { n: number; columns: Record<string, ArrayLike<number | bigint>> },
  children: { offsets: ArrayLike<number>; indices: ArrayLike<number> } | undefined,
  vertices?: { n: number; columns: Record<string, ArrayLike<number | bigint>> },
): Graph {
  const n = particles.n,
    kids: number[][] = Array.from({ length: n }, () => []),
    pars: number[][] = Array.from({ length: n }, () => []);
  if (children)
    for (let f = 0; f < n && f + 1 < children.offsets.length; f++)
      for (let k = children.offsets[f]; k < children.offsets[f + 1]; k++) {
        const c = children.indices[k];
        if (c < n) {
          kids[f].push(c);
          pars[c].push(f);
        }
      }
  const col = (name: string, r: number) => {
    const c = particles.columns[name];
    return c && r >= 0 && r < n ? Number(c[r]) : NaN;
  };
  const nv = vertices?.n ?? 0,
    out: number[][] = Array.from({ length: nv }, () => []);
  for (let r = 0; r < n; r++) {
    const p = col("prodVertexIdx", r);
    if (p >= 0 && p < nv) out[p].push(r);
  }
  // Generator copies: a particle's copy is its only child of the same pdgId. One pass down from each top.
  const down = new Int32Array(n).fill(-1),
    up = new Int32Array(n).fill(-1);
  for (let r = 0; r < n; r++) {
    const same = kids[r].filter((c) => col("pdgId", c) === col("pdgId", r));
    // A generator particle only (status > 0): a Geant4 particle's same-kind child is a new particle (a delta ray).
    if (same.length === 1 && pars[same[0]].length === 1 && col("status", same[0]) > 0) {
      down[r] = same[0];
      up[same[0]] = r;
    }
  }
  const top = new Int32Array(n).fill(-1),
    last = new Int32Array(n).fill(-1);
  for (let r = 0; r < n; r++) {
    if (up[r] >= 0) continue;
    const chain = [r];
    for (let k = down[r], steps = 0; k >= 0 && steps < n; k = down[k], steps++) chain.push(k);
    for (const k of chain) {
      top[k] = r;
      last[k] = chain.at(-1)!;
    }
  }
  for (let r = 0; r < n; r++) if (top[r] < 0) top[r] = last[r] = r; // a loop of copies (bad data): each on its own
  return {
    n,
    nv,
    col,
    column: (name) => particles.columns[name],
    vcol: (name, v) => {
      const c = vertices?.columns[name];
      return c && v >= 0 && v < nv ? Number(c[v]) : NaN;
    },
    children: (r) => kids[r] ?? [],
    parents: (r) => pars[r] ?? [],
    outOf: (v) => out[v] ?? [],
    into: (v) => {
      const c = out[v]?.[0];
      return c === undefined ? -1 : (pars[c]?.[0] ?? -1);
    },
    top,
    last,
  };
}

const NEUTRINOS = new Set([12, 14, 16]);
/** Geant4 / generator vertex reasons (truth::VertexReason) that the summaries below read. */
export const REASON = { decay: 2, brem: 3, conversion: 5, hadronicInelastic: 11, hadronization: 19 } as const;

/** A distance in cm in a sensible unit: "12 µm", "0.74 mm", "26.3 cm". */
export function length(cm: number) {
  const a = Math.abs(cm),
    f = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(3));
  return a < 0.1 ? `${f(cm * 1e4)} µm` : a < 1 ? `${f(cm * 10)} mm` : `${f(cm)} cm`;
}

/** The generator copies of particle `r`, top first, `r` included: the generator writes a particle again at each of
 *  its steps (μ⁺ status 23 -> 51 -> 51 -> 1), sometimes beside a photon it radiates (τ 23 -> τ 2 + γ). */
export function copiesBelow(g: Graph, r: number): number[] {
  const out = [r];
  for (let k = r, steps = 0; k !== g.last[r] && steps < g.n; steps++) {
    k = g.children(k).find((c) => g.top[c] === g.top[r] && c !== k)!;
    if (k === undefined) break;
    out.push(k);
  }
  return out;
}
/** Every particle above `r` in the graph (its parents, theirs, ...: generator copies included). */
export function ancestorsOf(g: Graph, r: number): Set<number> {
  const out = new Set<number>(),
    todo = [r];
  while (todo.length)
    for (const q of g.parents(todo.pop()!))
      if (!out.has(q)) {
        out.add(q);
        todo.push(q);
      }
  return out;
}
/** Whether particles `a` and `b` are one line of the graph: one is above the other (or they are the same). */
export const sameLine = (g: Graph, a: number, b: number) =>
  a === b || ancestorsOf(g, a).has(b) || ancestorsOf(g, b).has(a);
/** The generator's internals: quarks, gluons, generator codes (81-100), diquarks (e.g. 2101). */
export function isParton(pdgId: number) {
  const id = Math.abs(pdgId);
  return id <= 8 || id === 21 || (id >= 81 && id <= 100) || (id > 1000 && id < 6000 && Math.floor(id / 10) % 10 === 0);
}

/** The ancestors of truth particle `row` named in its card's crumb ("t → W⁻ → e⁻"), oldest first, each by its first
 *  copy, `null` where some are left out: those of the hard process (`hard`: a leg; also the particle a leg came from,
 *  as the Truth tab's tree counts them), and up to `near` nearest ones, up to the first parton of the generator. By
 *  first parents (a hadron from a string follows the parton it hangs under in the tree). */
export function crumbOf(g: Graph, row: number, hard: (r: number) => boolean, near = 3): (number | null)[] {
  const up: number[] = [];
  for (let r = g.top[row], seen = new Set<number>([r]); ; ) {
    const p = g.parents(r)[0];
    if (p === undefined || seen.has(g.top[p])) break;
    r = g.top[p];
    seen.add(r);
    up.push(r);
  }
  const isHard = (a: number) => hard(a) || g.children(g.last[a]).some(hard);
  const keep = new Set<number>();
  for (const a of up) {
    if (isParton(g.col("pdgId", a)) || isHard(a) || keep.size === near) break;
    keep.add(a);
  }
  for (const a of up) if (isHard(a)) keep.add(a);
  const out: (number | null)[] = [];
  let gap = false;
  for (let i = up.length - 1; i >= 0; i--)
    if (keep.has(up[i])) {
      if (gap && out.length) out.push(null);
      out.push(up[i]);
      gap = false;
    } else gap = true;
  if (gap && out.length) out.push(null);
  return out;
}
/** The top of `r`'s generator copies (see copiesBelow). */
export const topCopy = (g: Graph, r: number) => g.top[r];
/** The vertex particle `r` (a last copy) ended at: its decayVertexIdx, but -1 for an e± or γ whose last vertex is no
 *  earlier than where it entered the calorimeter, a vertex of its shower: its line ends at the calorimeter
 *  (truth/ends.ts). */
export function endVertex(g: Graph, r: number) {
  const v = g.col("decayVertexIdx", r);
  return endsAtBoundary(g.col("pdgId", r), g.col("hasBoundary", r), g.col("boundaryT", r), g.vcol("t", v)) ? -1 : v;
}
/** What the view draws of the truth for picked particles `rows` (the Truth tab's picks): each one's generator copies,
 *  the vertex it was made at (its first copy's production vertex) and the one it ended at (endVertex); with `descendants`, the same for every particle below them (the children of all their copies). */
export function drawnRows(g: Graph, rows: number[], descendants: boolean) {
  const particles = new Set<number>(),
    vertices = new Set<number>(),
    todo = rows.map((r) => g.top[r]);
  const vertex = (v: number) => {
    if (v >= 0 && v < g.nv) vertices.add(v);
  };
  while (todo.length) {
    const t = g.top[todo.pop()!];
    if (particles.has(t)) continue;
    const copies = copiesBelow(g, t);
    for (const r of copies) particles.add(r);
    vertex(g.col("prodVertexIdx", t));
    vertex(endVertex(g, copies.at(-1)!));
    if (descendants) for (const r of copies) for (const c of g.children(r)) if (g.top[c] !== t) todo.push(c);
  }
  return { particles, vertices };
}

/** The straight-line distance (cm) from particle `r`'s first copy's production vertex to its last copy's
 *  decayVertexIdx, the last vertex with daughters (not necessarily where it stopped). 0 for a parton of the hard
 *  process, made and ended at the collision; NaN without both vertices. */
export function vertexDistance(g: Graph, r: number) {
  const p = g.col("prodVertexIdx", g.top[r]),
    e = g.col("decayVertexIdx", g.last[r]);
  if (!(p >= 0 && e >= 0)) return NaN;
  return Math.hypot(...["x", "y", "z"].map((c) => g.vcol(c, e) - g.vcol(c, p)));
}

/** A chain of particles (top first, each the parent of the next) in groups of generator copies. */
export function foldCopies(g: Graph, chain: number[]): number[][] {
  const out: number[][] = [];
  for (const r of chain) {
    const prev = out.at(-1);
    if (prev && g.top[prev[0]] === g.top[r]) prev.push(r);
    else out.push([r]);
  }
  return out;
}

/** The vertices where particle `r`'s last copy made its daughters, with their reason, in the file's (time) order. */
export function daughterVertices(g: Graph, r: number): { vertex: number; reason: number }[] {
  const seen = new Set<number>(),
    out: { vertex: number; reason: number }[] = [];
  for (const c of g.children(g.last[r])) {
    const v = g.col("prodVertexIdx", c);
    if (v >= 0 && !seen.has(v)) {
      seen.add(v);
      out.push({ vertex: v, reason: g.vcol("reason", v) });
    }
  }
  return out;
}

/** An electron's bremsstrahlung before the calorimeter (docs/truth.md "Physics from the graph"): the photons its last
 *  copy radiated (at a vertex of reason brem) before the time of its boundary checkpoint (later ones are its shower's)
 *  that the graph keeps, their summed energy and the radii where they were radiated, and its energy and place where it
 *  reached the calorimeter. So E = ΣE + E at the calorimeter, but for ionisation and the softest photons. Undefined
 *  for another particle. */
export function bremOf(g: Graph, r: number) {
  if (Math.abs(g.col("pdgId", r)) !== 11) return undefined;
  const last = g.last[r],
    reached = !!g.col("hasBoundary", last),
    boundaryT = reached ? g.col("boundaryT", last) : NaN,
    photons = g.children(last).filter((c) => {
      const v = g.col("prodVertexIdx", c);
      return g.col("pdgId", c) === 22 && g.vcol("reason", v) === REASON.brem && !(g.vcol("t", v) >= boundaryT);
    });
  const radii = photons
    .map((c) => g.col("prodVertexIdx", c))
    .map((v) => Math.hypot(g.vcol("x", v), g.vcol("y", v)))
    .filter(Number.isFinite);
  return {
    count: photons.length,
    photons,
    energy: photons.reduce((s, c) => s + g.col("energy", c), 0),
    rMin: radii.length ? Math.min(...radii) : NaN,
    rMax: radii.length ? Math.max(...radii) : NaN,
    atCalo: reached ? g.col("boundaryE", last) : NaN,
    atR: reached ? Math.hypot(g.col("boundaryX", last), g.col("boundaryY", last)) : NaN,
    atZ: reached ? g.col("boundaryZ", last) : NaN,
  };
}

/** A photon's conversion: where (R, z), and the electrons made at that vertex (not a Compton electron made earlier).
 *  A conversion at or after the time of its boundary checkpoint is its shower's start: `showered`, no products. Also
 *  whether it reached the calorimeter, its parent if a π⁰, and its sister photons. Undefined for another particle. */
export function conversionOf(g: Graph, r: number) {
  if (g.col("pdgId", r) !== 22) return undefined;
  const last = g.last[r],
    v = daughterVertices(g, r).find((d) => d.reason === REASON.conversion)?.vertex ?? -1,
    showered = v >= 0 && !!g.col("hasBoundary", last) && !(g.vcol("t", v) < g.col("boundaryT", last)),
    converted = v >= 0 && !showered;
  const top = g.top[r],
    parent = g.parents(top).length === 1 ? g.parents(top)[0] : -1,
    pi0 = parent >= 0 && g.col("pdgId", parent) === 111 ? parent : -1;
  return {
    converted,
    showered,
    r: v >= 0 ? Math.hypot(g.vcol("x", v), g.vcol("y", v)) : NaN,
    z: v >= 0 ? g.vcol("z", v) : NaN,
    products: converted
      ? g.children(last).filter((c) => Math.abs(g.col("pdgId", c)) === 11 && g.col("prodVertexIdx", c) === v)
      : [],
    reachedCalo: !!g.col("hasBoundary", last),
    pi0,
    sisters: pi0 >= 0 ? g.children(pi0).filter((c) => c !== top && g.col("pdgId", c) === 22) : [],
  };
}

/** A τ's decay, from its last copy's children (a photon radiated beside an earlier copy is not a product), and its
 *  visible energy (all but the neutrinos'). Undefined for another particle, or a τ with no decay kept. */
export function tauDecayOf(g: Graph, r: number) {
  if (Math.abs(g.col("pdgId", r)) !== 15) return undefined;
  const last = g.last[r], // the τ that decays
    products = g.children(last);
  if (!products.length) return undefined;
  const visible = products.filter((c) => !NEUTRINOS.has(Math.abs(g.col("pdgId", c))));
  return { last, products, visibleE: visible.reduce((s, c) => s + g.col("energy", c), 0) };
}

/** A particle's decay vertex: where its last copy's daughters were made by a decay, -1 for none. */
export const decayVertexOf = (g: Graph, r: number) =>
  daughterVertices(g, r).find((d) => d.reason === REASON.decay)?.vertex ?? -1;

/** A particle's flight from its production to its decay vertex, 3D and transverse (cm); undefined without both. */
export function flightOf(g: Graph, r: number) {
  const p = g.col("prodVertexIdx", g.top[r]),
    e = decayVertexOf(g, r);
  if (!(p >= 0) || e < 0) return undefined;
  const d = ["x", "y", "z"].map((c) => g.vcol(c, e) - g.vcol(c, p));
  if (!d.every(Number.isFinite)) return undefined;
  return { l3d: Math.hypot(d[0], d[1], d[2]), lxy: Math.hypot(d[0], d[1]), vertex: e };
}

/** The reco vertices CMSSW's vertex associator matches to a b or c hadron's decay, and to those of the b and c
 *  hadrons below it (a B -> D cascade), with their completeness, best first (docs/truth.md "Physics from the graph").
 *  Read through the truth -> reco vertex association whose reverse matches decay vertices (`match.target`
 *  "decayVertex"); `associator` false without one. `flags`: the particles' level-flags column. */
export function decayVertexMatches(
  ev: EventData,
  header: Header,
  g: Graph,
  vertices: string,
  row: number,
  flags: string,
) {
  const back = Object.values(header.relations).find(
    (r) => r.association && r.to === vertices && r.match?.target === "decayVertex",
  );
  const rel = back
    ? Object.entries(header.relations).find(
        ([name, r]) =>
          r.association && r.from === vertices && r.to === back.from && r.match?.completeness && ev.relations[name],
      )
    : undefined;
  if (!rel) return { associator: false, matches: [] };
  const [name, info] = rel,
    csr = ev.relations[name],
    w = csr.weights[info.match!.completeness!.weight],
    hadron = (r: number) => (g.col(flags, r) >>> 8) & 3; // bit 8 b hadron, bit 9 c hadron
  const vs: number[] = [];
  for (let todo = [row], seen = new Set([row]); todo.length && seen.size < 500; ) {
    const r = todo.shift()!;
    if (hadron(r) || r === row) {
      const v = decayVertexOf(g, r);
      if (v >= 0 && !vs.includes(v)) vs.push(v);
    }
    for (const c of g.children(g.last[r]))
      if (!seen.has(c)) {
        seen.add(c);
        todo.push(c);
      }
  }
  const matches: { vertex: number; table: string; row: number; completeness: number }[] = [];
  for (const v of vs)
    for (let k = csr.offsets[v]; k < (csr.offsets[v + 1] ?? k); k++)
      matches.push({ vertex: v, table: info.to, row: csr.indices[k], completeness: w ? w[k] : NaN });
  return { associator: true, matches: matches.sort((a, b) => b.completeness - a.completeness) };
}

/** A truth vertex in words: the particle that made its particles, its reason, and the charged particles the graph
 *  keeps from it ("B⁰ decay · 3 charged"). `reasons`: the reasons' names (the vertex layer's categories). */
export function vertexText(g: Graph, v: number, name: (r: number) => string, reasons: Record<string, string>) {
  // A hadronization joins a string of partons: the first of them (often a gluon) does not name it.
  const r = g.vcol("reason", v) === REASON.hadronization ? -1 : g.into(v),
    reason = reasons[String(g.vcol("reason", v))] ?? "vertex",
    charged = g.outOf(v).filter((c) => g.col("charge", c) !== 0 && Number.isFinite(g.col("charge", c))).length;
  return `${r >= 0 ? `${name(r)} ` : ""}${reason}${charged ? ` · ${charged} charged` : ""}`;
}
