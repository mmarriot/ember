// How colours follow the links between tables to one root: the truth particles or the candidates. Each table is
// coloured through the relation that leads towards the root, so a chain such as hit -> layer cluster -> candidate is
// worked out from the bundle's relations, not named in the profile. Used by the "pid" and "truth" modes and the pair
// view; the signals are in store/colours.ts.
import type { DisplayLayer, Header, RelationInfo } from "../../io/format";

export type ColourBy = NonNullable<DisplayLayer["colourBy"]>;

/** The root tables: for truth, the truth layer with the most associations; for reco, the layer of the last stage
 *  that holds the others of that stage (candidates, not their tracks), or the profile's `view.colourRoot` kind (PF
 *  candidates, so every detector takes a candidate's colour) if it holds that stage's layer (else the stage would lose
 *  its colours). */
export function modeRoots(header: Header): { truth?: string; reco?: string } {
  const links = (table: string) =>
    Object.values(header.relations).filter((r) => r.association && (r.from === table || r.to === table)).length;
  const truth = header.display
    .filter((d) => d.truth && links(d.table))
    .sort((a, b) => links(b.table) - links(a.table))[0];
  // Of the last stage's layers (e.g. candidates and the tracks shown with them), the one that contains the others.
  const owns = (table: string) =>
    Object.values(header.relations).filter((r) => !r.association && r.from === table).length;
  const last = header.display
    .filter((d) => d.stage !== undefined)
    .sort((a, b) => b.stage! - a.stage! || owns(b.table) - owns(a.table))[0];
  const kind = header.view?.colourRoot,
    root = kind ? header.display.find((d) => !d.truth && d.kind === kind) : undefined,
    holds = (from: string, to: string) =>
      Object.values(header.relations).some((r) => !r.association && r.from === from && r.to === to),
    reco = root && (!last || holds(root.table, last.table)) ? root : last;
  return { ...(truth ? { truth: truth.table } : {}), ...(reco ? { reco: reco.table } : {}) };
}

/** How each table follows the links to `root`: the root is "identity"; a table related to it takes its partner; a
 *  table whose parts are linked to the root takes the root object with the most in its parts (a trackster: the
 *  candidate holding most of its layer clusters); any other takes its neighbour on the shortest path to the root
 *  (associations are long steps, so the reconstruction is followed first). Tables that cannot reach it are left out.
 *
 *  `truthRoot` (docs/truth.md "Constituents"): a reco table takes a truth colour only across its own association or
 *  from its container (a track's hits), never from or through its parts, which would show a part's match or a vote
 *  through hits as its own. A kind with a `truthGap` and no association of its own takes none. */
export function modeColouring(header: Header, root: string, truthRoot = false): Record<string, ColourBy> {
  const rels = Object.entries(header.relations).filter(([, r]) => r.from !== r.to);
  const out: Record<string, ColourBy> = { [root]: "identity" };
  // Shortest paths from the root (a few dozen tables: a Dijkstra over a list is enough).
  const cost = (assoc?: boolean) => (assoc ? 1000 : 1),
    dist = new Map<string, number>([[root, 0]]),
    todo = [root];
  while (todo.length) {
    todo.sort((a, b) => dist.get(a)! - dist.get(b)!);
    const t = todo.shift()!;
    for (const [, r] of rels) {
      const other = r.from === t ? r.to : r.to === t ? r.from : undefined,
        d = dist.get(t)! + cost(r.association);
      if (other !== undefined && d < (dist.get(other) ?? Infinity)) {
        dist.set(other, d);
        todo.push(other);
      }
    }
  }
  // A table takes a colour from what contains it, or across an association; from what it contains only if it is a
  // stage (a vote), and never across a pair of inverse relations (a vertex is not part of a candidate). By truth,
  // never from what it contains.
  const staged = (table: string) =>
    !truthRoot && header.display.some((d) => d.table === table && d.stage !== undefined);
  const inverse = (r: RelationInfo) => rels.some(([, o]) => !o.association && o.from === r.to && o.to === r.from);
  // By truth, nearest the root first, so a table only steps towards one that already has its colour.
  const tables = header.display.map((d) => d.table);
  if (truthRoot) tables.sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity));
  for (const table of tables) {
    if (table in out || !dist.has(table)) continue;
    const gap = truthRoot ? header.display.find((d) => d.table === table)?.truthGap : undefined;
    // By truth, an association is crossed only to the root itself: a vertex matched to a truth vertex does not take
    // that vertex's particle's colour.
    const usable = (r: RelationInfo) =>
      (r.association && (!truthRoot || r.from === root || r.to === root)) ||
      staged(table) ||
      (r.to === table && !inverse(r) && !(truthRoot && r.association));
    const direct = rels.filter(
      ([, r]) => usable(r) && ((r.from === table && r.to === root) || (r.to === table && r.from === root)),
    );
    const vote = !truthRoot;
    if (gap && !direct.length && !vote) continue;
    const content =
      vote &&
      !direct.length &&
      rels.some(
        ([, p]) =>
          !p.association &&
          p.from === table &&
          !inverse(p) &&
          rels.some(([, a]) => a.from === root && a.to === p.to && (a.association || staged(table))),
      );
    if (content) {
      out[table] = { content: root };
      continue;
    }
    // The step towards the root; of several, the one from this table (it points at its own match), with a `best`.
    const steps = rels
      .filter(([, r]) => {
        if (!usable(r)) return false;
        const other = r.from === table ? r.to : r.to === table ? r.from : undefined;
        return (
          other !== undefined &&
          dist.has(other) &&
          dist.get(other)! + cost(r.association) === dist.get(table) &&
          (!truthRoot || other in out)
        );
      })
      .sort(
        ([, a], [, b]) => Number(b.from === table) - Number(a.from === table) || Number(!!b.best) - Number(!!a.best),
      );
    if (steps.length) out[table] = { relation: steps[0][0] };
  }
  return out;
}

/** Whether `table`'s colouring leads all the way to the root (a step towards a table not coloured leads nowhere). */
export function reachesRoot(
  header: Header,
  colouring: Record<string, ColourBy>,
  table: string,
  seen = new Set<string>(),
): boolean {
  const c = colouring[table];
  if (!c || seen.has(table)) return false;
  if (c === "identity" || (typeof c === "object" && "content" in c)) return true;
  if (typeof c !== "object" || !("relation" in c)) return false;
  const r = header.relations[c.relation];
  return !!r && reachesRoot(header, colouring, r.from === table ? r.to : r.from, new Set(seen).add(table));
}

/** The colouring the "pid" mode gives `table`: its chain to the reco root, only if it reaches it (a chain that ends
 *  elsewhere would show another table's categories under a key that describes the root's). */
export function recoColourOf(
  header: Header,
  colouring: Record<string, ColourBy>,
  root: string,
  table: string,
): ColourBy | undefined {
  return table !== root && reachesRoot(header, colouring, table) ? colouring[table] : undefined;
}
