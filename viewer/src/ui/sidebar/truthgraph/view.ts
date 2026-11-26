// What a view of the truth graph in the Truth tab (TruthTab.tsx) is given and may use. A view is a component taking
// GraphViewProps; TruthTab.tsx renders the one it imports as `GraphView` (TreeView.tsx: a tree that folds).
//
// The model (model/truth/levelGraph.ts LevelGraph, from store `truthLevelGraph`):
// - `particles[i]`: a particle at a shown level, its generator copies folded (`top` its identity, `last` the row a
//   click picks, `copies`); `level`, its colour (levelColour); `parents`, the nearest shown particles above it, the
//   primary first (a tree places it under that one and says "also from" the others); `children`; `made`, the vertex
//   node it was made at, -1 for none; `ends`, the vertex nodes below it; `below`, the particles under it at no shown
//   level ("▸ N below"); `collision`, the collision it came from;
// - `vertices[k]`: a vertex where shown particles were made: `row` in the vertex table, `reason` (named by
//   ui/card/chips.tsx categoryNames(vertices)), `into` and `out` particle nodes, `skips` when particles at no shown
//   level lie between;
// - the collisions, which the whole event hangs from (each is a vertex: where its particles came out of; `vertex`, its
//   row in the vertex table). `signal`, the signal collision, named by collisionName ("p p, 14 TeV"; where it
//   happened, without beams): with a hard process (`scatter`), its `hard` roots hang from the hard scatter and its
//   `rest` are its underlying event; without (a particle gun), its `rest` hang straight under it. `pileup`: the
//   pile-up collisions, hardest first (`pt`, the summed pT of the roots: the order can change with the levels shown),
//   each with its roots in `rest` (no generator history: about 180 at 200 pile-up, up to 650 roots each). Show the
//   underlying event and each pile-up collision folded at first, and build nothing of a folded one (no rows, no
//   layout); key a fold by the collision's `id`, stable between the levels shown (and the same number in the next
//   event, which is another collision). To reveal a node, follow its primary parents (`parents[0]`) up to a root: it
//   is in the `hard` or `rest` of the node's `collision`; open the folds above it (pile-up, the collision, the
//   underlying event). A particle at no shown level with no shown particle above it (`hiddenUnder` -1) has nothing to
//   reveal;
// - `nodeOf[row]`, `hiddenUnder[row]`: the node of any particle row; for one at no shown level, the node it hides
//   under (to reveal a particle selected in the view).
//
// Signals (model/store) a view reads and writes:
// - reads `graphVertices` (draw the vertex nodes, or particles straight under particles), `graphFound` (the nodes the
//   search box finds, largest first: matchingNodes), `pickedTops` (the ticked particles, by `top`: show them ticked),
//   `selection` (the particle the card describes and the view highlights: `g.top[selection.row] === node.top`; show it
//   selected), `theme` (colours);
// - selects with `selectTruth(node.last)` (a click on a name: look at it, drawn with the ticked ones, which stay) and
//   ticks with `togglePick(node.last)` (add or remove it). They move the selection and the focus; the view draws the
//   ticked particles and the one selected (alone or with their descendants, store `truthDraw`), so a view never sets
//   `selection` itself. `clearPicks` and `setPicks` (a particle with all below it) are the controls row's.
// - its own display state (what is folded, scrolled) is its own: keep it in signals of its module, so it survives the
//   tab being closed and reopened (TruthTab renders the tab anew each time).
import { short, truthText } from "../../../model/store";
import { type Graph, length } from "../../../model/truth/graph";
import type { Collision, LevelGraph } from "../../../model/truth/levelGraph";
import type { Pal } from "../../../render/colour";

/** What a view of the truth graph gets: the event's level graph, the truth graph it was built from, and the tables of
 *  the particles and vertices (for names: store truthText(particles, row); ui/card/chips.tsx categoryNames(vertices)
 *  for the vertices' reasons). */
export interface GraphViewProps {
  lg: LevelGraph;
  g: Graph;
  particles: string;
  vertices?: string;
}

/** The colour of GRAPH_LEVELS level `level` (a node's `level`): the theme's identity colours, which are told apart in
 *  both themes and in the common colour-vision deficiencies (render/colour.ts). */
export const levelColour = (pal: Pal, level: number) => pal.identity[level % pal.identity.length];

/** A collision's name: its beams and their energy for a generator's signal collision ("p p, 14 TeV"), else where it
 *  happened ("z -6.75 mm"); empty without either. `particles`: the particle table (for the beams' names). */
export function collisionName(c: Collision, g: Graph, particles: string): string {
  if (c.beams.length) {
    const e = c.beams.reduce((sum, r) => sum + g.col("energy", r), 0);
    const names = c.beams.map((r) => truthText(particles, r).split(" · ")[0]).join(" ");
    return `${names}, ${e >= 1000 ? `${short(e / 1000)} TeV` : `${short(e)} GeV`}`;
  }
  return c.vertex >= 0 ? `z ${length(g.vcol("z", c.vertex))}` : "";
}

// The search's matches: model/truth/levelGraph.ts, in store `graphFound` for the search box.
export { matchingNodes } from "../../../model/truth/levelGraph";
