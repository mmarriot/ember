// The reconstruction facts the card's physics block adds to an object's columns (docs/viewer.md "The selection's
// card"), read from the file's relations and columns, never from truth: memberships, constituents by type, the objects
// sharing its parts, and angles.
import type { EventData, Header } from "../../io/format";
import { filterMask } from "../custom/settings";
import { cached } from "./cache";
import { reversed } from "./relations";

/** The objects holding row `row` of `table` through a plain relation with a weight (a track in a vertex, weight
 *  0.98): their table, row and that weight. Read through the relation pointing back up (`inverseOf`) where there is
 *  one, else through the relation reversed. Once per event and object. */
export function memberships(ev: EventData, header: Header, table: string, row: number) {
  return cached(ev, `members|${table}|${row}`, () => {
    const out: { table: string; row: number; weight?: number; weightName?: string }[] = [];
    for (const [name, info] of Object.entries(header.relations)) {
      const rel = ev.relations[name];
      if (
        !rel ||
        info.association ||
        info.to !== table ||
        info.from === table ||
        info.inverseOf ||
        !info.weights.length
      )
        continue;
      const weightName = info.weights[0],
        up = Object.entries(header.relations).find(
          ([n, r]) => r.inverseOf === name && r.from === table && ev.relations[n],
        );
      if (up) {
        const back = ev.relations[up[0]],
          w = back.weights[weightName];
        for (let k = back.offsets[row]; k < back.offsets[row + 1]; k++)
          out.push({ table: info.from, row: back.indices[k], weight: w?.[k], weightName });
        continue;
      }
      const w = rel.weights[weightName],
        { offsets, from: holder, entry } = reversed(ev, name, ev.tables[table]?.n ?? 0);
      for (let j = offsets[row]; j < offsets[row + 1]; j++)
        out.push({ table: info.from, row: holder[j], weight: w?.[entry[j]], weightName });
    }
    return out;
  });
}

/** The constituents of row `row` of `table`, per plain relation with more than one part: their table, their count
 *  per type (the first `describe` column with `names` of their layer, e.g. pdgId: "π⁺" 3), and how many pass their
 *  layer's `filter` (PF candidates: puppiWeight > 0; null without one). */
export function constituents(ev: EventData, header: Header, table: string, row: number) {
  const out: { table: string; n: number; types: [string, number][]; kept: number | null; filter?: string }[] = [];
  for (const [name, info] of Object.entries(header.relations)) {
    const rel = ev.relations[name],
      d = header.display.find((l) => l.table === info.to),
      t = ev.tables[info.to];
    if (!rel || !d || !t || info.association || info.inverseOf || info.from !== table || info.to === table) continue;
    const lo = rel.offsets[row],
      hi = rel.offsets[row + 1];
    if (hi === undefined || hi - lo < 2) continue;
    const by = d.describe?.columns.find((c) => d.describe?.names?.[c] && c in t.columns),
      names = by ? d.describe!.names![by] : undefined,
      col = by ? t.columns[by] : undefined;
    const keep = d.filter ? passMask(ev, info.to, d.filter) : null,
      types = new Map<string, number>();
    let kept = 0;
    for (let k = lo; k < hi; k++) {
      const p = rel.indices[k];
      if (col && names) {
        const v = String(Number(col[p])),
          type = names[v] ?? v;
        types.set(type, (types.get(type) ?? 0) + 1);
      }
      if (keep && keep[p]) kept++;
    }
    out.push({
      table: info.to,
      n: hi - lo,
      types: [...types].sort((a, b) => b[1] - a[1]),
      kept: keep ? kept : null,
      filter: d.filter,
    });
  }
  return out;
}
/** A layer filter's mask over a whole table, once per event and expression. */
const passMask = (ev: EventData, table: string, expr: string) =>
  cached(ev, `filter|${table}|${expr}`, () => {
    const t = ev.tables[table];
    return t ? filterMask(t, expr) : null;
  });

/** The angle between two azimuths, in [0, π]. */
export function deltaPhi(a: number, b: number) {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/** The objects of other tables that hold all `n` parts of row `row` of `table`, per plain relation into a parts table:
 *  exactly those (`same`: an electron and a photon with one supercluster) or, for several parts, more (a tau's PF
 *  candidates, all in a jet). Exact relations, no matching. `skip`: tables left out. Once per event, object and
 *  `skip`. */
export function sharedParts(ev: EventData, header: Header, table: string, row: number, skip: Set<string>) {
  return cached(ev, `shared|${table}|${row}|${[...skip].sort()}`, () => {
    const out: { parts: string; n: number; table: string; row: number; same: boolean }[] = [];
    const plain = Object.entries(header.relations).filter(
      ([name, r]) => !r.association && !r.inverseOf && r.from !== r.to && ev.relations[name],
    );
    for (const [name, r] of plain) {
      if (r.from !== table) continue;
      const rel = ev.relations[name],
        mine = new Set(rel.indices.subarray(rel.offsets[row], rel.offsets[row + 1]));
      if (!mine.size) continue;
      const first = mine.values().next().value!;
      for (const [other, o] of plain) {
        if (o.to !== r.to || o.from === table || skip.has(o.from)) continue;
        // the objects holding its first part, then those holding them all
        const orel = ev.relations[other],
          { offsets, from: holder } = reversed(ev, other, ev.tables[r.to]?.n ?? 0);
        for (let j = offsets[first]; j < offsets[first + 1]; j++) {
          const x = holder[j],
            lo = orel.offsets[x],
            hi = orel.offsets[x + 1];
          if (hi - lo < mine.size || (mine.size === 1 && hi - lo > 1)) continue;
          let held = 0;
          for (let k = lo; k < hi; k++) if (mine.has(orel.indices[k])) held++;
          if (held === mine.size && !out.some((s) => s.table === o.from && s.row === x))
            out.push({ parts: r.to, n: mine.size, table: o.from, row: x, same: hi - lo === held });
        }
      }
    }
    return out;
  });
}
