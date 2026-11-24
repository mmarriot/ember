// The Truth tab's graph (docs/viewer.md "Truth tab"): the levels it shows, its controls, the particles picked in it,
// and the truth rows the view draws for them. Picking is in selection.ts (it moves the selection and the focus).
import { computed, signal } from "@preact/signals";
import { cached } from "../event/cache";
import { drawnRows } from "../truth/graph";
import { DEFAULT_LEVELS, levelGraph } from "../truth/levelGraph";
import { truthGraph } from "./colours";
import { event } from "./data";
import { layerOf } from "./names";

/** The truth levels the graph shows: GRAPH_LEVELS bits (truth/levelGraph.ts). Kept between events and bundles. */
export const graphLevels = signal(DEFAULT_LEVELS);
/** The graph draws the vertices between the particles (its display only). */
export const graphVertices = signal(true);
/** What the view draws of the truth for the picked particles: each one alone (with the vertex it was made at and the
 *  one it ended at), or with all its descendants. */
export const truthDraw = signal<"particle" | "descendants">("descendants");
/** The graph's search box, as typed (truth/particles.ts parseTruthQuery reads it). */
export const graphQuery = signal("");

/** The truth particles picked (rows of the particle table, in the order picked): the last one is the selection, which
 *  the card describes. Empty when the focus is not a truth particle (selection.ts keeps them in step). */
export const truthPicks = signal<number[]>([]);
/** The picked particles by their first copy's row (graph.ts top), the identity of a node of the graph. */
export const pickedTops = computed(() => {
  const g = truthGraph.value?.graph;
  return new Set(g ? truthPicks.value.map((r) => g.top[r]) : []);
});

/** The event's truth graph at the levels shown (truth/levelGraph.ts), once per event and choice of levels; null
 *  without truth particles with level flags. */
export const truthLevelGraph = computed(() => {
  const tg = truthGraph.value,
    ev = event.value,
    p = tg ? layerOf(tg.particles)?.particle : undefined;
  if (!tg || !ev || !p) return null;
  const mask = graphLevels.value;
  return cached(ev, `levelGraph|${mask}`, () => levelGraph(tg.graph, p.flags, p.first, mask));
});

/** The truth particle and vertex rows the view draws for the picks (truth/graph.ts drawnRows), by table; null without
 *  picks. selection.ts puts them in the highlight of a truth focus. */
export const truthDrawn = computed(() => {
  const tg = truthGraph.value,
    picks = truthPicks.value;
  if (!tg || !picks.length) return null;
  const { particles, vertices } = drawnRows(tg.graph, picks, truthDraw.value === "descendants");
  const out = new Map([[tg.particles, particles]]);
  if (tg.vertices) out.set(tg.vertices, vertices);
  return out;
});
