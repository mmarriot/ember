// Navigation over the CSR relations of an event: what is related to a selected object.
import type { EventData, Header } from "../io/bundle";

export interface Ref { table: string; row: number }
export type Related = Map<string, Set<number>>; // table -> rows

/** What a selected object is related to, in three kinds:
 *  - `madeOf`: what it is made of, following relations forwards to the end of the chain (a candidate -> its
 *    tracksters, layer clusters and hits), including the object itself;
 *  - `partOf`: what it is part of, following them backwards to the top (a hit -> its layer clusters -> the
 *    tracksters and candidates that contain them);
 *  - `linked`: objects of another kind reached through an association relation (e.g. reco <-> MC truth) from the
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
 *  relation names them), plus the linked objects (e.g. MC truth). A containment test, no physics metric. */
export function levelsOf(ev: EventData, header: Header, sel: Ref): Related {
  const { madeOf, linked } = relatedParts(ev, header, sel);
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

export function union(...parts: Related[]): Related {
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
