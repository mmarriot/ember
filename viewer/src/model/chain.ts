// The ladder of a selection: its place in the chain of objects, and at every step what the truth says. One layout
// for every kind (ui/Navigator.tsx):
// - a reco object: what it is part of (above), itself, what it is made of (below, top first) and what else is built
//   only from its parts (beside: a secondary vertex whose tracks are all in the jet); each step with its link to the
//   truth, in the words of docs/truth.md: matched by CMSSW, a simulation fact, derived in evd, or no truth for the kind;
// - a truth object: per reco kind with an association, what was reconstructed from it (and where nothing was).
// Nothing here is a new truth statement: the links are the associations, facts and stand-ins the bundle already has,
// counted per step. A kind that gains an associator in CMSSW gets a relation with a `match` hint in its profile, and
// its steps then show that match instead of "no truth" with no change here.
import { type DisplayLayer, type EventData, type Header, kindName } from "../io/bundle";
import { factIn } from "./facts";
import { focusLevels } from "./levels";
import { bestPurities, simEnergyByParticle, type TruthStatus } from "./match";
import { bestPartners, contentPartners, levelsOf, type Ref, type Related } from "./relations";

/** What the truth says about the objects of one step. `partners`: truth rows, most objects first. */
export type Link =
  | { kind: "match"; truth: string; measure: string; good?: number; of: number; matched: number; clean: number; partners: [number, number][]; purity?: number } // purity: of a single object's match
  | { kind: "fact"; in: string; truth: string; total: number; particles: [number, number][] } // [truth row, share 0..1], largest first
  | { kind: "derived"; truth: string; reason: string; gap?: number; of: number; partners: [number, number][] }
  | { kind: "none"; reason: string; gap?: number }
  | { kind: "container" };

export interface Group { table: string; rows: number[] }
/** One step of the ladder: the objects of one kind. `voted`: not named by a relation, but the object holding most of
 *  the selection's parts (evd's vote, e.g. a trackster's candidate): the share of the parts it holds. */
export interface Rung { kind: string; groups: Group[]; count: number; links: Link[]; voted?: number }
export interface Ladder { above: Rung[]; self: Rung; below: Rung[]; beside: Rung[] }

const layerOf = (header: Header, table: string): DisplayLayer | undefined => header.display.find((l) => l.table === table);
const stageOf = (header: Header, table: string) => header.display.find((l) => l.table === table && l.stage !== undefined)?.stage;

/** The ladder of reco object `sel`. `parts`: its relatedParts; `statuses`: each table's truth status (model/match.ts);
 *  `truth`: the truth particles' table, for evd's stand-in (layer clusters). */
export function recoLadder(ev: EventData, header: Header, sel: Ref, parts: { madeOf: Related; partOf: Related; linked: Related },
  statuses: Map<string, TruthStatus>, truth?: string): Ladder {
  // What is inside it: what it is made of, and what is built only from that (model/relations.ts levelsOf).
  const inside = levelsOf(ev, header, sel, { ...parts, linked: new Map() });
  const below: Related = new Map(), beside: Related = new Map();
  for (const [t, rows] of inside) {
    if (t === sel.table || !rows.size) continue;
    // Named by its relations, or an earlier step of its own reconstruction (a candidate's tracksters): below. Anything
    // else built from its parts (a tau made of the jet's PF candidates) is beside it, not a part of it.
    (parts.madeOf.has(t) || stageOf(header, t) !== undefined ? below : beside).set(t, rows);
  }
  const rung = (name: string, layers: DisplayLayer[], from: Related): Rung => {
    const groups = [...new Set(layers.map((d) => d.table))].map((table) => ({ table, rows: [...(from.get(table) ?? [])].sort((a, b) => a - b) })).filter((g) => g.rows.length);
    return { kind: name, groups, count: groups.reduce((s, g) => s + g.rows.length, 0), links: linksOf(ev, header, groups, statuses, truth) };
  };
  // Holders before what they hold (model/levels.ts gives each kind its depth), so each list reads down the chain.
  const rungs = (from: Related) => focusLevels(header.display, sel.table, from, () => true, header.relations)
    .map((l, i) => ({ l, i })).sort((a, b) => (a.l.depth ?? 0) - (b.l.depth ?? 0) || a.i - b.i).map(({ l }) => rung(l.name, l.layers, from));
  const own = layerOf(header, sel.table), self = rung(own ? kindName(own) : sel.table, own ? [own] : [], new Map([[sel.table, new Set([sel.row])]]));
  if (!self.groups.length) self.groups = [{ table: sel.table, rows: [sel.row] }], self.count = 1;
  return { above: [...voted(ev, header, sel, parts.partOf, statuses, truth), ...rungs(parts.partOf)], self, below: rungs(below), beside: rungs(beside) };
}

/** Later steps of the selection's reconstruction that no relation names as containing it (a trackster's linked
 *  trackster, interpretation and candidate): for each such table, the object holding most of the selection's parts
 *  (contentPartners), latest step first. evd's vote, marked as such (`voted`). */
function voted(ev: EventData, header: Header, sel: Ref, partOf: Related, statuses: Map<string, TruthStatus>, truth?: string): Rung[] {
  const own = stageOf(header, sel.table), n = ev.tables[sel.table]?.n ?? 0, out: (Rung & { stage: number })[] = [];
  if (own === undefined) return [];
  for (const d of header.display) {
    if (d.stage === undefined || d.stage <= own || d.alternative || d.truth || partOf.has(d.table) || out.some((r) => r.groups[0].table === d.table)) continue;
    const c = contentPartners(sel.table, d.table, n, ev, header), row = c.partner[sel.row];
    if (!c.parts || row === undefined || row < 0) continue;
    const groups = [{ table: d.table, rows: [row] }];
    out.push({ kind: kindName(d), groups, count: 1, links: linksOf(ev, header, groups, statuses, truth), voted: c.share[sel.row], stage: d.stage });
  }
  return out.sort((a, b) => b.stage - a.stage).map(({ stage: _, ...r }) => r);
}

/** The truth links of the objects in `groups` (one kind): matches counted per truth table, facts per detector (never
 *  summed across detectors), evd's stand-in, or why there is none. */
export function linksOf(ev: EventData, header: Header, groups: Group[], statuses: Map<string, TruthStatus>, truth?: string): Link[] {
  const out: Link[] = [], factRows: Related = new Map();
  const tally = (counts: Map<number, number>) => [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const matches = new Map<string, { link: Extract<Link, { kind: "match" }>; counts: Map<number, number> }>();
  for (const g of groups) {
    const s = statuses.get(g.table), n = ev.tables[g.table]?.n ?? 0;
    if (!s) continue;
    if (s.kind === "match") {
      const info = header.relations[s.relation], rel = ev.relations[s.relation];
      if (!rel) continue; // the association is not in this event
      const { partner } = bestPartners(rel, info, true, n), purity = bestPurities(ev, header, s.relation);
      const m = matches.get(info.to) ?? { link: { kind: "match" as const, truth: info.to, measure: s.match.measure, good: s.match.good, of: 0, matched: 0, clean: 0, partners: [] }, counts: new Map<number, number>() };
      for (const r of g.rows) {
        m.link.of++;
        const p = partner[r];
        if (p === undefined || p < 0) continue;
        m.link.matched++;
        if (s.match.good !== undefined && purity && purity[r] >= s.match.good) m.link.clean++;
        if (purity && !Number.isNaN(purity[r])) m.link.purity = purity[r];
        m.counts.set(p, (m.counts.get(p) ?? 0) + 1);
      }
      matches.set(info.to, m);
    } else if (s.kind === "fact") factRows.set(g.table, new Set(g.rows));
    else if (s.kind === "derived" && truth) {
      const c = contentPartners(g.table, truth, n, ev, header), counts = new Map<number, number>();
      for (const r of g.rows) if (c.partner[r] >= 0) counts.set(c.partner[r], (counts.get(c.partner[r]) ?? 0) + 1);
      out.push({ kind: "derived", truth, reason: s.reason, gap: s.gap, of: g.rows.length, partners: tally(counts) });
    } else if (s.kind === "none") { if (!out.some((l) => l.kind === "none" && l.reason === s.reason)) out.push({ kind: "none", reason: s.reason, gap: s.gap }); }
    else if (s.kind === "container" && !out.some((l) => l.kind === "container")) out.push({ kind: "container" });
  }
  for (const { link, counts } of matches.values()) out.unshift({ ...link, partners: tally(counts), purity: link.of === 1 ? link.purity : undefined });
  if (factRows.size) // a hit table of a less preferred path (legacy next to SoA) would count each hit twice
    for (const g of simEnergyByParticle(ev, header, factRows, (t) => !layerOf(header, t)?.alternative))
      out.push({ kind: "fact", in: g.in, truth: g.table, total: g.total, particles: g.particles.map(([p, e]) => [p, e / g.total]) });
  return out;
}

/** What was reconstructed from truth object `sel`, one entry per reco table with an association from its table (the
 *  truth -> reco maps), latest reconstruction step first: the objects sharing hits or energy with it, most complete
 *  first, each with its completeness (the share of the truth object it holds, where the association gives one) and
 *  whether the truth object is that reco object's own best match. An empty entry: nothing of that kind shares anything
 *  with it. `hits`: per detector, the hits it left simulated energy in (facts). */
export interface Reconstructed { table: string; measure?: string; in?: string; partners: { row: number; completeness?: number; best: boolean }[] }
export interface Deposits { in: string; hits: number; energy: number; weight: string }
export function recoOfTruth(ev: EventData, header: Header, sel: Ref): { reco: Reconstructed[]; hits: Deposits[] } {
  const reco: Reconstructed[] = [], hits = new Map<string, Deposits>();
  for (const [name, info] of Object.entries(header.relations)) {
    const rel = ev.relations[name], to = layerOf(header, info.to);
    if (!info.association || info.from !== sel.table || !rel || !to || to.truth || to.alternative || sel.row + 1 >= rel.offsets.length) continue;
    const lo = rel.offsets[sel.row], hi = rel.offsets[sel.row + 1], where = factIn(header, name);
    if (where !== undefined) { // a simulation fact: the hits it left energy in, per detector
      const weight = info.best?.weight ?? info.weights[0] ?? "", w = weight ? rel.weights[weight] : undefined;
      const d = hits.get(where) ?? { in: where, hits: 0, energy: 0, weight };
      d.hits += hi - lo;
      if (w) for (let k = lo; k < hi; k++) d.energy += w[k];
      if (hi > lo) hits.set(where, d);
      continue;
    }
    // Whether it is the reco object's own best match: the reco -> truth map read forwards.
    const back = Object.entries(header.relations).find(([n, r]) => r.association && r.from === info.to && r.to === sel.table && ev.relations[n]);
    const own = back ? bestPartners(ev.relations[back[0]], back[1], true, ev.tables[info.to]?.n ?? 0).partner : undefined;
    const c = info.match?.completeness, cw = c ? rel.weights[c.weight] : undefined;
    const partners = Array.from({ length: hi - lo }, (_, i) => {
      const k = lo + i, row = rel.indices[k];
      return { row, completeness: cw ? (c!.complement ? 1 - cw[k] : cw[k]) : undefined, best: own?.[row] === sel.row };
    }).sort((a, b) => (b.completeness ?? 0) - (a.completeness ?? 0) || Number(b.best) - Number(a.best) || a.row - b.row);
    reco.push({ table: info.to, measure: info.match?.measure, in: info.match?.in, partners });
  }
  const order = (t: string) => header.display.findIndex((l) => l.table === t);
  reco.sort((a, b) => (stageOf(header, b.table) ?? -1) - (stageOf(header, a.table) ?? -1) || order(a.table) - order(b.table));
  return { reco, hits: [...hits.values()] };
}
