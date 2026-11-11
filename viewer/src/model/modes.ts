// Colour modes: one switch that colours every layer so that a colour means one object in all of them.
//  - truth: one colour per truth particle (its root layer); hits, layer clusters and reco objects take the colour of
//    the particle linked to them;
//  - reco: one colour per object of the last reconstruction stage (candidates); what they are made of, and the truth
//    particles they reconstruct, take their colour;
//  - layers: each layer's own colouring (energies, particle types), as the profile sets it.
// Which relation colours which layer is worked out from the bundle's relations, not named in the profile.
// The mode in use and how it applies to a layer are in store.ts (activeMode, shownLayer).
import type { DisplayLayer, Header } from "../io/bundle";
import type { ColourMode } from "./custom";

export type ColourBy = NonNullable<DisplayLayer["colourBy"]>;

/** The table each mode is built around: for truth, the truth layer with the most associations (the particles);
 *  for reco, the preferred layer of the last reconstruction stage. */
export function modeRoots(header: Header): Partial<Record<Exclude<ColourMode, "layers">, string>> {
  const links = (table: string) => Object.values(header.relations).filter((r) => r.association && (r.from === table || r.to === table)).length;
  const truth = header.display.filter((d) => d.truth && links(d.table)).sort((a, b) => links(b.table) - links(a.table))[0];
  // Of the last stage's layers (e.g. candidates and the tracks shown with them), the one that contains the others.
  const owns = (table: string) => Object.values(header.relations).filter((r) => !r.association && r.from === table).length;
  const last = header.display.filter((d) => d.stage !== undefined && !d.alternative)
    .sort((a, b) => b.stage! - a.stage! || owns(b.table) - owns(a.table))[0];
  return { ...(truth ? { truth: truth.table } : {}), ...(last ? { reco: last.table } : {}) };
}

/** How `mode` colours each table: the root gets identity colours; a table related to the root takes its partner's
 *  colour through that relation; a table whose parts (hits) are linked to the root by an association, but which is
 *  not itself, takes the root object with the most in its parts (layer clusters in truth mode); every other table
 *  takes the colour of its neighbour on the shortest path to the root (associations count as long steps, so
 *  reconstruction is followed first). Tables the mode cannot reach keep their own colouring. */
export function modeColouring(header: Header, root: string): Record<string, ColourBy> {
  const rels = Object.entries(header.relations).filter(([, r]) => r.from !== r.to);
  const out: Record<string, ColourBy> = { [root]: "identity" };
  // Shortest paths from the root (a few dozen tables: a simple Dijkstra over a list is enough).
  const cost = (assoc?: boolean) => (assoc ? 1000 : 1), dist = new Map<string, number>([[root, 0]]), todo = [root];
  while (todo.length) {
    todo.sort((a, b) => dist.get(a)! - dist.get(b)!);
    const t = todo.shift()!;
    for (const [, r] of rels) {
      const other = r.from === t ? r.to : r.to === t ? r.from : undefined, d = dist.get(t)! + cost(r.association);
      if (other !== undefined && d < (dist.get(other) ?? Infinity)) { dist.set(other, d); todo.push(other); }
    }
  }
  for (const { table } of header.display) {
    if (table in out || !dist.has(table)) continue;
    const direct = rels.filter(([, r]) => (r.from === table && r.to === root) || (r.to === table && r.from === root));
    const content = !direct.length && rels.some(([, p]) => !p.association && p.from === table &&
      rels.some(([, a]) => a.association && a.from === root && a.to === p.to));
    if (content) { out[table] = { content: root }; continue; }
    // The step towards the root; of several, the one from this table (it points at its own match), with a `best`.
    const steps = rels.filter(([, r]) => {
      const other = r.from === table ? r.to : r.to === table ? r.from : undefined;
      return other !== undefined && dist.has(other) && dist.get(other)! + cost(r.association) === dist.get(table);
    }).sort(([, a], [, b]) => Number(b.from === table) - Number(a.from === table) || Number(!!b.best) - Number(!!a.best));
    if (steps.length) out[table] = { relation: steps[0][0] };
  }
  return out;
}
