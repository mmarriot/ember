// What the truth graph says, in words: the truth levels (truth::LevelFlag bits), the levels the truth colours can
// group by, the graph's own physics (copies, brem, conversions, decays: owner decision D1, docs/truth.md "Physics
// from the graph"), the truth search, and the particles in a view. No store: the UI and the colours share them.
import type { EventData, Header } from "../io/format";
import { facts } from "./facts";
import { completeness } from "./match";
import { comparedKind, truthToReco } from "./pair";
import { bestPartners } from "./relations";

/** A truth level: its bit in the particles' level flags (SimDataFormats/TruthInfo ParticleData.h truth::LevelFlag), its
 *  plain name, the flag's own name (for experts) and what it means. */
export interface Level {
  bit: number;
  name: string;
  flag: string;
  what: string;
}
/** The levels shown on a particle (its tags) and offered as search chips, in the order of the flags. Bit 0 (stable legs
 *  of the initial state), 4 (signal: the `first` column says it), 5 (reconstructable from the signal) and 6 (the
 *  underlying event) are not shown: they repeat what the signal flag and bit 10 say. */
export const LEVELS: Level[] = [
  {
    bit: 1,
    name: "hard process",
    flag: "HardProcess",
    what: "an outgoing leg of the hard scatter (b, W decay products)",
  },
  {
    bit: 2,
    name: "generator particle",
    flag: "StableDecayProducts",
    what: "stable at generator level: what came out of the collision, before the detector",
  },
  {
    bit: 3,
    name: "entered the calorimeter",
    flag: "CaloBoundary",
    what: "crossed from the tracker into the calorimeter: it carries the hits of its shower",
  },
  { bit: 7, name: "parton jet", flag: "PartonJets", what: "a hard-process parton, standing for everything below it" },
  { bit: 8, name: "b hadron", flag: "BHadrons", what: "the weakly decaying hadron of a b chain" },
  { bit: 9, name: "c hadron", flag: "CHadrons", what: "the weakly decaying hadron of a c chain" },
  {
    bit: 10,
    name: "reconstructable",
    flag: "ReconstructableFinalState",
    what: "what the detector can see as one object (a π⁰ is one, not two photons; no neutrinos)",
  },
  { bit: 11, name: "τ visible (hadronic)", flag: "TauVisibleHadronic", what: "the visible part of a hadronic τ decay" },
  { bit: 12, name: "τ visible (leptonic)", flag: "TauVisibleLeptonic", what: "the lepton of a leptonic τ decay" },
];

/** A level the truth colours can group the particles by: its plain name, the flags' names, and the bits (any of them
 *  set makes a particle a member). */
export interface ColourLevel {
  name: string;
  flag: string;
  mask: number;
  only?: boolean; // only the level's particles take colours (the rest grey)
}
/** The levels offered in the colour key's picker. */
export const COLOUR_LEVELS: ColourLevel[] = [
  { name: "generator particle", flag: "bit 2, StableDecayProducts", mask: 1 << 2 },
  { name: "entered the calorimeter", flag: "bit 3, CaloBoundary", mask: 1 << 3 },
  { name: "reconstructable", flag: "bit 10, ReconstructableFinalState", mask: 1 << 10 },
  { name: "b / c hadron", flag: "bits 8, 9, BHadrons, CHadrons", mask: (1 << 8) | (1 << 9), only: true },
];
/** The colour level of `mask` (one of COLOUR_LEVELS, else named after its bits). */
export function colourLevel(mask: number): ColourLevel {
  const known = COLOUR_LEVELS.find((l) => l.mask === mask);
  if (known) return known;
  const bits = [...Array(32).keys()].filter((b) => (mask >>> b) & 1);
  return { name: `bit ${bits.join(", ")}`, flag: `bit ${bits.join(", ")}`, mask };
}

/** The rule the truth colours give their slots by (model/relations.ts identities), as the colour key's title says it:
 *  - `selection`: the particles the selection and its parts are matched to or hold simulated energy in, first;
 *  - `by`: then the rest by simulated energy in one detector of the domain (`in`: the domain, `detectors`: those it
 *    has), by pT among the particles the domain's reco objects are matched to, or by pT among the signal particles. */
export interface SlotRule {
  selection: boolean;
  by: "simEnergy" | "matchedPt" | "pt" | "size";
  in?: string;
  detectors?: string[];
  column?: string; // "size": the layer's colour column
}
/** The key's title for a rule: "top 7 by simulated energy in HGCal". */
export function ruleText(rule: SlotRule, slots: number) {
  const rest =
    rule.by === "simEnergy"
      ? rule.detectors && rule.detectors.length > 1
        ? `by simulated energy within each of ${rule.detectors.join(", ")}, in turn`
        : `by simulated energy in ${rule.in}`
      : rule.by === "matchedPt"
        ? `by pT among the particles matched to ${rule.in} objects`
        : rule.by === "pt"
          ? "signal particles by pT"
          : `by ${rule.column ?? "size"}`;
  return rule.selection
    ? "the selection's particles: those its parts are matched to, then those that left simulated energy in its hits"
    : `top ${slots} ${rest}`;
}

// ---- The truth graph as a graph: particles, their parents and children, their vertices.

/** The truth particles and their vertices of one event, as the truth graph's tables give them (TruthParticles,
 *  TruthVertices, TruthParticleChildren; docs/truth-graph.md). Missing columns read as NaN or -1. A particle's
 *  `decayVertexIdx` is only the latest of the vertices where its saved daughters were made (not necessarily where it
 *  stopped), and its children are those of all those vertices: what happened where is read from each child's own
 *  production vertex. */
export interface Graph {
  n: number;
  col: (name: string, r: number) => number; // a particle's column
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

/** The graph of `particles` (with its `children` relation, from parent to child, and its vertex table `vertices`), from
 *  plain arrays: built once per event by the caller (store), so each card or list reads it at no cost. */
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
    col,
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
export const REASON = { decay: 2, brem: 3, conversion: 5, hadronicInelastic: 11 } as const;

/** A distance in cm in a sensible unit: "12 µm", "0.74 mm", "26.3 cm". */
export function length(cm: number) {
  const a = Math.abs(cm),
    f = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(3));
  return a < 0.1 ? `${f(cm * 1e4)} µm` : a < 1 ? `${f(cm * 10)} mm` : `${f(cm)} cm`;
}

/** The generator copies of particle `r`: the particles below it that are the same particle again (the only child of
 *  the same pdgId; the generator writes a particle again at each of its steps, sometimes beside a photon it radiates:
 *  a τ status 23 -> τ status 2 + γ), top first, `r` included (μ⁺ ×4, status 23 -> 51 -> 51 -> 1). */
export function copiesBelow(g: Graph, r: number): number[] {
  const out = [r];
  for (let k = r, steps = 0; k !== g.last[r] && steps < g.n; steps++) {
    k = g.children(k).find((c) => g.top[c] === g.top[r] && c !== k)!;
    if (k === undefined) break;
    out.push(k);
  }
  return out;
}
/** The top of `r`'s copies: the highest particle above it that is the same particle (see copiesBelow). */
export const topCopy = (g: Graph, r: number) => g.top[r];
/** A chain of particles (top first, each the parent of the next) with the generator copies of each particle folded:
 *  groups of rows, top first. */
export function foldCopies(g: Graph, chain: number[]): number[][] {
  const out: number[][] = [];
  for (const r of chain) {
    const prev = out.at(-1);
    if (prev && g.top[prev[0]] === g.top[r]) prev.push(r);
    else out.push([r]);
  }
  return out;
}

/** The vertices where particle `r`'s daughters were made (of its last copy: those of the earlier copies are the
 *  generator's), with their reason: what it did along its path, in time order of the file. */
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

/** An electron's or positron's bremsstrahlung before the calorimeter, from its own photons in the graph (docs/truth.md
 *  "Physics from the graph"): the photons its last copy radiated (children made at a vertex of reason bremsstrahlung;
 *  a generator copy's radiated photons are not) before it reached the calorimeter (made before the time of its
 *  boundary checkpoint: those made after it are its shower's) that the graph keeps (those that reached the
 *  calorimeter, or that something is matched to, or that made such particles), their summed energy, the radii
 *  (transverse distance to the beam line) where they were radiated, and its energy and place (R, z) where it reached
 *  the calorimeter (its boundary checkpoint), of the last copy. So E = ΣE + E at the calorimeter, but for what it lost
 *  by ionisation and the softest photons. Undefined for another particle; `count` 0 for an electron with none kept. */
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

/** A photon's conversion: the vertex of reason conversion among those where its daughters were made, where it is (R,
 *  z) and the electrons made at that vertex (not, say, a Compton electron made earlier); else whether it reached the
 *  calorimeter. A conversion after it reached the calorimeter (at or after the time of its boundary checkpoint) is the
 *  start of its shower, not a conversion before the calorimeter: `showered`, with where (R, z), and no products. Its
 *  parent if a π⁰ and its sister photons. Undefined for another particle. */
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

/** A τ's decay, from the children of its last copy: the decay products (the photons radiated beside a τ copy are
 *  not: they are made at a copy, not at its decay) and the visible energy, the sum of the products' energies but the
 *  neutrinos'. Undefined for another particle or a τ the graph keeps no decay of. */
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

/** A particle's flight: from its production vertex to its decay vertex, in 3D and transverse (cm); undefined without
 *  both. For a b or c hadron, its decay length. */
export function flightOf(g: Graph, r: number) {
  const p = g.col("prodVertexIdx", g.top[r]),
    e = decayVertexOf(g, r);
  if (!(p >= 0) || e < 0) return undefined;
  const d = ["x", "y", "z"].map((c) => g.vcol(c, e) - g.vcol(c, p));
  if (!d.every(Number.isFinite)) return undefined;
  return { l3d: Math.hypot(d[0], d[1], d[2]), lxy: Math.hypot(d[0], d[1]), vertex: e };
}

/** The reco vertices CMSSW's vertex associator matches to a b or c hadron's decay (docs/truth.md "Physics from the
 *  graph"): through the truth -> reco vertex association whose reco side matches decay vertices (`match.target`
 *  "decayVertex", e.g. truthSecondaryVertices), from the decay vertices of the hadron and of the b and c hadrons below
 *  it (a B -> D cascade), each with the association's completeness weight; best first. `associator` false when the
 *  bundle has no such association. `flags`: the particles' level-flags column. */
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

/** What a truth vertex is, in words (docs/truth.md): the particle that made its particles, its reason, and the number
 *  of charged particles made there that the graph keeps ("B⁰ decay · 3 charged"). `name`: a particle's name;
 *  `reasons`: the vertex reasons' names (the vertex layer's categories). */
export function vertexText(g: Graph, v: number, name: (r: number) => string, reasons: Record<string, string>) {
  const r = g.into(v),
    reason = reasons[String(g.vcol("reason", v))] ?? "vertex",
    charged = g.outOf(v).filter((c) => g.col("charge", c) !== 0 && Number.isFinite(g.col("charge", c))).length;
  return `${r >= 0 ? `${name(r)} ` : ""}${reason}${charged ? ` · ${charged} charged` : ""}`;
}

// ---- Truth search

/** A truth search (docs/viewer.md "Truth tab"): a pdgId (`511`, `-11`), a pdgId either sign (`|pdg|=11`, `|11|`), or
 *  the start of a particle's name ("B", "μ"). */
export type TruthQuery = { pdg: number; abs: boolean } | { name: string } | null;
export function parseTruthQuery(q: string): TruthQuery {
  const s = q.trim();
  if (!s) return null;
  const abs = /^\|\s*pdg(?:id)?\s*\|\s*=?\s*(-?\d+)$/i.exec(s) ?? /^\|\s*(-?\d+)\s*\|$/.exec(s);
  if (abs) return { pdg: Math.abs(Number(abs[1])), abs: true };
  const id = /^(?:pdg(?:id)?\s*=?\s*)?(-?\d+)$/i.exec(s);
  if (id) return { pdg: Number(id[1]), abs: false };
  return { name: s.toLowerCase() };
}
/** Whether particle `pdg`, named `name`, answers query `q`. */
export function matchesQuery(q: Exclude<TruthQuery, null>, pdg: number, name: string) {
  if ("pdg" in q) return q.abs ? Math.abs(pdg) === q.pdg : pdg === q.pdg;
  return name.toLowerCase().startsWith(q.name);
}

// ---- The particles in a view (the Truth tab's entry point)

/** One truth particle in one detector of a view: its simulated energy there (`amount`, GeV; the tracker, which has
 *  none in the file: its pT), its best object of the kind compared there (TruthToReco, -1 for none) and that object's
 *  completeness for it; `split`, how many objects of the kind hold part of it; `shares`, how many other particles of
 *  the list have the same best object (a merge). */
export interface ViewRow {
  particle: number;
  amount: number;
  best: number;
  completeness?: number;
  split: number;
  shares: number;
}
/** One detector of a view: its rows, largest first, and the kind compared there (none: not compared). */
export interface ViewDetector {
  in: string;
  by: "simEnergy" | "pt";
  kind?: string;
  rows: ViewRow[];
}

/** The particles of `truth` with something in the view of `domain` (null, or a shared domain: the whole detector),
 *  detector by detector, largest first (docs/viewer.md "Particles in this view"): those that left simulated energy
 *  in its hits (the hit index); in the tracker, which has no simulated energy in the file, those a track is matched
 *  to (their own best match: not the ancestors whose branches hold the track too), by pT. Simulated energy is never
 *  compared across detectors: a particle is listed in each detector it left energy in. `keep`: the truth layer's
 *  filter (signal only). */
export function particlesInView(
  ev: EventData,
  header: Header,
  truth: string,
  domain: string | null,
  keep?: (r: number) => boolean,
): ViewDetector[] {
  const n = ev.tables[truth]?.n ?? 0,
    own = domain ? header.domains?.find((d) => d.name === domain) : undefined,
    whole = !own || !!own.shared,
    inView = (table: string) => whole || header.display.find((l) => l.table === table)?.domain === domain;
  const out: ViewDetector[] = [];
  const detector = (det: string, by: ViewDetector["by"], amount: (p: number) => number): ViewDetector => {
    const kind = comparedKind(header, truth, det),
      t2r = kind ? truthToReco(header, truth, kind) : undefined,
      rel = t2r && ev.relations[t2r[0]],
      best = rel ? bestPartners(rel, t2r![1], true, n).partner : undefined;
    const rows: ViewRow[] = [];
    for (let p = 0; p < n; p++) {
      const a = amount(p);
      if (!(a > 0) || (keep && !keep(p))) continue;
      const b = best && p < best.length ? best[p] : -1;
      rows.push({
        particle: p,
        amount: a,
        best: b,
        completeness: b >= 0 ? completeness(ev, header, truth, p, kind!, b)?.value : undefined,
        split: rel && p + 1 < rel.offsets.length ? rel.offsets[p + 1] - rel.offsets[p] : 0,
        shares: 0,
      });
    }
    const count = new Map<number, number>();
    for (const r of rows) if (r.best >= 0) count.set(r.best, (count.get(r.best) ?? 0) + 1);
    for (const r of rows) r.shares = r.best >= 0 ? count.get(r.best)! - 1 : 0;
    return { in: det, by, kind, rows: rows.sort((a, b) => b.amount - a.amount) };
  };
  // The tracker (or any detector with an association but no simulated energy): the particles its objects are
  // matched to, by pT.
  const pt = ev.tables[truth]?.columns.pt,
    simIn = new Set(facts(header).map((f) => f.in));
  const matchedIn = new Map<string, Set<number>>();
  for (const [name, info] of Object.entries(header.relations)) {
    const rel = ev.relations[name],
      det = info.match?.in;
    if (!rel || !det || simIn.has(det) || !info.association || info.to !== truth || !inView(info.from)) continue;
    const set = matchedIn.get(det) ?? new Set<number>();
    for (const p of bestPartners(rel, info, true, ev.tables[info.from]?.n ?? 0).partner) if (p >= 0) set.add(p);
    matchedIn.set(det, set);
  }
  if (pt) for (const [det, set] of matchedIn) out.push(detector(det, "pt", (p) => (set.has(p) ? Number(pt[p]) : 0)));
  // The detectors with simulated energy: per particle, the sum over its hits there.
  const mine = facts(header).filter((f) => f.from === truth && ev.relations[f.name] && inView(f.to));
  for (const det of [...new Set(mine.map((f) => f.in))]) {
    const sum = new Float64Array(n);
    for (const f of mine.filter((x) => x.in === det)) {
      const info = header.relations[f.name],
        rel = ev.relations[f.name],
        w = rel.weights[info.best?.weight ?? info.weights[0]];
      if (w)
        for (let p = 0; p < n && p + 1 < rel.offsets.length; p++)
          for (let k = rel.offsets[p]; k < rel.offsets[p + 1]; k++) sum[p] += w[k];
    }
    out.push(detector(det, "simEnergy", (p) => sum[p]));
  }
  return out.filter((d) => d.rows.length);
}

// ---- What a particle could have been reconstructed as, without an associator

/** The detectors a table's objects are in: those (fact `in`) of the hits they are made of, through plain relations;
 *  for a kind made of no such hits, its own domain (the tracker, the muon system). */
function detectorsOf(header: Header, table: string): Set<string> {
  const factIn = new Map(facts(header).map((f) => [f.to, f.in])),
    out = new Set<string>(),
    seen = new Set([table]);
  for (const todo = [table]; todo.length; ) {
    const t = todo.pop()!;
    if (factIn.has(t)) out.add(factIn.get(t)!);
    for (const r of Object.values(header.relations))
      if (r.from === t && !r.association && !r.inverseOf && !seen.has(r.to)) {
        seen.add(r.to);
        todo.push(r.to);
      }
  }
  const dom = header.display.find((l) => l.table === table)?.domain;
  if (!out.size && dom) out.add(dom);
  return out;
}

/** Physics kinds (display hint `kind`) that stand for one species (|pdgId|): an electron kind is not a muon's answer.
 *  Jets and PF candidates stand for any particle. */
const SPECIES: Record<string, number> = { electron: 11, gsfTrack: 11, photon: 22, muon: 13, tau: 15 };

/** The kinds with no truth association (`gapOf` gives their gap, undefined for a kind with one) that particle `row` of
 *  `truth` could have reached (docs/truth.md "Where truth stops"): of a detector where its branch left simulated
 *  energy, of the tracker when a track holds part of it, of the muon system for a muon; a kind of one species (an
 *  electron, a muon) only for that species. A barrel electron gets no HGCal kinds; kinds made of nothing (a beam spot)
 *  never. */
export function unassociatedKinds(
  ev: EventData,
  header: Header,
  truth: string,
  row: number,
  g: Graph,
  gapOf: (table: string) => { reason: string; gap?: number } | undefined,
) {
  // Where its branch (it and everything below it) left simulated energy.
  const branch = new Set([row]);
  for (const todo = [row]; todo.length && branch.size < 5000; )
    for (const c of g.children(todo.pop()!))
      if (!branch.has(c)) {
        branch.add(c);
        todo.push(c);
      }
  const reached = new Set<string>();
  for (const f of facts(header)) {
    const rel = ev.relations[f.name],
      has = (p: number) => p + 1 < (rel?.offsets.length ?? 0) && rel!.offsets[p + 1] > rel!.offsets[p];
    if (f.from === truth && rel && [...branch].some(has)) reached.add(f.in);
  }
  // Detectors without simulated energy in the file: the tracker when a track holds part of it (its truth -> reco
  // association), the muon system for a muon.
  const sim = new Set(facts(header).map((f) => f.in)),
    simDomains = new Set(facts(header).map((f) => header.display.find((l) => l.table === f.to)?.domain));
  for (const [name, r] of Object.entries(header.relations)) {
    const rel = ev.relations[name];
    if (
      rel &&
      r.association &&
      r.from === truth &&
      row + 1 < rel.offsets.length &&
      rel.offsets[row + 1] > rel.offsets[row]
    )
      for (const d of detectorsOf(header, r.to)) if (!sim.has(d)) reached.add(d);
  }
  const pdg = Math.abs(g.col("pdgId", row));
  if (pdg === 13) for (const d of header.domains ?? []) if (!d.shared && !simDomains.has(d.name)) reached.add(d.name);
  const related = (t: string) => Object.values(header.relations).some((r) => r.from === t || r.to === t);
  const out: { table: string; reason: string; gap?: number }[] = [];
  for (const l of header.display) {
    const gap = gapOf(l.table),
      species = l.kind ? SPECIES[l.kind] : undefined,
      shared = !!header.domains?.find((d) => d.name === l.domain)?.shared;
    if (!gap || l.truth || l.context || !related(l.table) || (species !== undefined && species !== pdg)) continue;
    if (
      shared ? species !== undefined || reached.size > 0 : [...detectorsOf(header, l.table)].some((d) => reached.has(d))
    )
      out.push({ table: l.table, ...gap });
  }
  return out;
}
