// Navigation over the CSR relations of an event: what is related to a selected object.
import type { DisplayLayer, EventData, Header, Relation, Table } from "../io/bundle";

export interface Ref { table: string; row: number }
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
export function relatedParts(ev: EventData, header: Header, sel: Ref): { madeOf: Related; partOf: Related; linked: Related } {
  const rels = Object.entries(header.relations).filter(([name]) => ev.relations[name]);
  const linked: Related = new Map();
  const link = (table: string, row: number) => { if (!linked.has(table)) linked.set(table, new Set()); linked.get(table)!.add(row); };
  const madeOf = closure(sel, (frontier, reached) => {
    for (const [name, info] of rels) {
      const rows = frontier.get(info.from), rel = ev.relations[name];
      if (!rows) continue;
      for (const row of rows)
        for (let k = rel.offsets[row]; k < rel.offsets[row + 1]; k++)
          if (info.association) link(info.to, rel.indices[k]); else reached(info.to, rel.indices[k]);
    }
  });
  let first = true; // associations pointing at the selection itself (e.g. the particles that share its energy)
  const partOf = closure(sel, (frontier, reached) => { // one pass over each relation per level, whatever the frontier size
    for (const [name, info] of rels) {
      const rows = frontier.get(info.to), rel = ev.relations[name];
      if (!rows || (info.association && !first)) continue;
      for (let i = 0; i + 1 < rel.offsets.length; i++)
        for (let k = rel.offsets[i]; k < rel.offsets[i + 1]; k++)
          if (rows.has(rel.indices[k])) { if (info.association) link(info.from, i); else reached(info.from, i); break; }
    }
    first = false;
  });
  partOf.get(sel.table)?.delete(sel.row);
  if (partOf.get(sel.table)?.size === 0) partOf.delete(sel.table);
  return { madeOf, partOf, linked };
}

/** The levels of an object: what it is made of, plus every object of another table that is made only of those parts
 *  (e.g. for a candidate, the tracksters and linked tracksters whose layer clusters all belong to it, though no
 *  relation names them), plus the linked objects (e.g. its truth particle). A containment test, no physics metric. `parts`:
 *  relatedParts of `sel`, if already known. */
export function levelsOf(ev: EventData, header: Header, sel: Ref, parts = relatedParts(ev, header, sel)): Related {
  const { madeOf, linked } = parts;
  // Only objects below the selection: not made of objects of its own table, and of an earlier reconstruction stage
  // when both have one (a trackster's candidate is made only of it, but contains it).
  const stage = (table: string) => header.display?.find((l) => l.table === table && l.stage !== undefined)?.stage;
  const below = (table: string) => { const a = stage(table), b = stage(sel.table); return a === undefined || b === undefined || a < b; };
  const extra: Related = new Map();
  for (const [name, info] of Object.entries(header.relations)) {
    const rel = ev.relations[name], parts = madeOf.get(info.to);
    if (!rel || !parts || info.association || info.from === info.to || info.from === sel.table || info.to === sel.table ||
        madeOf.has(info.from) || !below(info.from)) continue;
    for (let i = 0; i + 1 < rel.offsets.length; i++) {
      const lo = rel.offsets[i], hi = rel.offsets[i + 1];
      if (hi === lo) continue;
      let inside = true;
      for (let k = lo; k < hi && inside; k++) inside = parts.has(rel.indices[k]);
      if (inside) { if (!extra.has(info.from)) extra.set(info.from, new Set()); extra.get(info.from)!.add(i); }
    }
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
function closure(start: Ref, step: (frontier: Related, reached: (table: string, row: number) => void) => void): Related {
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

type RelationInfo = Header["relations"][string];

/** Compares two weights of a relation by its `best` hint: negative when the first is better. */
export const bestFirst = (best: NonNullable<RelationInfo["best"]>) => (a: number, b: number) => (best.order === "min" ? a - b : b - a);

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
  const partner = new Int32Array(n).fill(-1), entry = new Int32Array(n).fill(-1);
  const w = info.best ? rel.weights[info.best.weight] : undefined, cmp = info.best && bestFirst(info.best);
  for (let f = 0; f + 1 < rel.offsets.length; f++)
    for (let k = rel.offsets[f]; k < rel.offsets[f + 1]; k++) {
      const obj = forward ? f : rel.indices[k], j = entry[obj];
      if (j < 0 || (w && cmp!(w[k], w[j]) < 0)) { entry[obj] = k; partner[obj] = forward ? rel.indices[k] : f; }
    }
  return { partner, entry };
}

/** The first relation from one of the tables `from` into the table `to` (present in `ev`, if given): its name. */
export function relationInto(header: Header, from: Iterable<string>, to: string, ev?: EventData) {
  const tables = new Set(from);
  return Object.entries(header.relations).find(([name, r]) => tables.has(r.from) && r.to === to && (!ev || ev.relations[name]))?.[0];
}

const isHitTable = (header: Header, table: string) => header.display?.some((l) => l.table === table && l.repr === "cells" && !l.context);

/** Identity colouring of a table (render/colour.ts): per object, the key whose colour it takes, and the keys that get
 *  a colour of their own (`top`, at most `slots`), largest first by the layer's colour column (else in row order).
 *  `others`: keys in use beyond `top`.
 *  Every object is its own key, except in a truth table (`truth`) with a parent ->
 *  children relation (truth particles), where colours follow truth branches:
 *  - anchors are the particles something points at: those that own hits (an association into a hit layer; the
 *    particles that entered the calorimeter) and those a reco object is matched to (an association into the table);
 *  - a particle takes the key of its highest anchor ancestor (or itself): a π⁺ that interacted before the calorimeter
 *    and was matched as a whole shares its colour with the hits of its daughters, and a shower secondary matched to
 *    a trackster shares the colour of the shower's hits;
 *  - only anchors' keys use colours (`used`): a particle linked to nothing (e.g. a quark) takes none. */
export function identities(d: DisplayLayer, t: Table, ev: EventData, header: Header, slots: number) {
  const { key, used, bySize } = cached(ev, `identities|${d.table}|${d.truth}|${d.colour}`, () => identityKeys(d, t, ev, header));
  return { key, used, top: bySize.slice(0, slots), others: Math.max(0, bySize.length - slots) };
}

/** The part of `identities` that does not depend on the selection, once per event: keys, which keys are in use, and
 *  the keys in use largest first. */
function identityKeys(d: DisplayLayer, t: Table, ev: EventData, header: Header) {
  const n = t.n, anchor = new Uint8Array(n), parent = new Int32Array(n).fill(-1), key = new Int32Array(n);
  for (let i = 0; i < n; i++) key[i] = i;
  if (d.truth) {
    for (const [name, info] of Object.entries(header.relations)) {
      const rel = ev.relations[name];
      if (!rel) continue;
      if (info.association && info.from === d.table && isHitTable(header, info.to)) {
        for (let f = 0; f < n && f + 1 < rel.offsets.length; f++) if (rel.offsets[f + 1] > rel.offsets[f]) anchor[f] = 1;
      } else if (info.association && info.to === d.table) {
        for (const r of rel.indices) anchor[r] = 1;
      } else if (!info.association && info.from === d.table && info.to === d.table) {
        for (let f = 0; f + 1 < rel.offsets.length; f++)
          for (let k = rel.offsets[f]; k < rel.offsets[f + 1]; k++) if (parent[rel.indices[k]] < 0) parent[rel.indices[k]] = f;
      }
    }
    for (let i = 0; i < n; i++) // walk up to the root, keeping the highest anchor seen (bounded: no loop on bad data)
      for (let j = i, steps = 0; j >= 0 && steps < n; j = parent[j], steps++) if (anchor[j]) key[i] = j;
  }
  const used = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!d.truth || anchor[i]) used[key[i]] = 1;
  const col = d.colour ? t.columns[d.colour] : undefined, bySize: number[] = [];
  for (let i = 0; i < n; i++) if (used[i]) bySize.push(i);
  if (col) bySize.sort((a, b) => Number(col[b]) - Number(col[a]) || a - b);
  return { key, used, bySize };
}

/** Per-event results that do not depend on the selection (identity keys, content partners), so a click that only
 *  reorders the colours does not redo them. Dropped with the event. */
const perEvent = new WeakMap<EventData, Map<string, unknown>>();
export function cached<T>(ev: EventData, what: string, make: () => T): T {
  let m = perEvent.get(ev);
  if (!m) perEvent.set(ev, (m = new Map()));
  if (!m.has(what)) m.set(what, make());
  return m.get(what) as T;
}

/** For each object of `table`, the object of `root` with the most weight in its parts (-1 for none): over each
 *  relation from `table` into a parts table (weighted by its first weight, e.g. a layer cluster's hit fraction, else
 *  1) and each relation from `root` into the same parts table (by its `best` weight, e.g. the simulated energy a
 *  particle left in a hit, else 1), the root object with the largest sum of products. Parts tables of a less preferred
 *  path (`alternative`, e.g. legacy hits next to SoA ones) are skipped, so a part is not counted twice. Two uses:
 *  - through an association (`derived`): a stand-in for one the data lack, e.g. the truth particle of a layer cluster;
 *  - through containment: a vote, e.g. the candidate holding most of a trackster's layer clusters.
 *  `weight`: the root -> parts weight summed ("" for counts); `parts`: the parts table. Computed once per event. */
export function contentPartners(table: string, root: string, n: number, ev: EventData, header: Header) {
  return cached(ev, `content|${table}|${root}`, () => content(table, root, n, ev, header));
}
function content(table: string, root: string, n: number, ev: EventData, header: Header) {
  const nRoot = ev.tables[root]?.n ?? 0, pairs: { parts: Relation; f?: Float32Array; inv: { offsets: Uint32Array; from: Uint32Array; w: Float32Array } }[] = [];
  let weight = "", partsTable = "", derived = false;
  const alternative = (t: string) => !!header.display?.some((l) => l.table === t && l.alternative);
  for (const [name, info] of Object.entries(header.relations)) {
    const parts = ev.relations[name];
    if (!parts || info.association || info.from !== table || info.to === table || info.to === root || alternative(info.to)) continue;
    for (const [aname, a] of Object.entries(header.relations)) {
      const into = ev.relations[aname], nParts = ev.tables[info.to]?.n ?? 0;
      if (!into || a.from !== root || a.to !== info.to) continue;
      const wname = a.best?.weight ?? a.weights[0] ?? "", w = wname ? into.weights[wname] : undefined;
      weight ||= wname;
      partsTable ||= info.to;
      derived ||= !!a.association;
      // Inverted once per event: for each part, the root objects linked to it and their weights.
      const offsets = new Uint32Array(nParts + 1);
      for (const h of into.indices) offsets[h + 1]++;
      for (let h = 0; h < nParts; h++) offsets[h + 1] += offsets[h];
      const fill = offsets.slice(0, nParts), from = new Uint32Array(into.indices.length), wt = new Float32Array(into.indices.length);
      for (let p = 0; p + 1 < into.offsets.length; p++)
        for (let k = into.offsets[p]; k < into.offsets[p + 1]; k++) { const at = fill[into.indices[k]]++; from[at] = p; wt[at] = w ? w[k] : 1; }
      pairs.push({ parts, f: info.weights[0] ? parts.weights[info.weights[0]] : undefined, inv: { offsets, from, w: wt } });
    }
  }
  // One accumulator for all objects, reset through the list of entries touched: no allocation per object.
  const partner = new Int32Array(n).fill(-1), acc = new Float64Array(nRoot), touched: number[] = [];
  for (let o = 0; o < n; o++) {
    for (const { parts, f, inv } of pairs)
      for (let k = parts.offsets[o]; k < (parts.offsets[o + 1] ?? k); k++) {
        const h = parts.indices[k], frac = f ? f[k] : 1;
        for (let j = inv.offsets[h]; j < inv.offsets[h + 1]; j++) {
          const p = inv.from[j];
          if (acc[p] === 0) touched.push(p);
          acc[p] += frac * inv.w[j];
        }
      }
    let best = -1, most = 0;
    for (const p of touched) { if (acc[p] > most) { best = p; most = acc[p]; } acc[p] = 0; }
    touched.length = 0;
    partner[o] = best;
  }
  return { partner, weight, parts: partsTable, derived };
}
