// The truth <-> reco pair (docs/truth.md "The pair view"): a truth particle's branch (the particle and everything
// below it) and, detector by detector, the reco objects that CMSSW's associator gives as its best matches there.
// Selecting the particle, a matched reco object or a hit gives the pair of the particle it points at.
//
// What it stands for, and nothing else:
// - truth: the branch of the selected particle (or of the reco object's best match, or of the particle that left the
//   most simulated energy in the selected hit): never its siblings, never its ancestor's other descendants. The hits
//   come from the simulation (the hit index): those of the branch's particles that entered the calorimeter, each
//   counted once. When the particle's own hits are not exported on their own (it is inside the shower of a particle
//   that entered the calorimeter, e.g. a brem photon), the hits shown are that particle's, and the pair says so;
// - reco, per detector: the kind the associator matches there (HGCal: the last trackster stage, ECAL and HCAL: PF
//   clusters, the tracker: tracks); a detector whose objects have no association is shown, but not compared (no
//   matching through hits in Ember). Objects that only contain matched ones (PF candidates, jets, TICL candidates)
//   are not drawn as part of the pair: they have no truth of their own.
import type { EventData, Header, RelationInfo } from "../io/format";
import { facts } from "./facts";
import { byHit } from "./match";
import { type ColourBy, modeColouring } from "./modes";
import { backPointers, bestPartners, cached, contentPartners, identities, type Ref, type Related } from "./relations";

/** What an object is in the pair view:
 *  - matched: the branch's, in its match (for a hit: the branch left the most simulated energy in it);
 *  - contamination: in its match, from other particles or from none;
 *  - split: the branch's, in another object of the kind compared (or that object);
 *  - missed: the branch's, in no object of the kind compared;
 *  - reco: part of a match, with no truth statement of its own (a matched trackster's layer clusters), or a matched
 *    kind's object whose association names no particle (nothing confirmed);
 *  - branch: a particle of the branch other than its top, that left hits (e.g. the products of an interaction in
 *    the tracker), or the particle whose shower holds the selected particle's hits;
 *  - uncompared: the branch's, in a detector with no reco association (HF, HO): shown, not compared. */
export const PAIR = {
  other: 0,
  matched: 1,
  contamination: 2,
  split: 3,
  missed: 4,
  reco: 5,
  branch: 6,
  uncompared: 7,
} as const;
export type PairClass = (typeof PAIR)[keyof typeof PAIR];

/** Per object of `table`, the row of the mode's root (the object whose colour it takes) at the end of the colouring
 *  chain of `colouring` (model/modes.ts), -1 for none; null if the mode does not reach the table. Once per event. */
export function rootRows(
  ev: EventData,
  header: Header,
  colouring: Record<string, ColourBy>,
  table: string,
  seen = new Set<string>(),
): Int32Array | null {
  const c = colouring[table],
    n = ev.tables[table]?.n ?? 0,
    root = Object.keys(colouring).find((t) => colouring[t] === "identity");
  if (!c || !root || seen.has(table)) return null;
  return cached(ev, `rootRows|${root}|${table}`, () => {
    if (c === "identity") return Int32Array.from({ length: n }, (_, i) => i);
    if (typeof c === "object" && "content" in c) return contentPartners(table, c.content, n, ev, header).partner;
    if (typeof c !== "object" || !("relation" in c)) return null;
    const info = header.relations[c.relation],
      rel = ev.relations[c.relation];
    if (!info || !rel) return null;
    const forward = info.from === table && info.to !== table,
      other = forward ? info.to : info.from;
    const partner = bestPartners(rel, info, forward, n).partner,
      up = rootRows(ev, header, colouring, other, new Set(seen).add(table));
    if (!up) return null;
    const out = new Int32Array(n);
    for (let i = 0; i < n; i++) out[i] = partner[i] < 0 ? -1 : up[partner[i]];
    return out;
  });
}

/** One detector of the pair: the branch's simulated energy there, and the reco kind it is compared with. */
export interface PairDetector {
  in: string; // the detector, as the `match` and `fact` hints name it (HGCal, ECAL, HCAL, HF, HO, tracker)
  /** The reco table compared with (its association to the truth particles), undefined: none in this detector. */
  kind?: string;
  /** Without a kind: the tables that hold this detector's hits, and why they have no truth (their `truthGap`). */
  gaps: { table: string; reason?: string; gap?: number }[];
  /** The kind's objects that the association rates best for the branch's particles (TruthToReco), largest first. */
  matches: number[];
  /** The branch's simulated energy in this detector (deposited in the sensors, not calibrated; each hit's energy
   *  counted once): `own` by the particle whose hits stand for the branch, `descendants` by the other particles of
   *  the branch that entered the calorimeter; with a kind, where it went: in the matches, in other objects of the
   *  kind, in none. Undefined for the tracker (no simulated energy per tracker hit in the file). */
  sim?: { own: number; descendants: number; inMatch: number; inOthers: number; inNone: number };
  /** The matches' rechit energy, each hit split by the simulated-energy shares in it: from the branch, from other
   *  particles, and of hits with no simulated energy from any exported particle. */
  reco?: { branch: number; other: number; noTruth: number };
}

export interface Pair {
  truth: string; // the truth particles' table
  particle: number; // the top of the branch, -1 for none (a matched kind's object whose association names none)
  /** The particle whose exported hits stand for the branch: the particle itself, or (its own not exported on their
   *  own) its ancestor that entered the calorimeter; -1 when the branch left no hits. */
  hitsOf: number;
  /** The particles of the branch that left hits, other than `hitsOf` (e.g. an interaction's products), largest first. */
  owners: number[];
  /** The selected reco object, when the pair comes from one (its table and row). */
  from?: Ref;
  detectors: PairDetector[];
  classes: Map<string, Uint8Array>; // per table, a PairClass per object
}

/** The reco -> truth relations that carry a `match` contract into the truth particles, by reco table. */
function matchRelations(header: Header, truth: string) {
  return cached0(header, `match|${truth}`, () => {
    const out = new Map<string, [string, RelationInfo]>();
    for (const [name, r] of Object.entries(header.relations))
      if ((r.match?.shared ?? r.match?.purity) && r.to === truth && r.from !== truth && !out.has(r.from))
        out.set(r.from, [name, r]);
    return out;
  });
}
/** The truth -> reco association of `table` with a `best` hint (TruthToReco: each particle's best object). */
function truthToReco(header: Header, truth: string, table: string) {
  return Object.entries(header.relations).find(
    ([, r]) => r.association && r.from === truth && r.to === table && r.best,
  );
}
const perHeader = new WeakMap<Header, Map<string, unknown>>();
function cached0<T>(header: Header, what: string, make: () => T): T {
  let m = perHeader.get(header);
  if (!m) perHeader.set(header, (m = new Map()));
  if (!m.has(what)) m.set(what, make());
  return m.get(what) as T;
}
/** The colouring that leads every table to `root` through the reconstruction (model/modes.ts), once per header. */
const towards = (header: Header, root: string) => cached0(header, `towards|${root}`, () => modeColouring(header, root));

/** The rows of `table` reached from `rows` through plain relations (what they are made of), themselves included. */
function madeOf(ev: EventData, header: Header, table: string, rows: number[]): Related {
  const back = backPointers(ev, header),
    out: Related = new Map([[table, new Set(rows)]]);
  let frontier: Related = new Map(out);
  while (frontier.size) {
    const next: Related = new Map();
    for (const [name, info] of Object.entries(header.relations)) {
      const rel = ev.relations[name],
        from = frontier.get(info.from);
      if (!rel || !from || info.association || back.has(name) || info.from === info.to) continue;
      const seen = out.get(info.to) ?? new Set<number>();
      out.set(info.to, seen);
      for (const r of from)
        for (let k = rel.offsets[r]; k < rel.offsets[r + 1]; k++) {
          const p = rel.indices[k];
          if (seen.has(p)) continue;
          seen.add(p);
          if (!next.has(info.to)) next.set(info.to, new Set());
          next.get(info.to)!.add(p);
        }
    }
    frontier = next;
  }
  return out;
}

/** The energy column of a hit table: its cut's, when in GeV, else `energy`. */
function energyOf(header: Header, ev: EventData, table: string) {
  const d = header.display.find((l) => l.table === table),
    cols = ev.tables[table]?.columns;
  return (d?.cut?.unit === "GeV" ? cols?.[d.cut.column] : undefined) ?? cols?.energy;
}

/** The pair of `focus`, or null when it has none: a reco kind without an association of its own (a jet, a PF
 *  candidate, a TICL candidate), and anything in a bundle without truth particles. `truth`: the truth particles'
 *  table. */
export function pairFor(ev: EventData, header: Header, focus: Ref, truth: string): Pair | null {
  const tTruth = ev.tables[truth],
    truthLayer = header.display.find((d) => d.table === truth);
  if (!tTruth || !truthLayer) return null;
  const nTruth = tTruth.n,
    allFacts = facts(header).filter((f) => f.from === truth && ev.relations[f.name]),
    matches = matchRelations(header, truth);

  // 1. The particle the focus points at.
  let particle = -1,
    from: Ref | undefined;
  const fact = allFacts.find((f) => f.to === focus.table);
  if (focus.table === truth) particle = focus.row;
  else if (fact) {
    const info = header.relations[fact.name];
    particle = bestPartners(ev.relations[fact.name], info, false, ev.tables[focus.table]?.n ?? 0).partner[focus.row];
  } else {
    // a matched kind's object, or a part drawn with one (a track's hits: the track)
    let ref: Ref | undefined = matches.has(focus.table) ? focus : undefined;
    const gap = header.display.find((d) => d.table === focus.table)?.truthGap; // a kind with no truth of its own
    if (!ref && !gap)
      for (const [name, info] of Object.entries(header.relations)) {
        const rel = ev.relations[name];
        if (!rel || info.association || info.to !== focus.table || !matches.has(info.from)) continue;
        const row = bestPartners(rel, info, false, ev.tables[focus.table]?.n ?? 0).partner[focus.row];
        if (row >= 0) ref = { table: info.from, row };
        break;
      }
    if (!ref) return null;
    from = ref;
    const [name, info] = matches.get(ref.table)!;
    particle = bestPartners(ev.relations[name], info, true, ev.tables[ref.table]?.n ?? 0).partner[ref.row];
  }
  const classes = new Map<string, Uint8Array>();
  const classOf = (t: string) => {
    let c = classes.get(t);
    if (!c) classes.set(t, (c = new Uint8Array(ev.tables[t]?.n ?? 0)));
    return c;
  };
  if (particle < 0) {
    // a matched kind's object with no particle (unmatched: a fake, or noise): itself and its parts, nothing confirmed
    if (!from) return null;
    for (const [t, rows] of madeOf(ev, header, from.table, [from.row])) {
      const c = classOf(t);
      for (const r of rows) c[r] = PAIR.reco;
    }
    return { truth, particle, hitsOf: -1, owners: [], from, detectors: [], classes };
  }

  // 2. The branch: the particle and everything below it (parent -> children relation of the truth table).
  const kids = Object.entries(header.relations).find(
    ([name, r]) => !r.association && r.from === truth && r.to === truth && ev.relations[name],
  );
  const subtree = (top: number) => {
    const inside = new Uint8Array(nTruth),
      todo = [top];
    inside[top] = 1;
    const rel = kids && ev.relations[kids[0]];
    while (rel && todo.length) {
      const p = todo.pop()!;
      for (let k = rel.offsets[p]; k < rel.offsets[p + 1]; k++) {
        const c = rel.indices[k];
        if (!inside[c]) {
          inside[c] = 1;
          todo.push(c);
        }
      }
    }
    return inside;
  };
  const inBranch = subtree(particle);
  // The particles that own hits (the hit table's rows: those that entered the calorimeter, with their descendants').
  const owns = cached(ev, `owns|${truth}`, () => {
    const o = new Uint8Array(nTruth);
    for (const f of allFacts) {
      const off = ev.relations[f.name].offsets;
      for (let p = 0; p + 1 < off.length && p < nTruth; p++) if (off[p + 1] > off[p]) o[p] = 1;
    }
    return o;
  });
  const { parent } = identities(truthLayer, tTruth, ev, header, 0);
  let hitsOf = -1,
    inHits = inBranch;
  for (let p = 0; p < nTruth && hitsOf < 0; p++) if (inBranch[p] && owns[p]) hitsOf = particle;
  if (hitsOf < 0)
    for (let a = parent[particle], steps = 0; a >= 0 && steps < nTruth; a = parent[a], steps++)
      if (owns[a]) {
        hitsOf = a;
        inHits = subtree(a);
        break;
      }
  // Each hit counted once: only the highest owners of the branch (an owner's hits include its descendants').
  const top: number[] = [],
    isTop = new Uint8Array(nTruth);
  for (let p = 0; p < nTruth; p++) {
    if (!inHits[p] || !owns[p]) continue;
    let nested = false;
    for (let a = parent[p], steps = 0; a >= 0 && steps < nTruth && !nested; a = parent[a], steps++)
      nested = inHits[a] === 1 && owns[a] === 1;
    if (!nested) {
      top.push(p);
      isTop[p] = 1;
    }
  }

  // 3. Per detector: the kind compared with, its matches, and where the branch's simulated energy went.
  const stageOf = (t: string) => header.display.find((d) => d.table === t)?.stage ?? -1;
  const order = (t: string) => header.display.findIndex((d) => d.table === t);
  const kindIn = (where: string) => {
    if (from && matches.get(from.table)?.[1].match?.in === where) return from.table;
    return [...matches]
      .filter(([, [, r]]) => r.match?.in === where)
      .map(([t]) => t)
      .sort((a, b) => stageOf(b) - stageOf(a) || order(a) - order(b))[0];
  };
  const bestOf = (kind: string, particles: number[]) => {
    const t2r = truthToReco(header, truth, kind);
    if (!t2r) return [];
    const best = bestPartners(ev.relations[t2r[0]], t2r[1], true, nTruth).partner,
      out = new Set<number>();
    for (const p of particles) if (best[p] >= 0) out.add(best[p]);
    return [...out];
  };
  const detectors: PairDetector[] = [];
  const truthClasses = classOf(truth);
  const byDetector = new Map<string, typeof allFacts>();
  for (const f of allFacts) byDetector.set(f.in, [...(byDetector.get(f.in) ?? []), f]);
  for (const [where, fs] of byDetector) {
    const kind = kindIn(where),
      det: PairDetector = { in: where, kind, gaps: [], matches: [] };
    const sim = { own: 0, descendants: 0, inMatch: 0, inOthers: 0, inNone: 0 };
    const inMatch = kind ? madeOf(ev, header, kind, (det.matches = bestOf(kind, top))) : new Map();
    for (const f of fs) {
      const info = header.relations[f.name],
        rel = ev.relations[f.name],
        w = rel.weights[info.best?.weight ?? info.weights[0]],
        nHits = ev.tables[f.to]?.n ?? 0,
        dominant = bestPartners(rel, info, false, nHits).partner,
        obj = kind ? rootRows(ev, header, towards(header, kind), f.to) : null,
        hits = inMatch.get(f.to),
        c = classOf(f.to);
      for (const p of top)
        for (let k = rel.offsets[p]; k < rel.offsets[p + 1]; k++) {
          const h = rel.indices[k],
            e = w ? w[k] : 0;
          if (p === hitsOf) sim.own += e;
          else sim.descendants += e;
          if (hits?.has(h)) sim.inMatch += e;
          else if (obj && obj[h] >= 0) sim.inOthers += e;
          else sim.inNone += e;
        }
      for (let h = 0; h < nHits; h++) {
        const mine = dominant[h] >= 0 && inHits[dominant[h]] === 1;
        if (!kind) c[h] = mine ? PAIR.uncompared : c[h];
        else if (hits?.has(h)) c[h] = mine ? PAIR.matched : PAIR.contamination;
        else if (mine) c[h] = obj && obj[h] >= 0 ? PAIR.split : PAIR.missed;
      }
      if (!kind)
        // why nothing here is compared: the tables made of these hits, and their truth gaps
        for (const [, r] of Object.entries(header.relations)) {
          const d = header.display.find((l) => l.table === r.from);
          if (r.association || r.to !== f.to || !d || det.gaps.some((g) => g.table === r.from)) continue;
          det.gaps.push({ table: r.from, reason: d.truthGap?.reason, gap: d.truthGap?.gap });
        }
      // The matches' rechit energy, each hit split by the simulated energy in it.
      const energy = energyOf(header, ev, f.to);
      if (hits && energy) {
        const reco = (det.reco ??= { branch: 0, other: 0, noTruth: 0 }),
          { offsets, particle: who, entry } = byHit(ev, f.name, nHits);
        for (const h of hits) {
          let mine = 0,
            all = 0;
          for (let j = offsets[h]; j < offsets[h + 1]; j++) {
            const e = w ? w[entry[j]] : 0;
            all += e;
            if (isTop[who[j]]) mine += e;
          }
          const E = Number(energy[h]);
          if (all > 0) {
            reco.branch += (E * mine) / all;
            reco.other += (E * (all - mine)) / all;
          } else reco.noTruth += E;
        }
      }
    }
    if (sim.own + sim.descendants <= 0 && !det.matches.length) continue;
    det.sim = sim;
    if (kind) markKind(kind, det.matches, inMatch);
    detectors.push(det);
  }
  // The tracker: the tracks matched to the branch's particles (no simulated energy per tracker hit in the file).
  const trackKind = kindIn("tracker");
  if (trackKind) {
    const branch: number[] = [];
    for (let p = 0; p < nTruth; p++) if (inBranch[p]) branch.push(p);
    const m = bestOf(trackKind, branch);
    if (m.length || from?.table === trackKind) {
      detectors.unshift({ in: "tracker", kind: trackKind, gaps: [], matches: m });
      markKind(trackKind, m, madeOf(ev, header, trackKind, m));
    }
  }
  // The kind's own objects, and the parts of its matches (no truth statement of their own: layer clusters, track
  // hits): matches are matched; other objects matched to the branch's particles, or holding its hits, are split.
  function markKind(kind: string, m: number[], parts: Related) {
    const c = classOf(kind),
      [name, info] = matches.get(kind)!,
      best = bestPartners(ev.relations[name], info, true, ev.tables[kind]?.n ?? 0).partner,
      holder = (t: string) => header.display.some((d) => d.table === t && d.truth);
    for (let i = 0; i < c.length; i++)
      if (best[i] >= 0 && (inBranch[best[i]] || inHits[best[i]])) c[i] = PAIR.split;
    for (const [t, rows] of parts) {
      if (t === kind || holder(t) || allFacts.some((f) => f.to === t)) continue;
      const pc = classOf(t);
      for (const r of rows) if (!pc[r]) pc[r] = PAIR.reco;
    }
    for (const r of m) c[r] = PAIR.matched;
  }
  // Objects of a compared kind that hold the branch's hits but are not its matches: split.
  for (const det of detectors) {
    if (!det.kind || det.in === "tracker") continue;
    const c = classOf(det.kind);
    for (const f of byDetector.get(det.in) ?? []) {
      const obj = rootRows(ev, header, towards(header, det.kind), f.to),
        hc = classes.get(f.to);
      if (!obj || !hc) continue;
      for (let h = 0; h < hc.length; h++) if (hc[h] === PAIR.split && obj[h] >= 0 && !c[obj[h]]) c[obj[h]] = PAIR.split;
    }
  }
  // 4. The truth: the particle, and the particles of the branch whose hits are drawn.
  truthClasses[particle] = PAIR.matched;
  const owners = top.filter((p) => p !== hitsOf && p !== particle);
  for (const p of owners) truthClasses[p] = PAIR.branch;
  if (hitsOf >= 0 && hitsOf !== particle) truthClasses[hitsOf] = PAIR.branch;
  const size = truthLayer.colour ? tTruth.columns[truthLayer.colour] : undefined;
  if (size) owners.sort((a, b) => Number(size[b]) - Number(size[a]));
  // The tracker first, then the detectors compared with a match, then the others (amounts are never compared across
  // detectors: a barrel electron's few MeV in HGCal come after its ECAL clusters, not before).
  const rank = (d: PairDetector) => (d.in === "tracker" ? 0 : d.matches.length ? 1 : d.kind ? 2 : 3);
  detectors.sort((a, b) => rank(a) - rank(b));
  return { truth, particle, hitsOf, owners, from, detectors, classes };
}

/** Whether the pair has anything to show: a particle with hits or matches, or a matched kind's object alone. */
export const pairShows = (p: Pair) => p.particle < 0 || p.hitsOf >= 0 || p.detectors.some((d) => d.matches.length);

/** What the pair's colours depend on: two pairs with the same key colour every object alike. */
export const pairKey = (p: Pair) =>
  `${p.particle}|${p.from ? `${p.from.table}#${p.from.row}` : ""}|${p.detectors.map((d) => `${d.kind}:${d.matches}`).join(";")}`;
