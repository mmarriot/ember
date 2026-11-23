// Navigation over the CSR relations of an event: what is related to a selected object.
import type { EventData, Header, Relation, RelationInfo } from "../../io/format";
import { cached } from "./cache";

export interface Ref {
  table: string;
  row: number;
}
export type Related = Map<string, Set<number>>; // table -> rows
export const sameRef = (a: Ref | null, b: Ref | null) => !!a && !!b && a.table === b.table && a.row === b.row;

/** What a selected object is related to, in three kinds:
 *  - `madeOf`: what it is made of, following relations forwards to the end of the chain (a candidate -> its
 *    tracksters, layer clusters and hits), including the object itself;
 *  - `partOf`: what it is part of, following them backwards to the top (a hit -> its layer clusters -> the
 *    tracksters and candidates that contain them);
 *  - `linked`: objects of another kind reached through an association relation (e.g. reco <-> truth graph) from the
 *    object or from what it is made of. An association is crossed once, never followed further: a trackster
 *    reaches its truth particle, not that particle's hits and other matches.
 *  Objects that merely share a parent (the other hits of the same shower) are not included: they are one click away,
 *  through the parent. */
export function relatedParts(
  ev: EventData,
  header: Header,
  sel: Ref,
): { madeOf: Related; partOf: Related; linked: Related } {
  const back = backPointers(ev, header);
  const rels = Object.entries(header.relations)
    .filter(([name]) => ev.relations[name])
    .map(([name, info]) => [name, back.has(name) ? { ...info, association: true } : info] as const);
  const linked: Related = new Map();
  const link = (table: string, row: number) => {
    if (!linked.has(table)) linked.set(table, new Set());
    linked.get(table)!.add(row);
  };
  const madeOf = closure(sel, (frontier, reached) => {
    for (const [name, info] of rels) {
      const rows = frontier.get(info.from),
        rel = ev.relations[name];
      if (!rows) continue;
      for (const row of rows)
        for (let k = rel.offsets[row]; k < rel.offsets[row + 1]; k++)
          if (info.association) link(info.to, rel.indices[k]);
          else reached(info.to, rel.indices[k]);
    }
  });
  let first = true; // associations pointing at the selection itself (e.g. the particles that share its energy)
  const partOf = closure(sel, (frontier, reached) => {
    // one pass over each relation per level, whatever the frontier size
    for (const [name, info] of rels) {
      const rows = frontier.get(info.to),
        rel = ev.relations[name];
      if (!rows || (info.association && !first) || back.has(name)) continue; // its inverse finds the container
      for (let i = 0; i + 1 < rel.offsets.length; i++)
        for (let k = rel.offsets[i]; k < rel.offsets[i + 1]; k++)
          if (rows.has(rel.indices[k])) {
            if (info.association) link(info.from, i);
            else reached(info.from, i);
            break;
          }
    }
    first = false;
  });
  partOf.get(sel.table)?.delete(sel.row);
  if (partOf.get(sel.table)?.size === 0) partOf.delete(sel.table);
  return { madeOf, partOf, linked };
}

/** Plain relations that point back up a containment that their inverse gives, e.g. track -> its vertex next to
 *  vertex -> its tracks. Navigation treats them as an association (crossed once, the partner linked), so a track's
 *  relatives are its vertex, not every track of the vertex and their hits. A relation says so with its `inverseOf`
 *  hint; for a pair of inverse relations without one, the one with at most one link per object, where the other has
 *  more, is taken (which way is "up" then shows in the data). Once per event. */
export function backPointers(ev: EventData, header: Header): Set<string> {
  return cached(ev, "backPointers", () => {
    const out = new Set<string>(),
      plain = Object.entries(header.relations).filter(
        ([name, r]) => !r.association && ev.relations[name] && r.from !== r.to,
      );
    const most = (name: string) => {
      const o = ev.relations[name].offsets;
      let m = 0;
      for (let i = 0; i + 1 < o.length; i++) m = Math.max(m, o[i + 1] - o[i]);
      return m;
    };
    for (const [name, r] of plain) {
      if (r.inverseOf) {
        out.add(name);
        continue;
      }
      const inverse = plain.find(([, o]) => o.from === r.to && o.to === r.from);
      if (inverse && !inverse[1].inverseOf && most(name) <= 1 && most(inverse[0]) > 1) out.add(name);
    }
    return out;
  });
}

/** The levels of an object: what it is made of, plus every object of another table that is made only of those parts
 *  (e.g. for a candidate, the tracksters and linked tracksters whose layer clusters all belong to it, though no
 *  relation names them; through every relation it has: for a vertex, not a candidate whose track is inside but whose
 *  clusters are not), plus the linked objects (e.g. its truth particle). A containment test, no physics metric. An
 *  object that contains the selection (`parts.partOf`) is never inside it, though its other parts may all be (a PF
 *  candidate made of a TICL candidate and that candidate's track). `parts`: relatedParts of `sel`, if already known. */
export function levelsOf(
  ev: EventData,
  header: Header,
  sel: Ref,
  parts: { madeOf: Related; linked: Related; partOf?: Related } = relatedParts(ev, header, sel),
): Related {
  const { madeOf, linked, partOf } = parts,
    back = backPointers(ev, header);
  // Only objects below the selection: not made of objects of its own table, and of an earlier reconstruction stage
  // than the selection's. A reconstruction stage is built on top of the objects without one, so it is never inside an
  // object without a stage (a candidate made only of a vertex's track is not part of the vertex).
  const stage = (table: string) => header.display?.find((l) => l.table === table && l.stage !== undefined)?.stage;
  const own = stage(sel.table),
    below = (table: string) => {
      const a = stage(table);
      return a === undefined || (own !== undefined && a < own);
    };
  const usable = Object.entries(header.relations).filter(
    ([name, info]) =>
      ev.relations[name] &&
      !info.association &&
      !back.has(name) &&
      info.from !== info.to &&
      info.from !== sel.table &&
      info.to !== sel.table &&
      !madeOf.has(info.from) &&
      below(info.from),
  );
  // Only tables with a relation into the parts can have objects inside: the others are not looked at.
  const reaching = new Set(usable.filter(([, info]) => madeOf.get(info.to)?.size).map(([, info]) => info.from));
  const extra: Related = new Map();
  // Per candidate table, per object: 1 while everything it points to so far is inside, 0 once something is not.
  const inside = new Map<string, Uint8Array>();
  for (const [name, info] of usable) {
    if (!reaching.has(info.from)) continue;
    const rel = ev.relations[name],
      parts = madeOf.get(info.to),
      n = rel.offsets.length - 1;
    let flags = inside.get(info.from);
    if (!flags) inside.set(info.from, (flags = new Uint8Array(n).fill(2))); // 2: nothing seen yet
    for (let i = 0; i < n; i++) {
      const lo = rel.offsets[i],
        hi = rel.offsets[i + 1];
      if (hi === lo || !flags[i]) continue;
      let all = !!parts;
      for (let k = lo; k < hi && all; k++) all = parts!.has(rel.indices[k]);
      flags[i] = all ? 1 : 0; // e.g. a candidate with its track inside a vertex, but its clusters outside: not inside
    }
  }
  for (const [table, flags] of inside)
    for (let i = 0; i < flags.length; i++)
      if (flags[i] === 1 && !partOf?.get(table)?.has(i)) {
        if (!extra.has(table)) extra.set(table, new Set());
        extra.get(table)!.add(i);
      }
  return union(madeOf, extra, linked);
}

/** Everything related to `sel`, of all three kinds (see relatedParts). */
export function related(ev: EventData, header: Header, sel: Ref): Related {
  const { madeOf, partOf, linked } = relatedParts(ev, header, sel);
  return union(madeOf, partOf, linked);
}

function union(...parts: Related[]): Related {
  const out: Related = new Map();
  for (const part of parts)
    for (const [t, rows] of part) {
      const set = out.get(t) ?? new Set<number>();
      for (const r of rows) set.add(r);
      out.set(t, set);
    }
  return out;
}

/** Everything reachable from `start` by repeated `step`s (breadth first; each object is expanded once). */
function closure(
  start: Ref,
  step: (frontier: Related, reached: (table: string, row: number) => void) => void,
): Related {
  const seen: Related = new Map([[start.table, new Set([start.row])]]);
  let frontier: Related = new Map([[start.table, new Set([start.row])]]); // its own sets: `seen` grows during a step
  while (frontier.size) {
    const next: Related = new Map();
    step(frontier, (table, row) => {
      const rows = seen.get(table) ?? new Set<number>();
      if (rows.has(row)) return;
      rows.add(row);
      seen.set(table, rows);
      next.set(table, (next.get(table) ?? new Set<number>()).add(row));
    });
    frontier = next;
  }
  return seen;
}

/** Compares two weights of a relation by its `best` hint: negative when the first is better. */
export const bestFirst = (best: NonNullable<RelationInfo["best"]>) => (a: number, b: number) =>
  best.order === "min" ? a - b : b - a;

/** Each object's best partner across a relation, by the relation's `best` weight (else the first): `forward`, for
 *  each `from` object among the objects it points to; else for each `to` object among those pointing to it. Per
 *  object (n of them): the partner row and the entry (index into indices and weights), -1 for none. Computed once per
 *  relation of an event and shared: do not modify the arrays. */
export function bestPartners(rel: Relation, info: RelationInfo, forward: boolean, n: number) {
  const k = `${forward}|${info.best?.weight}|${info.best?.order}|${n}`;
  let m = partnersOf.get(rel);
  if (!m) partnersOf.set(rel, (m = new Map()));
  if (!m.has(k)) m.set(k, partnersOnce(rel, info, forward, n));
  return m.get(k)!;
}
const partnersOf = new WeakMap<Relation, Map<string, { partner: Int32Array; entry: Int32Array }>>(); // per event: relations are per event
function partnersOnce(rel: Relation, info: RelationInfo, forward: boolean, n: number) {
  const partner = new Int32Array(n).fill(-1),
    entry = new Int32Array(n).fill(-1);
  const w = info.best ? rel.weights[info.best.weight] : undefined,
    cmp = info.best && bestFirst(info.best);
  for (let f = 0; f + 1 < rel.offsets.length; f++)
    for (let k = rel.offsets[f]; k < rel.offsets[f + 1]; k++) {
      const obj = forward ? f : rel.indices[k],
        j = entry[obj];
      if (j < 0 || (w && cmp!(w[k], w[j]) < 0)) {
        entry[obj] = k;
        partner[obj] = forward ? rel.indices[k] : f;
      }
    }
  return { partner, entry };
}

/** Relation `name` read from its `to` side (`n` rows): per `to` row, the `from` rows pointing at it and their entries
 *  in the relation (e.g. per hit, its particles). Once per event: one pass, about 10 ms for the 600k HGCal entries of a
 *  PU200 event. */
export function reversed(ev: EventData, name: string, n: number) {
  return cached(ev, `reversed|${name}`, () => {
    const rel = ev.relations[name],
      offsets = new Uint32Array(n + 1);
    for (let k = 0; k < rel.indices.length; k++) if (rel.indices[k] < n) offsets[rel.indices[k] + 1]++;
    for (let h = 0; h < n; h++) offsets[h + 1] += offsets[h];
    const fill = offsets.slice(0, n),
      from = new Int32Array(offsets[n]),
      entry = new Uint32Array(offsets[n]);
    for (let p = 0; p + 1 < rel.offsets.length; p++)
      for (let k = rel.offsets[p]; k < rel.offsets[p + 1]; k++) {
        const h = rel.indices[k];
        if (h < n) {
          from[fill[h]] = p;
          entry[fill[h]++] = k;
        }
      }
    return { offsets, from, entry };
  });
}

/** For each object of `table`, the object of `root` with the most weight in its parts (-1 for none): over each
 *  relation from `table` into a parts table (weighted by its first weight, e.g. a layer cluster's hit fraction, else
 *  1) and each relation from `root` into the same parts table (by its `best` weight, e.g. the simulated energy a
 *  particle left in a hit, else 1), the root object with the largest sum of products: a vote through containment,
 *  e.g. the candidate holding most of a trackster's layer clusters. `derived`: the weights came through an association
 *  (a colouring a person chose; the truth colours never vote through hits: docs/truth.md).
 *  `weight`: the root -> parts weight summed ("" for counts); `parts`: the parts table; `share`: per object, the
 *  partner's part of the total weight (0..1). Computed once per event. */
export function contentPartners(table: string, root: string, n: number, ev: EventData, header: Header) {
  return cached(ev, `content|${table}|${root}`, () => content(table, root, n, ev, header));
}
function content(table: string, root: string, n: number, ev: EventData, header: Header) {
  const nRoot = ev.tables[root]?.n ?? 0,
    pairs: { parts: Relation; f?: Float32Array; inv: { offsets: Uint32Array; from: Uint32Array; w: Float32Array } }[] =
      [];
  let weight = "",
    partsTable = "",
    derived = false;
  for (const [name, info] of Object.entries(header.relations)) {
    const parts = ev.relations[name];
    if (!parts || info.association || info.from !== table || info.to === table || info.to === root) continue;
    for (const [aname, a] of Object.entries(header.relations)) {
      const into = ev.relations[aname],
        nParts = ev.tables[info.to]?.n ?? 0;
      if (!into || a.from !== root || a.to !== info.to) continue;
      const wname = a.best?.weight ?? a.weights[0] ?? "",
        w = wname ? into.weights[wname] : undefined;
      weight ||= wname;
      partsTable ||= info.to;
      derived ||= !!a.association;
      // Inverted once per event: for each part, the root objects linked to it and their weights.
      const offsets = new Uint32Array(nParts + 1);
      for (const h of into.indices) offsets[h + 1]++;
      for (let h = 0; h < nParts; h++) offsets[h + 1] += offsets[h];
      const fill = offsets.slice(0, nParts),
        from = new Uint32Array(into.indices.length),
        wt = new Float32Array(into.indices.length);
      for (let p = 0; p + 1 < into.offsets.length; p++)
        for (let k = into.offsets[p]; k < into.offsets[p + 1]; k++) {
          const at = fill[into.indices[k]]++;
          from[at] = p;
          wt[at] = w ? w[k] : 1;
        }
      pairs.push({
        parts,
        f: info.weights[0] ? parts.weights[info.weights[0]] : undefined,
        inv: { offsets, from, w: wt },
      });
    }
  }
  // One accumulator for all objects, reset through the list of entries touched: no allocation per object.
  const partner = new Int32Array(n).fill(-1),
    share = new Float32Array(n),
    acc = new Float64Array(nRoot),
    touched: number[] = [];
  for (let o = 0; o < n; o++) {
    for (const { parts, f, inv } of pairs)
      for (let k = parts.offsets[o]; k < (parts.offsets[o + 1] ?? k); k++) {
        const h = parts.indices[k],
          frac = f ? f[k] : 1;
        for (let j = inv.offsets[h]; j < inv.offsets[h + 1]; j++) {
          const p = inv.from[j];
          if (acc[p] === 0) touched.push(p);
          acc[p] += frac * inv.w[j];
        }
      }
    let best = -1,
      most = 0,
      total = 0;
    for (const p of touched) {
      total += acc[p];
      if (acc[p] > most) {
        best = p;
        most = acc[p];
      }
      acc[p] = 0;
    }
    touched.length = 0;
    partner[o] = best;
    share[o] = total > 0 ? most / total : 0;
  }
  return { partner, share, weight, parts: partsTable, derived };
}
