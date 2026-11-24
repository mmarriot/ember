// What a view of the truth graph in the Truth tab (TruthTab.tsx) is given and may use. A view is a component taking
// GraphViewProps; TruthTab.tsx renders the one it imports as `GraphView` (TreeView.tsx: a tree that folds).
//
// The model (model/truth/levelGraph.ts LevelGraph, from store `truthLevelGraph`):
// - `particles[i]`: a particle at a shown level, its generator copies folded (`top` its identity, `last` the row a
//   click picks, `copies`); `level`, its colour (levelColour); `parents`, the nearest shown particles above it, the
//   primary first (a tree places it under that one and says "also from" the others); `children`; `made`, the vertex
//   node it was made at, -1 for none; `ends`, the vertex nodes below it; `below`, the particles under it at no shown
//   level ("▸ N below"); `group`;
// - `vertices[k]`: a vertex where shown particles were made: `row` in the vertex table, `reason` (named by
//   ui/card/chips.tsx categoryNames(vertices)), `into` and `out` particle nodes, `skips` when particles at no shown
//   level lie between;
// - `groups`: the roots, by group: hard process, underlying event, pile-up (the last can hold 20,000 roots at 200
//   pile-up: list a part of it, largest first, until asked for more);
// - `nodeOf[row]`, `hiddenUnder[row]`: the node of any particle row; for one at no shown level, the node it hides
//   under (to reveal a particle selected in the view).
//
// Signals (model/store) a view reads and writes:
// - reads `graphVertices` (draw the vertex nodes, or particles straight under particles), `graphFound` (the nodes the
//   search box finds, largest first: matchingNodes), `pickedTops` (the picked particles, by `top`: show them ticked),
//   `selection` (the particle the card describes, the last pick: `g.top[selection.row] === node.top`; show it
//   selected), `theme` (colours);
// - picks with `pickTruth(node.last)` (a click on a name: that particle alone) and `togglePick(node.last)` (a tick: add
//   or remove it). They move the selection and the focus; the view draws the picks (alone or with their descendants,
//   store `truthDraw`), so a view never sets `selection` itself. `clearPicks` is the controls row's.
// - its own display state (what is folded, scrolled) is its own: keep it in signals of its module, so it survives the
//   tab being closed and reopened (TruthTab renders the tab anew each time).
import type { Graph } from "../../../model/truth/graph";
import type { LevelGraph } from "../../../model/truth/levelGraph";
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

// The search's matches: model/truth/levelGraph.ts, in store `graphFound` for the search box.
export { matchingNodes } from "../../../model/truth/levelGraph";
