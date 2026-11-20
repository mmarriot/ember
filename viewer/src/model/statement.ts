// What the truth says about a reco object, as the card's truth block reads it (docs/truth.md "The card"): its kind's own
// association (or why there is none), then, for each step of its parts that has an association of its own, each
// part's own match. Built only from the associations in the file, never combined: no verdict for the object from its
// parts, no ranking of particles over several parts. A part's line names the part, its particle, and the purity and
// completeness of that match, each labelled.
import type { EventData, Header, Match } from "../io/format";
import { type Ladder, recoOfTruth } from "./chain";
import { completeness, quality, type TruthStatus } from "./match";
import { truthToReco } from "./pair";
import { bestPartners } from "./relations";

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

/** The truth statement of the reco object whose ladder is `lad` (model/chain.ts recoLadder). */
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

/** The particles X can go to from an object without a match of its own: each matched part's own particle (at most
 *  `max`), in the statement's order; one entry per particle, with the part that names it. Not those of the objects
 *  only built from its parts (`beside`): no relation makes them its parts. */
export function partChoices(st: Statement, max = 8): (PartMatch & { truth: string })[] {
  const out: (PartMatch & { truth: string })[] = [];
  for (const line of st.parts.filter((l) => !l.beside))
    for (const o of line.objects)
      if (out.length < max && !out.some((x) => x.truth === line.truth && x.particle === o.particle))
        out.push({ ...o, truth: line.truth });
  return out;
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
