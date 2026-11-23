// Finding truth particles: the truth search, the particles in a view (the Truth tab), and the reco kinds without an
// associator a particle could have reached.
import type { EventData, Header } from "../../io/format";
import { bestPartners } from "../event/relations";
import { facts, simEnergyIn } from "./facts";
import type { Graph } from "./graph";
import { completeness } from "./match";
import { comparedKind, truthToReco } from "./pair";

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
    const sum = simEnergyIn(ev, header, mine, det, n);
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
