// Navigation over the CSR relations of an event: what is related to a selected object.
import type { EventData, Header } from "../io/bundle";

export interface Ref { table: string; row: number }
export type Related = Map<string, Set<number>>; // table -> rows

/** Objects related to `sel`: following relations forwards up to `depth` hops (trackster -> LCs -> hits)
 *  and one hop backwards (an LC -> the tracksters that contain it). */
export function related(ev: EventData, header: Header, sel: Ref, depth = 3): Related {
  const out: Related = new Map([[sel.table, new Set([sel.row])]]);
  const add = (table: string, row: number) => {
    if (!out.has(table)) out.set(table, new Set());
    const rows = out.get(table)!;
    const isNew = !rows.has(row);
    rows.add(row);
    return isNew;
  };

  let frontier: Ref[] = [sel];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: Ref[] = [];
    for (const { table, row } of frontier) {
      for (const [name, info] of Object.entries(header.relations)) {
        const rel = ev.relations[name];
        if (info.from !== table || !rel) continue;
        for (let k = rel.offsets[row]; k < rel.offsets[row + 1]; k++)
          if (add(info.to, rel.indices[k])) next.push({ table: info.to, row: rel.indices[k] });
      }
    }
    frontier = next;
  }

  for (const [name, info] of Object.entries(header.relations)) {
    const rel = ev.relations[name];
    if (info.to !== sel.table || !rel) continue;
    for (let i = 0; i + 1 < rel.offsets.length; i++)
      for (let k = rel.offsets[i]; k < rel.offsets[i + 1]; k++) if (rel.indices[k] === sel.row) add(info.from, i);
  }
  return out;
}
