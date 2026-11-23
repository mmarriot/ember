// What the truth says about a reco object, as the card's truth block reads it (docs/truth.md "The card"): its kind's own
// association (or why there is none), then, for each step of its parts that has an association of its own, each
// part's own match. Built only from the associations in the file, never combined: no verdict for the object from its
// parts, no ranking of particles over several parts. A part's line names the part, its particle, and the purity and
// completeness of that match, each labelled.
import type { EventData, Header, Match } from "../../io/format";
import { type Ladder, recoOfTruth } from "../event/chain";
import { completeness, quality, type TruthStatus } from "./match";
import { truthToReco } from "./pair";
import { bestPartners } from "../event/relations";

/** One part's own match: part `row` of `table`, matched to truth row `particle` (-1: not matched). */
export interface PartMatch {
  table: string;
  row: number;
  particle: number;
  purity?: number;
  completeness?: number;
  clean?: boolean;
}
/** The parts of one collection in one step that have their own association: `of` of them, `matched` with a match
 *  (`clean` of those at or above the kind's `good` purity); `rows`: all of them; `objects`: each matched part's match, purest first.
 *  `beside`: objects built only from the selection's parts (a PF cluster inside an electron's supercluster), not
 *  named by a relation as its parts. */
export interface PartLine {
  table: string;
  truth: string;
  relation: string;
  match: Match;
  rows: number[];
  of: number;
  matched: number;
  clean: number;
  objects: PartMatch[];
  beside: boolean;
}
export interface Statement {
  own: TruthStatus | undefined;
  parts: PartLine[];
}

/** The truth statement of the reco object whose ladder is `lad` (model/event/chain.ts recoLadder). */
export function truthStatement(
  ev: EventData,
  header: Header,
  lad: Ladder,
  statuses: Map<string, TruthStatus>,
): Statement {
  const parts: PartLine[] = [];
  const steps = [...lad.below.map((r) => [r, false] as const), ...lad.beside.map((r) => [r, true] as const)];
  for (const [rung, beside] of steps)
    for (const g of rung.groups) {
      const s = statuses.get(g.table);
      if (s?.kind !== "match") continue;
      const info = header.relations[s.relation],
        rel = ev.relations[s.relation];
      if (!info || !rel) continue;
      const { partner, entry } = bestPartners(rel, info, true, ev.tables[g.table]?.n ?? 0);
      const line: PartLine = {
        table: g.table,
        truth: info.to,
        relation: s.relation,
        match: s.match,
        rows: g.rows,
        of: g.rows.length,
        matched: 0,
        clean: 0,
        objects: [],
        beside,
      };
      for (const row of g.rows) {
        const p = partner[row];
        if (p === undefined || p < 0) continue;
        const q = quality(ev, header, s.relation, entry[row], row),
          c = completeness(ev, header, info.to, p, g.table, row);
        line.matched++;
        if (s.match.good === undefined || q?.clean) line.clean++;
        line.objects.push({
          table: g.table,
          row,
          particle: p,
          purity: q?.purity,
          completeness: c?.value,
          clean: q?.clean,
        });
      }
      line.objects.sort((a, b) => (b.purity ?? 0) - (a.purity ?? 0) || a.row - b.row);
      parts.push(line);
    }
  return { own: statuses.get(lad.self.groups[0]?.table ?? ""), parts };
}

/** A particle X can go to from an object without a match of its own: a matched part's own match, with what that match
 *  counts (`measure`: the particle is named by its energy next to a calorimeter object), whether the part is the only
 *  one of its collection in its step (`alone`: its track, its one PF cluster), and whether it is only built from the
 *  object's parts (`beside`: a PF cluster inside an electron's supercluster). */
export type PartChoice = PartMatch & { truth: string; measure: string; alone: boolean; beside: boolean };

/** The particles X can go to from an object without a match of its own: each matched part's own particle (at most
 *  `max`), one entry per particle, with the part that names it. Its own parts first, then those only built from them
 *  (an electron's PF clusters, inside its supercluster). Among parts whose matches count the same thing (energy;
 *  tracker hits) the larger part (`size`: a cluster's energy, a track's pT) comes first, so a 1.85 GeV pile-up
 *  photon's cluster does not come before the τ's 96 GeV one; parts counting different things keep the steps' order
 *  (a track's pT is not compared with a cluster's energy). The first is where X goes again. An order of the parts,
 *  never a ranking of particles over several parts. */
export function partChoices(
  st: Statement,
  max = Infinity,
  size: (table: string, row: number) => number = () => 0,
): PartChoice[] {
  const ordered = (ls: PartLine[]) => {
    const measures = [...new Set(ls.map((l) => l.match.measure))];
    return measures.flatMap((m) =>
      ls
        .filter((l) => l.match.measure === m)
        .flatMap((line) => line.objects.map((o) => ({ line, o })))
        .sort((a, b) => size(b.o.table, b.o.row) - size(a.o.table, a.o.row)),
    );
  };
  const out: PartChoice[] = [];
  for (const { line, o } of [
    ...ordered(st.parts.filter((l) => !l.beside)),
    ...ordered(st.parts.filter((l) => l.beside)),
  ])
    if (out.length < max && !out.some((x) => x.truth === line.truth && x.particle === o.particle))
      out.push({ ...o, truth: line.truth, measure: line.match.measure, alone: line.of === 1, beside: line.beside });
  return out;
}

/** The part whose match the card names for an object without a match of its own (an electron's or a muon's track, a
 *  photon's PF cluster): its matched parts that are alone in their collection in their step (its own parts; else those
 *  only built from them), when they all name one particle; the first of them. Parts that disagree (a charged PF
 *  candidate's track on a π⁺, its HCAL cluster on a K⁰L), or a jet's or a τ's several tracks: none is named, X offers
 *  them all. */
export function leadChoice(choices: PartChoice[]) {
  const own = choices.filter((c) => !c.beside),
    from = own.length ? own : choices,
    alone = from.filter((c) => c.alone);
  // a part not alone in its step is matched elsewhere too: then the alone ones do not speak for the object
  if (!alone.length || alone.length !== from.length) return undefined;
  return alone.every((c) => c.truth === alone[0].truth && c.particle === alone[0].particle) ? alone[0] : undefined;
}

/** Where truth row `particle` went among the objects of `table` (W2; docs/truth.md): every object its truth -> reco
 *  association gives it, most complete first, with that completeness and whether the particle is the object's own
 *  best match (recoOfTruth); and `merges`: the other particles whose best object there (their TruthToReco best) is
 *  `row`. The associator's answers only. */
export function whereItWent(
  ev: EventData,
  header: Header,
  truth: string,
  particle: number,
  table: string,
  row: number,
) {
  const objects = recoOfTruth(ev, header, { table: truth, row: particle }).reco.find(
    (r) => r.table === table,
  )?.partners;
  const t2r = truthToReco(header, truth, table),
    merges: number[] = [];
  if (t2r && ev.relations[t2r[0]]) {
    const best = bestPartners(ev.relations[t2r[0]], t2r[1], true, ev.tables[truth]?.n ?? 0).partner;
    for (let q = 0; q < best.length; q++) if (q !== particle && best[q] === row) merges.push(q);
  }
  return { objects: objects ?? [], merges };
}
