// The truth <-> reco pair: a truth particle (its whole shower) and the candidate that best reconstructs it, and where
// each of their objects ended up. Selecting the particle, the candidate or anything inside them gives the same pair,
// so the picture does not change when you click from one to the other.
import type { DisplayLayer, EventData, Header } from "../io/bundle";
import type { ColourBy } from "./modes";
import { facts } from "./facts";
import { bestPartners, cached, contentPartners, identities, levelsOf, type Ref, relatedParts } from "./relations";

/** What an object is in the pair view. `reco`: in a candidate that has no truth particle (no match, or no truth in
 *  the file), drawn in a neutral colour, as nothing is confirmed. */
export const PAIR = { other: 0, matched: 1, contamination: 2, split: 3, missed: 4, reco: 5 } as const;
export type PairClass = (typeof PAIR)[keyof typeof PAIR];

/** Per object of `table`, the row of the mode's root (the object whose colour it takes) at the end of the colouring
 *  chain of `colouring` (model/modes.ts), -1 for none; null if the mode does not reach the table. Once per event. */
export function rootRows(ev: EventData, header: Header, colouring: Record<string, ColourBy>, table: string, seen = new Set<string>()): Int32Array | null {
  const c = colouring[table], n = ev.tables[table]?.n ?? 0, root = Object.keys(colouring).find((t) => colouring[t] === "identity");
  if (!c || !root || seen.has(table)) return null;
  return cached(ev, `rootRows|${root}|${table}`, () => {
    if (c === "identity") return Int32Array.from({ length: n }, (_, i) => i);
    if (typeof c === "object" && "content" in c) return contentPartners(table, c.content, n, ev, header).partner;
    if (typeof c !== "object" || !("relation" in c)) return null;
    const info = header.relations[c.relation], rel = ev.relations[c.relation];
    if (!info || !rel) return null;
    const forward = info.from === table && info.to !== table, other = forward ? info.to : info.from;
    const partner = bestPartners(rel, info, forward, n).partner, up = rootRows(ev, header, colouring, other, new Set(seen).add(table));
    if (!up) return null;
    const out = new Int32Array(n);
    for (let i = 0; i < n; i++) out[i] = partner[i] < 0 ? -1 : up[partner[i]];
    return out;
  });
}

export interface Pair {
  particle: number; // truth key (the shower) of the pair, -1 for none
  /** When the pair's particle is above the truth level (e.g. a π⁰ a candidate is matched to as a whole, whose photons
   *  are generator particles of their own): the level's particles below it, which the pair also stands for. */
  merged: number[];
  matched: number; // the particle the selection points at (e.g. a candidate's best match), -1 for none
  candidate: number; // reco root row, -1 for none
  truth?: string; reco: string; // the two root tables
  classes: Map<string, Uint8Array>; // per drawn table, a PairClass per object
  /** The particle's simulated energy (summed over its shower) in hits: in the candidate, in other candidates, in none. */
  efficiency?: { candidate: number; others: number; missed: number };
  /** The candidate's hit energy: from the particle, from anything else. */
  purity?: { particle: number; other: number };
}

/** The pair for the focus, the same whichever of its objects is selected: first the focus's particle (a truth
 *  particle's shower; for a reco object, its best truth match; for a hit, the particle that left the most simulated
 *  energy in it), then that particle's best candidate. A selected candidate that is not its particle's best (e.g. a
 *  fragment) shows as split. Without a particle (no truth in the bundle, or none matched), the pair is the focus's
 *  candidate alone and its objects show as `reco` ("in the candidate", nothing confirmed). `roots`, `colourings`: of the truth and reco
 *  modes (model/modes.ts); `truthLayer`: the display layer of the truth root, whose keys group a particle's shower. */
export function pairFor(ev: EventData, header: Header, focus: Ref, roots: { truth?: string; reco: string },
  colourings: { truth?: Record<string, ColourBy>; reco: Record<string, ColourBy> }, truthLayer?: DisplayLayer): Pair {
  const { truth, reco } = roots, recoOf = (t: string) => rootRows(ev, header, colourings.reco, t);
  const ids = truth && truthLayer && ev.tables[truth] ? identities(truthLayer, ev.tables[truth], ev, header, 0) : undefined, key = ids?.key;
  const rawTruthOf = (t: string) => (truth && colourings.truth ? rootRows(ev, header, colourings.truth, t) : null);
  const truthOf = (t: string) => { // per object, its particle's shower (key); once per event
    const r = rawTruthOf(t);
    return r && key ? cached(ev, `truthOf|${t}`, () => r.map((p) => (p < 0 ? -1 : key[p]))) : null;
  };
  // Each particle's best candidate: the association from the truth root to the reco root (its `best` weight).
  const toReco = Object.entries(header.relations).find(([name, r]) => r.association && r.from === truth && r.to === reco && ev.relations[name]);
  const bestCand = (p: number) => {
    if (!toReco || p < 0) return -1;
    const [name, info] = toReco;
    return bestPartners(ev.relations[name], info, true, ev.tables[truth!]?.n ?? 0).partner[p] ?? -1;
  };
  const raw = rawTruthOf(focus.table)?.[focus.row] ?? -1;
  let particle = raw >= 0 && key ? key[raw] : -1, candidate = -1;
  // The keys the pair stands for (a byte per truth row: one load per object below): the particle's own; for one above
  // the level (e.g. a π⁰ a candidate is matched to, or a top quark selected in the truth), also the level's particles
  // below it, found down its children.
  const nTruth = key?.length ?? 0, inPair = new Uint8Array(nTruth), merged: number[] = [];
  if (particle >= 0) inPair[particle] = 1;
  const flags = truthLayer?.particle && truth ? ev.tables[truth]?.columns[truthLayer.particle.flags] : undefined;
  const member = (r: number) => !!flags && ((Number(flags[r]) >>> truthLayer!.particle!.bit) & 1) === 1;
  const kids = Object.entries(header.relations).find(([name, r]) => !r.association && r.from === truth && r.to === truth && ev.relations[name]);
  if (particle >= 0 && flags && kids && !member(particle)) {
    const rel = ev.relations[kids[0]], todo = [particle], seen = new Uint8Array(nTruth);
    while (todo.length) {
      const p = todo.pop()!;
      for (let k = rel.offsets[p]; k < rel.offsets[p + 1]; k++) {
        const c = rel.indices[k];
        if (seen[c]) continue;
        seen[c] = 1;
        if (member(c)) { inPair[c] = 1; merged.push(c); } else todo.push(c); // below a member, everything has its key
      }
    }
  }
  const has = (k: number) => k >= 0 && inPair[k] === 1;
  if (particle >= 0) candidate = bestCand(particle) >= 0 ? bestCand(particle) : bestCand(raw);
  else candidate = recoOf(focus.table)?.[focus.row] ?? -1;

  // What the candidate is made of (its levels, without what is only linked to it), so an object it shares with
  // another candidate (e.g. a duplicate) still counts as in it.
  const members = candidate >= 0 ? levelsOf(ev, header, { table: reco, row: candidate }, { ...relatedParts(ev, header, { table: reco, row: candidate }), linked: new Map() }) : new Map<string, Set<number>>();
  const classes = new Map<string, Uint8Array>(), splitCands = new Set<number>(), anyParticle = particle >= 0;
  const truthTables = new Set(header.display.filter((d) => d.truth).map((d) => d.table));
  // The hits with simulated energy (facts) in the candidates' detector: simulated energy is never summed across
  // detectors (an HGCal candidate's pair says nothing about the particle's ECAL or HCAL hits).
  const rootIn = Object.values(header.relations).find((r) => r.match && r.from === reco && r.to === truth)?.match?.in;
  const allFacts = facts(header).filter((f) => f.from === truth), here = allFacts.filter((f) => f.in === rootIn);
  const hitFacts = here.length ? here : allFacts, hitTables = new Set(hitFacts.map((f) => f.to));
  // The reco root last: the candidates holding the particle's other objects are known by then.
  const tables = [...new Set(header.display.filter((d) => !d.context).map((d) => d.table))].sort((a, b) => Number(a === reco) - Number(b === reco));
  for (const t of tables) {
    const n = ev.tables[t]?.n ?? 0, cand = recoOf(t), tr = truthOf(t), inSet = members.get(t), out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const c = cand ? cand[i] : -1, fromP = anyParticle && !!tr && has(tr[i]), inC = !!inSet?.has(i);
      // Candidates: the pair's; split if they hold the particle's objects or are matched to it (a fragment).
      out[i] = t === reco ? (i === candidate ? (anyParticle ? PAIR.matched : PAIR.reco) : splitCands.has(i) || fromP ? PAIR.split : PAIR.other)
        // Truth layers: only the pair's particle and the one the selection points at (its whole shower, hundreds of
        // secondaries and their vertices, would bury the picture; the shower shows through its hits).
        : truthTables.has(t) ? (t === truth && (i === particle || i === raw) ? PAIR.matched : PAIR.other)
        : inC ? (!anyParticle ? PAIR.reco : fromP ? PAIR.matched : PAIR.contamination)
        : fromP ? (c >= 0 ? PAIR.split : cand ? PAIR.missed : PAIR.other) : PAIR.other;
      if (out[i] === PAIR.split) splitCands.add(c);
    }
    classes.set(t, out);
  }

  // Efficiency over the particle's shower, each hit counted once: only the shower's highest particles that own hits
  // (a particle's hits include its descendants'). Purity over the candidate's hits.
  let efficiency: Pair["efficiency"], purity: Pair["purity"];
  if (anyParticle && key && ids) {
    efficiency = { candidate: 0, others: 0, missed: 0 };
    const owns = new Uint8Array(key.length), hitRels = hitFacts.map((f) => [f.name, header.relations[f.name]] as const).filter(([name, info]) =>
      ev.relations[name] && !header.display.find((d) => d.table === info.to)?.alternative);
    for (const [name] of hitRels) { const o = ev.relations[name].offsets; for (let p = 0; p + 1 < o.length; p++) if (o[p + 1] > o[p]) owns[p] = 1; }
    const top = (p: number) => { for (let a = ids.parent[p], steps = 0; a >= 0 && steps < key.length; a = ids.parent[a], steps++) { if (owns[a] && has(key[a])) return false; } return true; };
    for (const [name, info] of hitRels) {
      const rel = ev.relations[name], cand = recoOf(info.to), inSet = members.get(info.to), w = rel.weights[info.best?.weight ?? info.weights[0]];
      for (let p = 0; p + 1 < rel.offsets.length; p++) {
        if (!has(key[p]) || !top(p)) continue;
        for (let k = rel.offsets[p]; k < rel.offsets[p + 1]; k++) {
          const h = rel.indices[k], e = w ? w[k] : 1;
          if (inSet?.has(h)) efficiency.candidate += e; else if (cand && cand[h] >= 0) efficiency.others += e; else efficiency.missed += e;
        }
      }
    }
  }
  if (candidate >= 0 && anyParticle) {
    purity = { particle: 0, other: 0 };
    for (const t of hitTables) {
      const cls = classes.get(t), energy = ev.tables[t]?.columns.energy;
      if (!cls || !energy || header.display.find((d) => d.table === t)?.alternative) continue;
      for (let i = 0; i < cls.length; i++)
        if (cls[i] === PAIR.matched) purity.particle += Number(energy[i]); else if (cls[i] === PAIR.contamination) purity.other += Number(energy[i]);
    }
  }
  return { particle, merged, matched: raw, candidate, truth, reco, classes, efficiency, purity };
}

/** Whether the pair has anything to show: a candidate, or a particle that left hits (which then show as missed or in
 *  other candidates). Not, e.g., for a particle or track that never reached the calorimeter: the selection is then
 *  shown on its own (its parts and links), not as a pair. */
export const pairShows = (p: Pair) => p.candidate >= 0 || (!!p.efficiency && p.efficiency.candidate + p.efficiency.others + p.efficiency.missed > 0);
