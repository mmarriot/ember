// How good a reco <-> truth match is, in linear numbers a reader can take at face value (docs/truth.md): purity (the
// share of the reco object's hits or energy that came from the particle) and completeness (the share of the
// particle's hits or energy that the object has), from an association's `match` hint. The associator's own score is
// a ranking (0 best, squared for calorimeter objects), not a fraction, so it is shown next to these, never instead.
import type { EventData, Header, Match } from "../io/bundle";
import { evaluate } from "./custom";
import { bestPartners, cached } from "./relations";

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
  if (!match || !rel || !match.shared) return undefined;
  const shared = rel.weights[match.shared]?.[k], own = ownAmount(ev, info.from, match)?.[row], score = info.best?.order === "min" ? rel.weights[info.best.weight]?.[k] : undefined;
  if (shared === undefined) return undefined;
  const purity = own && own > 0 ? Math.min(1, shared / own) : undefined;
  return { match, shared, over: own, purity, score, clean: purity !== undefined && match.good !== undefined ? purity >= match.good : undefined };
}

/** Per object of the `from` table of reco -> truth relation `name`: the purity of its best match (NaN without one, or
 *  without a `match` hint). Once per event. */
export function bestPurities(ev: EventData, header: Header, name: string): Float32Array | null {
  const info = header.relations[name], rel = ev.relations[name];
  if (!info?.match?.shared || !rel) return null;
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
