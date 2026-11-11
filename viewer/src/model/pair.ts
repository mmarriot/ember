// The truth <-> reco pair: a truth particle (its whole shower) and the candidate that best reconstructs it, and where
// each of their objects ended up. Selecting the particle, the candidate or anything inside them gives the same pair,
// so the picture does not change when you click from one to the other.
import type { DisplayLayer, EventData, Header } from "../io/bundle";
import type { ColourBy } from "./modes";
import { bestPartners, cached, contentPartners, identities, type Ref } from "./relations";

/** What an object is in the pair view. */
export const PAIR = { other: 0, matched: 1, contamination: 2, split: 3, missed: 4 } as const;
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
  candidate: number; // reco root row, -1 for none
  truth?: string; reco: string; // the two root tables
  classes: Map<string, Uint8Array>; // per drawn table, a PairClass per object
  /** The particle's simulated energy (summed over its shower) in hits: in the candidate, in other candidates, in none. */
  efficiency?: { candidate: number; others: number; missed: number };
  /** The candidate's hit energy: from the particle, from anything else. */
  purity?: { particle: number; other: number };
}

/** The pair for the focus. `roots`, `colourings`: of the truth and reco modes (model/modes.ts); `truthLayer`: the
 *  display layer of the truth root, whose keys (identities) group a particle's shower. */
export function pairFor(ev: EventData, header: Header, focus: Ref, roots: { truth?: string; reco: string },
  colourings: { truth?: Record<string, ColourBy>; reco: Record<string, ColourBy> }, truthLayer?: DisplayLayer): Pair {
  const { truth, reco } = roots, recoOf = (t: string) => rootRows(ev, header, colourings.reco, t);
  const key = truth && truthLayer && ev.tables[truth] ? identities(truthLayer, ev.tables[truth], ev, header, 0).key : undefined;
  const truthOf = (t: string) => {
    const r = truth && colourings.truth ? rootRows(ev, header, colourings.truth, t) : null;
    return r && key ? r.map((p) => (p < 0 ? -1 : key[p])) : null;
  };
  // Each particle's best candidate: the association from the truth root to the reco root (its `best` weight).
  const toReco = Object.entries(header.relations).find(([name, r]) => r.association && r.from === truth && r.to === reco && ev.relations[name]);
  const bestCand = (p: number) => {
    if (!toReco || p < 0) return -1;
    const [name, info] = toReco;
    return bestPartners(ev.relations[name], info, true, ev.tables[truth!]?.n ?? 0).partner[p] ?? -1;
  };
  let particle = -1, candidate = -1;
  if (focus.table === truth && key) {
    particle = key[focus.row];
    candidate = bestCand(particle) >= 0 ? bestCand(particle) : bestCand(focus.row);
  } else {
    const c = recoOf(focus.table)?.[focus.row] ?? -1;
    if (c >= 0) { candidate = c; particle = truthOf(reco)?.[c] ?? -1; }
    else { particle = truthOf(focus.table)?.[focus.row] ?? -1; candidate = bestCand(particle); }
  }

  const classes = new Map<string, Uint8Array>(), splitCands = new Set<number>();
  const hitTables = new Set(header.display.filter((d) => d.repr === "cells" && !d.context).map((d) => d.table));
  const tables = [...new Set(header.display.filter((d) => !d.context).map((d) => d.table))].sort((a, b) => Number(hitTables.has(b)) - Number(hitTables.has(a)));
  for (const t of tables) { // hits first: the candidates holding the particle's other hits are known before candidates
    const n = ev.tables[t]?.n ?? 0, cand = recoOf(t), tr = truthOf(t), out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const c = cand ? cand[i] : -1, fromP = particle >= 0 && !!tr && tr[i] === particle, inC = candidate >= 0 && c === candidate;
      out[i] = t === reco ? (i === candidate ? PAIR.matched : splitCands.has(i) ? PAIR.split : PAIR.other)
        : t === truth ? (fromP ? PAIR.matched : PAIR.other)
        : inC ? (fromP ? PAIR.matched : PAIR.contamination)
        : fromP ? (cand && c >= 0 ? PAIR.split : cand ? PAIR.missed : PAIR.other) : PAIR.other;
      if (out[i] === PAIR.split && hitTables.has(t)) splitCands.add(c);
    }
    classes.set(t, out);
  }

  // Efficiency over the particle's whole shower (any share of a hit), purity over the candidate's hits.
  let efficiency: Pair["efficiency"], purity: Pair["purity"];
  if (particle >= 0 && key) {
    efficiency = { candidate: 0, others: 0, missed: 0 };
    for (const [name, info] of Object.entries(header.relations)) {
      const rel = ev.relations[name], cand = hitTables.has(info.to) ? recoOf(info.to) : null;
      if (!rel || !info.association || info.from !== truth || !cand || header.display.find((d) => d.table === info.to)?.alternative) continue;
      const w = rel.weights[info.best?.weight ?? info.weights[0]];
      for (let p = 0; p + 1 < rel.offsets.length; p++) {
        if (key[p] !== particle) continue;
        for (let k = rel.offsets[p]; k < rel.offsets[p + 1]; k++) {
          const c = cand[rel.indices[k]], e = w ? w[k] : 1;
          if (c === candidate && c >= 0) efficiency.candidate += e; else if (c >= 0) efficiency.others += e; else efficiency.missed += e;
        }
      }
    }
  }
  if (candidate >= 0) {
    purity = { particle: 0, other: 0 };
    for (const t of hitTables) {
      const cls = classes.get(t), energy = ev.tables[t]?.columns.energy;
      if (!cls || !energy || header.display.find((d) => d.table === t)?.alternative) continue;
      for (let i = 0; i < cls.length; i++)
        if (cls[i] === PAIR.matched) purity.particle += Number(energy[i]); else if (cls[i] === PAIR.contamination) purity.other += Number(energy[i]);
    }
  }
  return { particle, candidate, truth, reco, classes, efficiency, purity };
}
