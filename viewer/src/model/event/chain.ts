// The ladder of a selection: its place in the chain of objects, and at every step what the truth says. One layout
// for every kind (drawn by ui/card/Chain.tsx):
// - a reco object: what it is part of (above), itself, what it is made of (below, top first) and what else is built
//   only from its parts (beside: a secondary vertex whose tracks are all in the jet); each step with its link to the
//   truth, in the words of docs/truth.md: matched by CMSSW, a simulation fact, or no truth for the kind;
// - a truth object: per reco kind with an association, what was reconstructed from it (and where nothing was).
// Nothing here is a new truth statement: the links are the associations and facts the bundle already has,
// counted per step. A kind that gains an associator in CMSSW gets a relation with a `match` hint in its profile, and
// its steps then show that match instead of "no truth" with no change here.
import { type DisplayLayer, type EventData, type Header, kindName } from "../../io/format";
import { factIn, facts } from "../truth/facts";
import { chainOrder, focusLevels } from "./levels";
import { bestPurities, percent, simEnergyByParticle, type TruthStatus } from "../truth/match";
import { bestPartners, contentPartners, levelsOf, type Ref, type Related } from "./relations";

/** What the truth says about the objects of one step, one line per truth table, detector or reason:
 *  - `match`: the CMSSW associator's matches into truth table `truth`: of `of` objects, `matched` have a match and
 *    `clean` a clean one (purity >= `good`); `partners`: [truth row, objects matched to it], most objects first;
 *    `purity`: the purity of the match, for a step of one object;
 *  - `fact`: the simulated energy left in the hits in detector `in`, `total` in all; `particles`: [truth row, share
 *    0..1], largest first;
 *  - `none`: no truth for the kind, and why;
 *  - `container`: drawn in the colour of what contains it.
 *  `label`: the collections the line is about, where those of the step differ in truth (muon rechits: fact; hits on
 *  muon tracks: none). `unranked`: the particles are not listed, because the selected object's kind has no truth of
 *  its own and a ranking of the particles in its parts would be a match through them (docs/truth.md
 *  "Constituents"): the statement stays on each hit or cluster. */
export type Link = { label?: string } & (
  | {
      kind: "match";
      truth: string;
      measure: string;
      good?: number;
      of: number;
      matched: number;
      clean: number;
      partners: [number, number][];
      purity?: number;
    }
  | { kind: "fact"; in: string; truth: string; total: number; particles: [number, number][]; unranked?: boolean }
  | { kind: "none"; reason: string; gap?: number }
  | { kind: "container" }
);

/** `held`: for an object no relation names as containing the selection (see `voted`), how many of the selection's
 *  `of` parts it holds. */
export interface Group {
  table: string;
  rows: number[];
  held?: [number, number];
}
/** One step of the ladder: the objects of one kind. `indent` and `via`: where it sits in its list's branches, and
 *  the other kinds that hold it (model/event/levels.ts chainOrder). */
export interface Rung {
  kind: string;
  groups: Group[];
  count: number;
  links: Link[];
  indent?: number;
  via?: string[];
}
/** `other`: related rows of tables the bundle does not draw (a hit's digi), under their table's name. */
export interface Ladder {
  above: Rung[];
  self: Rung;
  below: Rung[];
  beside: Rung[];
  other: Rung[];
}

const layerOf = (header: Header, table: string): DisplayLayer | undefined =>
  header.display.find((l) => l.table === table);
const stageOf = (header: Header, table: string) =>
  header.display.find((l) => l.table === table && l.stage !== undefined)?.stage;
const sorted = (rows: Iterable<number>) => [...rows].sort((a, b) => a - b);

/** The ladder of reco object `sel`. `parts`: its relatedParts; `statuses`: each table's truth status (model/truth/match.ts). */
export function recoLadder(
  ev: EventData,
  header: Header,
  sel: Ref,
  parts: { madeOf: Related; partOf: Related; linked: Related },
  statuses: Map<string, TruthStatus>,
): Ladder {
  // What is inside it: what it is made of, and what is built only from that (model/event/relations.ts levelsOf).
  const inside = levelsOf(ev, header, sel, { ...parts, linked: new Map() });
  const below: Related = new Map(),
    beside: Related = new Map();
  for (const [t, rows] of inside) {
    if (t === sel.table || !rows.size) continue;
    // Named by its relations, or an earlier step of its own reconstruction (a candidate's tracksters): below. Anything
    // else built from its parts (a tau made of the jet's PF candidates) is beside it, not a part of it.
    (parts.madeOf.has(t) || stageOf(header, t) !== undefined ? below : beside).set(t, rows);
  }
  // A kind with truth of its own may list the particles in its parts; for any other that would be a match through them.
  const kind = statuses.get(sel.table)?.kind,
    ranked = kind === "match" || kind === "fact";
  const rung = (name: string, tables: string[], from: Related, rank: boolean): Rung => {
    const groups = tables.map((table) => ({ table, rows: sorted(from.get(table) ?? []) })).filter((g) => g.rows.length);
    return {
      kind: name,
      groups,
      count: groups.reduce((s, g) => s + g.rows.length, 0),
      links: linksOf(ev, header, groups, statuses, rank),
    };
  };
  // Holders before what they hold, one branch at a time (model/event/levels.ts chainOrder), so each list reads down the
  // chain.
  const rungs = (from: Related, rank: boolean) =>
    chainOrder(focusLevels(header.display, sel.table, from, () => true, header.relations)).map(
      ({ level, indent, via }) => ({
        ...rung(level.name, [...new Set(level.layers.map((d) => d.table))], from, rank),
        indent,
        via,
      }),
    );
  const own = layerOf(header, sel.table),
    self = rung(own ? kindName(own) : sel.table, [sel.table], new Map([[sel.table, new Set([sel.row])]]), true);
  // A table read only as a polyline's points (a global muon track's hits, tracker ones too) is its shape, not other
  // objects: not listed.
  const points = new Set(
    header.display.flatMap((d) => (d.points ? [header.relations[d.points.relation]?.to] : [])).filter(Boolean),
  );
  const other = [...parts.partOf, ...below]
    .filter(([t, rows]) => rows.size && t !== sel.table && !layerOf(header, t) && !points.has(t))
    .map(([t, rows]) => ({ kind: t, groups: [{ table: t, rows: sorted(rows) }], count: rows.size, links: [] }));
  return {
    above: [...voted(ev, header, sel, parts, statuses), ...rungs(parts.partOf, true)],
    self,
    below: rungs(below, ranked),
    beside: rungs(beside, ranked),
    other,
  };
}

/** Later steps of the selection's reconstruction that no relation names as containing it (a trackster's linked
 *  trackster, interpretation and candidate): for each such table, the object holding the most of the selection's parts
 *  (contentPartners), if it holds at least half of them (counted: "3 of its 4 layer clusters"); latest step first, the
 *  collections of one kind in one step. Worked out in Ember, and marked as such (`held`). */
function voted(
  ev: EventData,
  header: Header,
  sel: Ref,
  parts: { madeOf: Related; partOf: Related },
  statuses: Map<string, TruthStatus>,
): Rung[] {
  const own = stageOf(header, sel.table),
    n = ev.tables[sel.table]?.n ?? 0,
    out: (Rung & { stage: number })[] = [];
  if (own === undefined) return [];
  for (const d of header.display) {
    if (
      d.stage === undefined ||
      d.stage <= own ||
      d.truth ||
      parts.partOf.has(d.table) ||
      out.some((r) => r.groups.some((g) => g.table === d.table))
    )
      continue;
    const c = contentPartners(sel.table, d.table, n, ev, header),
      row = c.partner[sel.row],
      mine = parts.madeOf.get(c.parts);
    if (!c.parts || row === undefined || row < 0 || !mine?.size) continue;
    const theirs = new Set<number>(); // the holder's parts in the same table, through any of its relations into it
    for (const [name, info] of Object.entries(header.relations)) {
      const rel = ev.relations[name];
      if (rel && !info.association && info.from === d.table && info.to === c.parts)
        for (const p of rel.indices.subarray(rel.offsets[row], rel.offsets[row + 1])) theirs.add(p);
    }
    let held = 0;
    for (const p of mine) if (theirs.has(p)) held++;
    if (2 * held < mine.size) continue;
    const group: Group = { table: d.table, rows: [row], held: [held, mine.size] },
      same = out.find((r) => r.kind === kindName(d));
    if (same) {
      same.groups.push(group);
      same.count++;
    } else out.push({ kind: kindName(d), groups: [group], count: 1, links: [], stage: d.stage });
  }
  return out
    .sort((a, b) => b.stage - a.stage)
    .map(({ stage: _, ...r }) => ({ ...r, links: linksOf(ev, header, r.groups, statuses, true) }));
}

/** The truth links of the objects in `groups` (one kind): matches counted per truth table, facts per detector (never
 *  summed across detectors), or why there is none. `rank`: whether the particles behind a fact of several objects may
 *  be listed (see Link `unranked`); without it they are not worked out at all. */
function linksOf(
  ev: EventData,
  header: Header,
  groups: Group[],
  statuses: Map<string, TruthStatus>,
  rank: boolean,
): Link[] {
  const out: (Link & { tables: string[] })[] = [],
    factRows: Related = new Map();
  const tally = (counts: Map<number, number>) => [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const matches = new Map<
    string,
    { link: Extract<Link, { kind: "match" }>; counts: Map<number, number>; tables: string[] }
  >();
  const several = groups.reduce((s, g) => s + g.rows.length, 0) > 1,
    listed = rank || !several;
  // A step of several matched collections (linked tracksters: Trackster links, Superclustering DNN) has a line each.
  const split = groups.filter((g) => statuses.get(g.table)?.kind === "match").length > 1;
  const none = (table: string, reason: string, gap?: number) => {
    const same = out.find((l) => l.kind === "none" && l.reason === reason);
    if (same) same.tables.push(table);
    else out.push({ kind: "none", reason, gap, tables: [table] });
  };
  for (const g of groups) {
    const s = statuses.get(g.table),
      n = ev.tables[g.table]?.n ?? 0;
    if (!s) continue;
    if (s.kind === "match") {
      const info = header.relations[s.relation],
        rel = ev.relations[s.relation];
      if (!rel) {
        none(g.table, "its association is not in this event");
        continue;
      }
      const { partner } = bestPartners(rel, info, true, n),
        purity = bestPurities(ev, header, s.relation);
      const key = split ? `${info.to}|${g.table}` : info.to;
      const m = matches.get(key) ?? {
        link: {
          kind: "match" as const,
          truth: info.to,
          measure: s.match.measure,
          good: s.match.good,
          of: 0,
          matched: 0,
          clean: 0,
          partners: [],
        },
        counts: new Map<number, number>(),
        tables: [],
      };
      m.tables.push(g.table);
      for (const r of g.rows) {
        m.link.of++;
        const p = partner[r];
        if (p === undefined || p < 0) continue;
        m.link.matched++;
        if (s.match.good !== undefined && purity && purity[r] >= s.match.good) m.link.clean++;
        if (purity && !Number.isNaN(purity[r])) m.link.purity = purity[r];
        m.counts.set(p, (m.counts.get(p) ?? 0) + 1);
      }
      matches.set(key, m);
    } else if (s.kind === "fact") factRows.set(g.table, new Set(g.rows));
    else if (s.kind === "none") none(g.table, s.reason, s.gap);
    else if (s.kind === "container") {
      const same = out.find((l) => l.kind === "container");
      if (same) same.tables.push(g.table);
      else out.push({ kind: "container", tables: [g.table] });
    }
  }
  for (const { link, counts, tables } of matches.values())
    out.unshift({
      ...link,
      partners: listed ? tally(counts) : [],
      purity: link.of === 1 ? link.purity : undefined,
      tables,
    });
  // Facts, one line per detector.
  const sums = listed && factRows.size ? simEnergyByParticle(ev, header, factRows) : [];
  for (const where of new Set(
    facts(header)
      .filter((f) => factRows.has(f.to))
      .map((f) => f.in),
  )) {
    const fs = facts(header).filter((f) => f.in === where && factRows.has(f.to)),
      g = sums.find((x) => x.in === where);
    out.push({
      kind: "fact",
      in: where,
      truth: fs[0].from,
      total: g?.total ?? 0,
      particles: g ? g.particles.map(([p, e]) => [p, e / g.total]) : [],
      ...(listed ? {} : { unranked: true }),
      tables: [...new Set(fs.map((f) => f.to))],
    });
  }
  // Where the step's collections differ in truth, or each has its own line, each line names its own.
  const differ = split || new Set(groups.map((g) => statuses.get(g.table)?.kind)).size > 1;
  return out.map(({ tables, ...l }) =>
    differ ? { ...l, label: [...new Set(tables.map((t) => layerOf(header, t)?.label ?? t))].join(", ") } : l,
  );
}

/** What was reconstructed from truth object `sel`, one entry per reco table with an association from its table (the
 *  truth -> reco maps), latest reconstruction step first: the objects sharing hits or energy with it, most complete
 *  first, each with its completeness (the share of the truth object it holds, where the association gives one) and
 *  whether the truth object is that reco object's own best match (`unmatched`: it has none at all). An empty entry:
 *  nothing of that kind shares anything with it. `hits`: per detector, the hits it left simulated energy in (facts). */
export interface Reconstructed {
  table: string;
  measure?: string;
  in?: string;
  partners: { row: number; completeness?: number; best: boolean; unmatched: boolean }[];
}
export interface Deposits {
  in: string;
  hits: number;
  energy: number;
  weight: string;
}
export function recoOfTruth(ev: EventData, header: Header, sel: Ref): { reco: Reconstructed[]; hits: Deposits[] } {
  const reco: Reconstructed[] = [],
    hits = new Map<string, Deposits>();
  for (const [name, info] of Object.entries(header.relations)) {
    const rel = ev.relations[name],
      to = layerOf(header, info.to);
    if (!info.association || info.from !== sel.table || !rel || !to || to.truth || sel.row + 1 >= rel.offsets.length)
      continue;
    const lo = rel.offsets[sel.row],
      hi = rel.offsets[sel.row + 1],
      where = factIn(header, name);
    if (where !== undefined) {
      // a simulation fact: the hits it left energy in, per detector
      const weight = info.best?.weight ?? info.weights[0] ?? "",
        w = weight ? rel.weights[weight] : undefined;
      const d = hits.get(where) ?? { in: where, hits: 0, energy: 0, weight };
      d.hits += hi - lo;
      if (w) for (let k = lo; k < hi; k++) d.energy += w[k];
      if (hi > lo) hits.set(where, d);
      continue;
    }
    // Whether it is the reco object's own best match: the reco -> truth map read forwards.
    const back = Object.entries(header.relations).find(
      ([n, r]) => r.association && r.from === info.to && r.to === sel.table && ev.relations[n],
    );
    const own = back
      ? bestPartners(ev.relations[back[0]], back[1], true, ev.tables[info.to]?.n ?? 0).partner
      : undefined;
    const c = info.match?.completeness,
      cw = c ? rel.weights[c.weight] : undefined;
    const partners = Array.from({ length: hi - lo }, (_, i) => {
      const k = lo + i,
        row = rel.indices[k];
      return {
        row,
        completeness: cw ? (c!.complement ? 1 - cw[k] : cw[k]) : undefined,
        best: own?.[row] === sel.row,
        unmatched: !!own && own[row] < 0,
      };
    }).sort(
      (a, b) => (b.completeness ?? 0) - (a.completeness ?? 0) || Number(b.best) - Number(a.best) || a.row - b.row,
    );
    reco.push({ table: info.to, measure: info.match?.measure, in: info.match?.in, partners });
  }
  const order = (t: string) => header.display.findIndex((l) => l.table === t);
  reco.sort(
    (a, b) => (stageOf(header, b.table) ?? -1) - (stageOf(header, a.table) ?? -1) || order(a.table) - order(b.table),
  );
  return { reco, hits: [...hits.values()] };
}

/** "Reconstructed as" as the truth card lists it (recoOfTruth's entries with partners): per kind, the objects whose own
 *  best match it is, and those that hold at least `min` of the particle (all of them where the association gives no
 *  completeness), best first, at most `max` beside the best matches; `folded` counts the rest ("+N"). Kinds whose
 *  listed objects are the same ones (`same`: the same parts, e.g. one trackster's layer clusters at several levels),
 *  with the same completeness and best mark, in the same detector, are one entry naming every kind (`tables`), with
 *  the largest of their folded counts (the same objects again); kinds that list nothing are one entry too, their
 *  folded objects added up. */
export function foldReco(
  reco: Reconstructed[],
  same: (a: Ref, b: Ref) => boolean,
  min = 0.05,
  max = 4,
): { tables: string[]; measure?: string; in?: string; partners: Reconstructed["partners"]; folded: number }[] {
  const out: ReturnType<typeof foldReco> = [];
  for (const r of reco) {
    // its own best match always shows (a pion's only track, at 0.8% of its hits with its secondaries'; each of the
    // tracksters it is split into); the others from `min`, up to `max` in all
    const listed = r.partners.filter((p) => p.best || p.completeness === undefined || p.completeness >= min),
      room = Math.max(0, max - listed.filter((p) => p.best).length);
    let others = 0;
    const shown = listed.filter((p) => p.best || others++ < room),
      folded = r.partners.length - shown.length;
    const twin = out.find(
      (o) =>
        o.measure === r.measure &&
        o.in === r.in &&
        o.partners.length === shown.length &&
        o.partners.every(
          (p, i) =>
            percent(p.completeness) === percent(shown[i].completeness) &&
            p.best === shown[i].best &&
            same({ table: o.tables[0], row: p.row }, { table: r.table, row: shown[i].row }),
        ),
    );
    if (twin) {
      twin.tables.push(r.table);
      // the same objects at another level are not more of them; kinds listing nothing fold different ones
      twin.folded = shown.length ? Math.max(twin.folded, folded) : twin.folded + folded;
    } else out.push({ tables: [r.table], measure: r.measure, in: r.in, partners: shown, folded });
  }
  return out;
}
