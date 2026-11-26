// The Truth tab's graph (docs/viewer.md "Truth tab"): the levels it shows, its controls, the particles picked in it,
// and the truth rows the view draws for them. Picking is in selection.ts (it moves the selection and the focus).
import { computed, signal } from "@preact/signals";
import { cached } from "../event/cache";
import { bestPartners, linkedTo, type Related } from "../event/relations";
import type { EventData, Header } from "../../io/format";
import { copiesBelow, drawnRows } from "../truth/graph";
import { DEFAULT_LEVELS, levelGraph, matchingNodes } from "../truth/levelGraph";
import { truthGraph } from "./colours";
import { bundle, event } from "./data";
import { layerOf } from "./names";
import { cuts } from "./view";

/** The truth levels the graph shows: GRAPH_LEVELS bits (truth/levelGraph.ts). Kept between events and bundles. */
export const graphLevels = signal(DEFAULT_LEVELS);
/** The graph draws the vertices between the particles (its display only). */
export const graphVertices = signal(true);
/** What the view draws of the truth for the picked particles: each one alone (with the vertex it was made at and the
 *  one it ended at), or with all its descendants. */
export const truthDraw = signal<"particle" | "descendants">("descendants");
/** The graph's search box, as typed (truth/particles.ts parseTruthQuery reads it). */
export const graphQuery = signal("");

/** The truth particles ticked (rows of the particle table, in the order ticked). Only a tick adds or removes one: a
 *  click on a name looks at a particle (truthLooked) and leaves them. Empty when the focus is not a truth particle
 *  (selection.ts keeps them in step). */
export const truthPicks = signal<number[]>([]);
/** The truth particle the card describes and the view highlights among the picks (a row), ticked or not; null for
 *  none. A click on a name, a tick that adds a particle, or a truth particle chosen elsewhere (the view, a card) sets
 *  it (selection.ts). */
export const truthLooked = signal<number | null>(null);
/** The particles the view draws the truth of: the picks, and the one looked at if it is not one of them. */
export const truthShown = computed(() => {
  const g = truthGraph.value?.graph,
    picks = truthPicks.value,
    looked = truthLooked.value;
  return g && looked !== null && !picks.some((r) => g.top[r] === g.top[looked]) ? [...picks, looked] : picks;
});
/** The ticked particles by their first copy's row (graph.ts top), the identity of a node of the graph. */
export const pickedTops = computed(() => {
  const g = truthGraph.value?.graph;
  return new Set(g ? truthPicks.value.map((r) => g.top[r]) : []);
});
/** The particles drawn (truthShown) by their first copy's row. */
export const shownTops = computed(() => {
  const g = truthGraph.value?.graph;
  return new Set(g ? truthShown.value.map((r) => g.top[r]) : []);
});

/** The own rows of the particles drawn (truthShown): every generator copy of each (graph.ts copiesBelow). The view
 *  draws them whatever the cut (control/sceneFocus.ts onlyFor). Empty without any. */
export const pickedRows = computed(() => {
  const g = truthGraph.value?.graph;
  return new Set(g ? [...shownTops.value].flatMap((t) => copiesBelow(g, t)) : []);
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

/** The particle nodes of the level graph that the search box finds (truth/levelGraph.ts matchingNodes), largest
 *  energy first; empty without a search. */
export const graphFound = computed(() => {
  const tg = truthGraph.value,
    lg = truthLevelGraph.value,
    query = graphQuery.value;
  return tg && lg && query.trim()
    ? matchingNodes(lg, tg.graph, layerOf(tg.particles)?.describe?.names?.pdgId ?? {}, query)
    : [];
});

/** The truth particle and vertex rows the view draws for the picks and the particle looked at (truthShown; truth/graph.ts
 *  drawnRows), by table; null without any. selection.ts puts them in the highlight of a truth focus. */
export const truthDrawn = computed(() => {
  const tg = truthGraph.value,
    picks = truthShown.value;
  if (!tg || !picks.length) return null;
  const { particles, vertices } = drawnRows(tg.graph, picks, truthDraw.value === "descendants");
  const out = new Map([[tg.particles, particles]]);
  if (tg.vertices) out.set(tg.vertices, vertices);
  return out;
});

/** What is linked through an association to the truth drawn for the picks (truthDrawn): their hits, and the reco
 *  objects matched to the particles and to their vertices whose best match is among them (bestOwned), by table; null
 *  without picks. selection.ts puts them in the highlight of a truth focus, so they follow the choice (each pick alone,
 *  or with its descendants) and are those of every pick. */
export const truthLinked = computed(() => {
  const drawn = truthDrawn.value,
    b = bundle.value,
    ev = event.value;
  return drawn && b && ev ? bestOwned(ev, b.header, drawn, linkedTo(ev, b.header, drawn)) : null;
});

/** `linked` (what is linked to the truth `drawn`) less the reco objects whose own best truth match (their kind's match
 *  relation, which the card calls "its best") is another particle: a cluster that a photon's conversion electrons
 *  share in but that is mostly the electron's that radiated it is that electron's, not the photon's. Hits, and objects
 *  of a kind without a match relation, stay. */
export function bestOwned(ev: EventData, header: Header, drawn: Related, linked: Related): Related {
  const out = new Map(linked);
  for (const [name, info] of Object.entries(header.relations)) {
    const rel = ev.relations[name],
      truth = drawn.get(info.to),
      rows = out.get(info.from),
      n = ev.tables[info.from]?.n ?? 0;
    if (!info.match || !info.best || !rel || !truth || !rows || drawn.has(info.from)) continue;
    const { partner } = bestPartners(rel, info, true, n);
    out.set(info.from, new Set([...rows].filter((r) => partner[r] < 0 || truth.has(partner[r]))));
  }
  return out;
}

/** The particles drawn for the picks (truthDrawn) that the truth particle cut hides, as the Truth tab says: how many
 *  are drawn and how many are below the cut (by particle, their copies once; the picks are never cut), the cut's group
 *  and value. Null without picks, or with none below the cut. */
export const truthCutAway = computed(() => {
  const tg = truthGraph.value,
    drawn = truthDrawn.value?.get(tg?.particles ?? ""),
    cut = tg ? layerOf(tg.particles)?.cut : undefined,
    ev = event.value;
  if (!tg || !drawn || !cut || !ev) return null;
  const min = cuts.value[cut.group] ?? 0,
    col = ev.tables[tg.particles]?.columns[cut.column],
    picked = shownTops.value,
    tops = new Set([...drawn].map((r) => tg.graph.top[r])),
    below = col ? [...tops].filter((t) => !picked.has(t) && Number(col[tg.graph.last[t]]) < min).length : 0;
  return below ? { shown: tops.size - below, all: tops.size, group: cut.group, min, unit: cut.unit } : null;
});
