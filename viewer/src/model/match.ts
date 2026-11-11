// How good a reco <-> truth match is, in linear numbers a reader can take at face value (docs/truth.md): purity (the
// share of the reco object's hits or energy that came from the particle) and completeness (the share of the
// particle's hits or energy that the object has), from an association's `match` hint. The associator's own score is
// a ranking (0 best, squared for calorimeter objects), not a fraction, so it is shown next to these, never instead.
import type { EventData, Header, Match } from "../io/bundle";
import { evaluate } from "./custom";
import { facts } from "./facts";
import { type ColourBy, modeColouring, modeRoots } from "./modes";
import { bestPartners, cached, type Related } from "./relations";

/** What a reco kind reconstructs, in words, per `match.target`. */
export const TARGETS: Record<NonNullable<Match["target"]>, string> = {
  trackerHits: "the particle whose own tracker hits it collected",
  caloBoundary: "the particle that entered the calorimeter",
  particle: "the generator particle",
  interaction: "the collision it comes from (its truth vertex)",
  decayVertex: "the decay vertex of a b or c hadron",
};

/** The object's own amount (`over`: the first expression that can be computed on its table), once per event. */
export function ownAmount(ev: EventData, table: string, match: Match): Float32Array | null {
  return cached(ev, `over|${table}|${match.over?.join("|")}`, () => {
    const t = ev.tables[table];
    for (const expr of match.over ?? []) {
      const r = t ? evaluate(t, expr) : null;
      if (r && "values" in r) return r.values;
    }
    return null;
  });
}

export interface Quality {
  match: Match;
  shared: number; // hits or GeV (rechit scale) shared with the particle
  over?: number; // the object's own hits or energy
  purity?: number; // shared / over, 0..1
  score?: number; // the associator's score, 0 best (not a fraction)
  clean?: boolean; // purity >= match.good
}

/** The quality of entry `k` of reco -> truth relation `name` for its reco object `row`; undefined without a `match`. */
export function quality(ev: EventData, header: Header, name: string, k: number, row: number): Quality | undefined {
  const info = header.relations[name], rel = ev.relations[name], match = info?.match;
  if (!match || !rel || !(match.shared ?? match.purity)) return undefined;
  const score = info.best?.order === "min" ? rel.weights[info.best.weight]?.[k] : undefined;
  if (match.purity) { // the weight is the purity (e.g. a vertex's pT² share)
    const purity = rel.weights[match.purity]?.[k];
    if (purity === undefined) return undefined;
    return { match, shared: purity, purity, score, clean: match.good !== undefined ? purity >= match.good : undefined };
  }
  const shared = rel.weights[match.shared!]?.[k], own = ownAmount(ev, info.from, match)?.[row];
  if (shared === undefined) return undefined;
  const purity = own && own > 0 ? Math.min(1, shared / own) : undefined;
  return { match, shared, over: own, purity, score, clean: purity !== undefined && match.good !== undefined ? purity >= match.good : undefined };
}

/** Per object of the `from` table of reco -> truth relation `name`: the purity of its best match (NaN without one, or
 *  without a `match` hint). Once per event. */
export function bestPurities(ev: EventData, header: Header, name: string): Float32Array | null {
  const info = header.relations[name], rel = ev.relations[name];
  if (!(info?.match?.shared ?? info?.match?.purity) || !rel) return null;
  return cached(ev, `purity|${name}`, () => {
    const n = ev.tables[info.from]?.n ?? 0, { entry } = bestPartners(rel, info, true, n), out = new Float32Array(n).fill(NaN);
    for (let i = 0; i < n; i++) if (entry[i] >= 0) out[i] = quality(ev, header, name, entry[i], i)?.purity ?? NaN;
    return out;
  });
}

/** The completeness of the match of truth row `particle` with reco object `row` of `table`: the share of the
 *  particle's hits or energy (where its truth -> reco association counts them) that the object has. */
export function completeness(ev: EventData, header: Header, truth: string, particle: number, table: string, row: number): { value: number; match: Match } | undefined {
  for (const [name, info] of Object.entries(header.relations)) {
    const rel = ev.relations[name], c = info.match?.completeness;
    if (!c || !rel || info.from !== truth || info.to !== table || particle + 1 >= rel.offsets.length) continue;
    for (let k = rel.offsets[particle]; k < rel.offsets[particle + 1]; k++) {
      const w = rel.weights[c.weight]?.[k];
      if (rel.indices[k] === row && w !== undefined) return { value: c.complement ? 1 - w : w, match: info.match! };
    }
  }
  return undefined;
}

/** A purity or completeness as a percentage. */
export const percent = (x: number | undefined) => (x === undefined || Number.isNaN(x) ? "–" : `${Math.round(100 * x)}%`);

// What the truth graph says about each kind of object (docs/truth.md "Where truth stops"), the same words everywhere:
// the inspector's truth box, the colour key, the Truth tab's coverage list.

/** A drawn table's truth, in this order: `match`, its own reco -> truth association with a `match` hint (to the truth
 *  particles or vertices); `fact`, hits with the simulated energy each particle left in them; `derived`, evd's
 *  stand-in (layer clusters by the simulated energy in their hits); `none`, its kind's `truthGap` (why, and the gap
 *  in docs/truth-graph.md); `container`, drawn in the colour of what contains it (a track's hits); else `none`. */
export type TruthStatus =
  | { kind: "match"; relation: string; match: Match }
  | { kind: "fact"; in: string }
  | { kind: "derived"; reason: string; gap?: number }
  | { kind: "none"; reason: string; gap?: number }
  | { kind: "container"; relation: string };

export const NO_EXPORT = "no truth association exported for this kind";
const DERIVED = "no associator in CMSSW; evd shows the particle with the most simulated energy in its hits";

/** The truth status of `table` (undefined for truth layers and for a bundle without truth). `colouring`: the truth
 *  mode's (model/modes.ts), computed when not given. */
export function truthStatus(header: Header, table: string, colouring?: Record<string, ColourBy>): TruthStatus | undefined {
  const d = header.display.find((l) => l.table === table), truth = (t: string) => !!header.display.find((l) => l.table === t)?.truth;
  if (!d || d.truth) return undefined;
  const root = modeRoots(header).truth;
  if (!root) return undefined;
  const own = Object.entries(header.relations).find(([, r]) => r.match && r.from === table && truth(r.to));
  if (own) return { kind: "match", relation: own[0], match: own[1].match! };
  const fact = facts(header).find((f) => f.to === table);
  if (fact) return { kind: "fact", in: fact.in };
  const c = (colouring ?? modeColouring(header, root, true))[table];
  if (c && typeof c === "object" && "content" in c) return { kind: "derived", reason: d.truthGap?.reason ?? DERIVED, gap: d.truthGap?.gap };
  if (d.truthGap) return { kind: "none", reason: d.truthGap.reason, gap: d.truthGap.gap };
  if (c && typeof c === "object" && "relation" in c && !header.relations[c.relation]?.association) return { kind: "container", relation: c.relation };
  return { kind: "none", reason: NO_EXPORT };
}

/** Whether a selection of `table` may open the truth <-> reco pair: not for a kind with no truth of its own (a jet
 *  never opens a pair; its constituents may). Bundles without truth keep their pair (the candidate alone). */
export const opensPair = (header: Header, table: string, colouring?: Record<string, ColourBy>) =>
  truthStatus(header, table, colouring)?.kind !== "none";

/** What truth particles left in the given objects' hits, one group per detector (simulated energy is never summed
 *  across detectors: sampling and homogeneous calorimeters, photoelectrons in HF): per particle, the sum of the fact
 *  relations' weight over those hits, in hit layers for which `use` holds (e.g. drawn, so a hit is not counted twice
 *  through two hit tables). Largest first; groups without any energy are left out. */
export function simEnergyByParticle(ev: EventData, header: Header, objects: Related, use: (table: string) => boolean) {
  const groups = new Map<string, { in: string; table: string; weight: string; total: number; sums: Map<number, number> }>();
  for (const f of facts(header)) {
    const info = header.relations[f.name], rel = ev.relations[f.name], rows = objects.get(f.to), weight = info.best?.weight ?? info.weights[0];
    const w = weight ? rel?.weights[weight] : undefined;
    if (!rel || !rows || !w || !use(f.to)) continue;
    const g = groups.get(f.in) ?? { in: f.in, table: f.from, weight, total: 0, sums: new Map() };
    for (let p = 0; p + 1 < rel.offsets.length; p++)
      for (let k = rel.offsets[p]; k < rel.offsets[p + 1]; k++)
        if (rows.has(rel.indices[k])) { g.sums.set(p, (g.sums.get(p) ?? 0) + w[k]); g.total += w[k]; }
    groups.set(f.in, g);
  }
  return [...groups.values()].filter((g) => g.total > 0)
    .map(({ sums, ...g }) => ({ ...g, particles: [...sums].sort((a, c) => c[1] - a[1]) }));
}

