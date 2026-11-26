// The chain of a selection (drawn by ui/card/Chain.tsx). For a reco object, its ladder: what it is part of (above),
// itself, what it is made of (below) and what else is built only from its parts (beside), each step with its link to
// the truth (docs/truth.md: a CMSSW match, a simulation fact, or no truth). For a truth object, what was reconstructed
// from it per reco kind. Only the bundle's associations and facts, counted per step: no new truth statement.
import { type DisplayLayer, type EventData, type Header, kindName } from "../../io/format";
import { factIn, facts } from "../truth/facts";
import { chainOrder, focusLevels } from "./levels";
import { bestPurities, simEnergyByParticle, type TruthStatus } from "../truth/match";
import { bestPartners, contentPartners, levelsOf, type Ref, type Related } from "./relations";

/** What the truth says about the objects of one step, one line per truth table, detector or reason:
 *  - `match`: the associator's matches into `truth`: of `of` objects, `matched` have one and `clean` a clean one
 *    (purity >= `good`); `partners`: [truth row, objects matched to it], most first; `purity`: for one object;
 *  - `fact`: the simulated energy in the hits in detector `in`, `total` in all; `particles`: [truth row, share],
 *    largest first;
 *  - `none`: no truth for the kind, and why; `container`: coloured as what contains it.
 *  `label`: the collections the line is about, where the step's differ in truth. `unranked`: the particles are not
 *  listed, as the selection's kind has no truth of its own and a ranking of its parts' particles would be a match
 *  through them (docs/truth.md "Constituents"). */
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

/** `held`: for an object no relation names as containing the selection (see `voted`), [parts held, of]. */
export interface Group {
  table: string;
  rows: number[];
  held?: [number, number];
}
/** One step of the ladder: the objects of one kind. `indent`, `via`: see levels.ts chainOrder. */
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

/** The ladder of reco object `sel`. `parts`: its relatedParts; `statuses`: each table's truth status. */
export function recoLadder(
  ev: EventData,
  header: Header,
  sel: Ref,
  parts: { madeOf: Related; partOf: Related; linked: Related },
  statuses: Map<string, TruthStatus>,
): Ladder {
  const inside = levelsOf(ev, header, sel, { ...parts, linked: new Map() });
  const below: Related = new Map(),
    beside: Related = new Map();
  for (const [t, rows] of inside) {
    if (t === sel.table || !rows.size) continue;
    // Named by its relations, or an earlier step of its reconstruction (a candidate's tracksters): below. Anything
    // else built from its parts (a tau made of the jet's PF candidates) is beside it.
    (parts.madeOf.has(t) || stageOf(header, t) !== undefined ? below : beside).set(t, rows);
  }
  // Only a kind with truth of its own lists its parts' particles: for any other, that would be a match through them.
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
  // A table read only as a polyline's points (a muon track's hits) is its shape, not other objects: not listed.
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
 *  trackster, candidate): per table, the object holding most of the selection's parts (contentPartners), if at least
 *  half ("3 of its 4 layer clusters"); latest step first. Worked out in Ember, and marked so (`held`). */
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
    const theirs = new Set<number>(); // the holder's parts in that table, through any of its relations into it
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
 *  summed across detectors), or why there is none. `rank`: whether a fact's particles for several objects may be
 *  listed (see Link `unranked`); without it they are not worked out. */
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
  // Where the step's collections differ in truth, or each has its own line, each line names its collections.
  const differ = split || new Set(groups.map((g) => statuses.get(g.table)?.kind)).size > 1;
  return out.map(({ tables, ...l }) =>
    differ ? { ...l, label: [...new Set(tables.map((t) => layerOf(header, t)?.label ?? t))].join(", ") } : l,
  );
}

/** What was reconstructed from truth object `sel`: per reco table with a truth -> reco association, latest step
 *  first, the objects sharing hits or energy with it, most complete first, each with its completeness and whether
 *  `sel` is that object's own best match (`owner`: that best match, -1 for none or unknown; `unmatched`: it has none).
 *  `hits`: per detector, the hits it left simulated energy in (facts). */
export interface Reconstructed {
  table: string;
  measure?: string;
  in?: string;
  partners: { row: number; completeness?: number; best: boolean; unmatched: boolean; owner: number }[];
}
export interface Deposits {
  in: string;
  table: string;
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
      const weight = info.best?.weight ?? info.weights[0] ?? "",
        w = weight ? rel.weights[weight] : undefined;
      const d = hits.get(where) ?? { in: where, table: info.to, hits: 0, energy: 0, weight };
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
        owner: own?.[row] ?? -1,
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

/** One detector of a truth object's "Reconstructed as" (the card's answer for it): the reco kind compared there (the
 *  last reconstruction stage with an association in that detector, as truth/pair.ts comparedKind chooses), the
 *  objects of that kind that hold the most of it, how many others hold some of it, and the hits it left there. A
 *  detector with hits and no association has no `table`. */
export interface DetectorLine {
  in: string;
  table?: string;
  measure?: string;
  objects: Reconstructed["partners"];
  others: number;
  hits: number;
}

/** "Reconstructed as" by detector (`reco` and `hits` of recoOfTruth): per detector (the association's `in`, else its
 *  table), its compared kind's largest holder always, then those holding at least `min` of the particle, at most `max`
 *  in all; `others` counts the rest. Detectors in the order of the domain bar, then of the display. */
export function recoByDetector(
  header: Header,
  { reco, hits }: { reco: Reconstructed[]; hits: Deposits[] },
  min = 0.05,
  max = 3,
): DetectorLine[] {
  const lines = new Map<string, DetectorLine & { at: string }>();
  // recoOfTruth lists the latest stage first: the first kind of a detector is the one compared there
  for (const r of reco) {
    const where = r.in ?? r.table;
    if (lines.has(where) || !r.partners.length) continue;
    const shown = r.partners.filter(
      (p, i) => i === 0 || (i < max && (p.completeness === undefined || p.completeness >= min)),
    );
    lines.set(where, {
      in: where,
      table: r.table,
      measure: r.measure,
      objects: shown,
      others: r.partners.length - shown.length,
      hits: 0,
      at: r.table,
    });
  }
  for (const h of hits) {
    const line = lines.get(h.in);
    if (line) line.hits += h.hits;
    else lines.set(h.in, { in: h.in, objects: [], others: 0, hits: h.hits, at: h.table });
  }
  const domains = (header.domains ?? []).map((d) => d.name),
    place = (t: string) => {
      const i = header.display.findIndex((d) => d.table === t),
        d = domains.indexOf(header.display[i]?.domain ?? "");
      return [d < 0 ? domains.length : d, i] as const;
    };
  return [...lines.values()]
    .sort((a, b) => {
      const [da, ia] = place(a.at),
        [db, ib] = place(b.at);
      return da - db || ia - ib;
    })
    .map(({ at: _, ...l }) => l);
}
