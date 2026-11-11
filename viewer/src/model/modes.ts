// How colours follow the links between tables, from one root table: the truth root (the truth particles) or the
// reconstruction root (candidates). Each table is coloured through the relation that leads towards the root, so a
// colour chain such as hit -> layer cluster -> candidate is worked out from the bundle's relations, not named in the
// profile. Used by the "pid" colour mode (everything takes its candidate's colour) and by the pair view
// (model/pair.ts: which candidate and which truth particle each object belongs to); the signals are in store.ts.
import type { DisplayLayer, Header } from "../io/bundle";

export type ColourBy = NonNullable<DisplayLayer["colourBy"]>;

/** The root tables: for truth, the truth layer with the most associations (the particles); for reco, the preferred
 *  layer of the last reconstruction stage. */
export function modeRoots(header: Header): { truth?: string; reco?: string } {
  const links = (table: string) => Object.values(header.relations).filter((r) => r.association && (r.from === table || r.to === table)).length;
  const truth = header.display.filter((d) => d.truth && links(d.table)).sort((a, b) => links(b.table) - links(a.table))[0];
  // Of the last stage's layers (e.g. candidates and the tracks shown with them), the one that contains the others.
  const owns = (table: string) => Object.values(header.relations).filter((r) => !r.association && r.from === table).length;
  const last = header.display.filter((d) => d.stage !== undefined && !d.alternative)
    .sort((a, b) => b.stage! - a.stage! || owns(b.table) - owns(a.table))[0];
  return { ...(truth ? { truth: truth.table } : {}), ...(last ? { reco: last.table } : {}) };
}

/** How each table follows the links to `root`: the root itself is "identity"; a table related to the root takes
 *  its partner through that relation; a table whose parts are linked to the root, but which is not itself, takes the
 *  root object with the most in its parts (layer clusters from the truth root: the particle with the most simulated
 *  energy in their hits; tracksters from the reco root: the candidate holding most of their layer clusters); every
 *  other table takes its neighbour on the shortest path to the root (associations count as long steps, so the
 *  reconstruction is followed first). Tables that cannot reach the root are not listed. */
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
  // A table takes a colour from what contains it, or across an association; from what it contains (upwards) only if it
  // is a reconstruction stage (a vote: a trackster by the candidate holding most of its clusters), and never across a
  // pair of relations that are each other's inverse (a vertex and its tracks): a vertex is not part of a candidate.
  const staged = (table: string) => header.display.some((d) => d.table === table && d.stage !== undefined);
  const inverse = (r: Header["relations"][string]) => rels.some(([, o]) => !o.association && o.from === r.to && o.to === r.from);
  for (const { table } of header.display) {
    if (table in out || !dist.has(table)) continue;
    const usable = (r: Header["relations"][string]) => r.association || staged(table) || (r.to === table && !inverse(r));
    const direct = rels.filter(([, r]) => usable(r) && ((r.from === table && r.to === root) || (r.to === table && r.from === root)));
    const content = !direct.length && rels.some(([, p]) => !p.association && p.from === table && !inverse(p) &&
      rels.some(([, a]) => a.from === root && a.to === p.to && (a.association || staged(table))));
    if (content) { out[table] = { content: root }; continue; }
    // The step towards the root; of several, the one from this table (it points at its own match), with a `best`.
    const steps = rels.filter(([, r]) => {
      if (!usable(r)) return false;
      const other = r.from === table ? r.to : r.to === table ? r.from : undefined;
      return other !== undefined && dist.has(other) && dist.get(other)! + cost(r.association) === dist.get(table);
    }).sort(([, a], [, b]) => Number(b.from === table) - Number(a.from === table) || Number(!!b.best) - Number(!!a.best));
    if (steps.length) out[table] = { relation: steps[0][0] };
  }
  return out;
}
