// How colours follow the links between tables, from one root table: the truth root (the truth particles) or the
// reconstruction root (candidates). Each table is coloured through the relation that leads towards the root, so a
// colour chain such as hit -> layer cluster -> candidate is worked out from the bundle's relations, not named in the
// profile. Used by the "pid" colour mode (everything takes its candidate's colour) and by the pair view
// (model/pair.ts: which candidate and which truth particle each object belongs to); the signals are in store.ts.
import type { DisplayLayer, Header } from "../io/bundle";
import { factIn } from "./facts";

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
 *  reconstruction is followed first). Tables that cannot reach the root are not listed.
 *
 *  `truthRoot` (the root is the truth particles; docs/truth.md "Constituents"): a reco table takes a truth colour only
 *  across its own association, or from the container it is part of (a track's hits), never from its parts or through
 *  them (a jet from its particles' tracks, a muon from its inner track): that would show a part's match, or a vote
 *  through hits, as the object's own. The vote by content (simulated energy in its hits) is evd's stand-in for a
 *  missing associator, kept only for a kind that opts in (`truthGap.derived`, HGCal layer clusters) or in a bundle
 *  made before `truthGap` and `fact` existed. A kind
 *  with a `truthGap` and no association of its own takes no truth colour, not even its container's. */
export function modeColouring(header: Header, root: string, truthRoot = false): Record<string, ColourBy> {
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
  // By truth, never upwards (see above).
  const staged = (table: string) => !truthRoot && header.display.some((d) => d.table === table && d.stage !== undefined);
  const inverse = (r: Header["relations"][string]) => rels.some(([, o]) => !o.association && o.from === r.to && o.to === r.from);
  // Bundles made before `truthGap` and `fact` existed keep the vote wherever it applied (HGCal layer clusters).
  const legacy = !header.display.some((d) => d.truthGap) && !Object.values(header.relations).some((r) => r.fact);
  // By truth, nearest the root first, so that a table only steps towards one that already has its colour.
  const tables = header.display.map((d) => d.table);
  if (truthRoot) tables.sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity));
  for (const table of tables) {
    if (table in out || !dist.has(table)) continue;
    const gap = truthRoot ? header.display.find((d) => d.table === table)?.truthGap : undefined;
    // By truth, an association is crossed only to the root itself: a vertex matched to a truth vertex is not given the
    // colour of whatever particle that vertex belongs to.
    const usable = (r: Header["relations"][string]) => (r.association && (!truthRoot || r.from === root || r.to === root)) || staged(table) ||
      (r.to === table && !inverse(r) && !(truthRoot && r.association));
    const direct = rels.filter(([, r]) => usable(r) && ((r.from === table && r.to === root) || (r.to === table && r.from === root)));
    const vote = !truthRoot || gap?.derived === "content" || legacy;
    if (gap && !direct.length && !vote) continue;
    const content = vote && !direct.length && rels.some(([, p]) => !p.association && p.from === table && !inverse(p) &&
      rels.some(([n, a]) => a.from === root && a.to === p.to && (truthRoot ? factIn(header, n) !== undefined : a.association || staged(table))));
    if (content) { out[table] = { content: root }; continue; }
    // The step towards the root; of several, the one from this table (it points at its own match), with a `best`.
    const steps = rels.filter(([, r]) => {
      if (!usable(r)) return false;
      const other = r.from === table ? r.to : r.to === table ? r.from : undefined;
      return other !== undefined && dist.has(other) && dist.get(other)! + cost(r.association) === dist.get(table) && (!truthRoot || other in out);
    }).sort(([, a], [, b]) => Number(b.from === table) - Number(a.from === table) || Number(!!b.best) - Number(!!a.best));
    if (steps.length) out[table] = { relation: steps[0][0] };
  }
  return out;
}

/** Whether `table`'s colouring leads all the way to the root (a step towards a table that is itself not coloured
 *  leads nowhere: e.g. a PF cluster by the PF candidate containing it, when PF candidates are not in the chain). */
export function reachesRoot(header: Header, colouring: Record<string, ColourBy>, table: string, seen = new Set<string>()): boolean {
  const c = colouring[table];
  if (!c || seen.has(table)) return false;
  if (c === "identity" || (typeof c === "object" && "content" in c)) return true;
  if (typeof c !== "object" || !("relation" in c)) return false;
  const r = header.relations[c.relation];
  return !!r && reachesRoot(header, colouring, r.from === table ? r.to : r.from, new Set(seen).add(table));
}

/** The colouring the "pid" mode gives `table`: its chain to the reco root, only if it reaches it (a chain that ends
 *  elsewhere would show another table's categories under a key that describes the root's). */
export function recoColourOf(header: Header, colouring: Record<string, ColourBy>, root: string, table: string): ColourBy | undefined {
  return table !== root && reachesRoot(header, colouring, table) ? colouring[table] : undefined;
}
