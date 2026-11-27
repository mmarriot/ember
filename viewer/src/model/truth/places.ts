// The truth vertices as places (docs/truth.md "Collisions and places"). The generator writes each collision as many
// vertices at one point (its hard scatter, shower branchings and hadronizations; a pile-up collision's vertices),
// steps of its calculation, not places; and a short-lived particle (a ρ, an ω, a π⁰) decays where it was made, at a
// collision's point or at a b hadron's decay. Reco cannot tell vertices at one place apart, and CMSSW's associators
// match a reco vertex to one of them: so the card, the Truth tab and X treat the vertices of a collision at one place
// as one, whichever of them is selected.
import type { Graph } from "./graph";

/** truth::VertexReason of the generator's steps at a collision's point: unknown (a pile-up collision's vertices, also
 *  some of the signal's), primary, hard scatter, shower branching, hadronization. */
const STEPS = new Set([0, 1, 17, 18, 19]);
/** Vertices closer than this (cm) are one place. */
const SAME = 1e-4;

/** One place: the vertices of one collision at one position. */
export interface Place {
  /** Its vertex rows, lowest first. On a collision's point the lowest is the vertex that stands for the collision,
   *  as in CMSSW (truth::interactions: its lowest-numbered production vertex), so the one the reco primary vertices'
   *  associations name. */
  rows: number[];
  /** Its collision (collisionKey). */
  key: string;
  /** Its collision is the signal one (else pile-up). */
  signal: boolean;
  /** Its collision's index in its bunch crossing (eventIndex: 0 the signal), -1 without the column. */
  index: number;
  /** It is its collision's point: one of the generator's steps is among its vertices. */
  collision: boolean;
}

/** Whether truth vertex `v` is one of the generator's steps at a collision's point (it stands for the collision). */
export const isGeneratorStep = (g: Graph, v: number) => STEPS.has(g.vcol("reason", v));

/** The places of graph `g` and, per vertex row, the index of its place (-1 for a vertex where nothing kept was made).
 *  A vertex belongs to the collision of the first particle made there; `first`: the particles' column that is 0 for
 *  pile-up (isSignal), if any. Once per event: a sort of each collision's vertices along z. */
export function vertexPlaces(g: Graph, first: string | undefined): { places: Place[]; at: Int32Array } {
  const at = new Int32Array(g.nv).fill(-1),
    byKey = new Map<string, number[]>();
  for (let v = 0; v < g.nv; v++) {
    const p = g.outOf(v)[0];
    if (p === undefined) continue;
    const key = collisionKey(g, first, p);
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(v);
  }
  const places: Place[] = [],
    x = (v: number) => g.vcol("x", v),
    y = (v: number) => g.vcol("y", v),
    z = (v: number) => g.vcol("z", v);
  for (const [key, rows] of byKey) {
    const p = g.outOf(rows[0])[0],
      index = g.col("eventIndex", p),
      signal = key === "signal";
    // Along z, each vertex joins the place of a vertex at its position among the recent ones within SAME in z, else
    // starts one. Without positions (NaN), the collision is one place.
    rows.sort((a, b) => z(a) - z(b) || a - b);
    const start = places.length; // this collision's places are places[start ...], in order of z
    for (const v of rows) {
      let k = places.length - 1;
      for (; k >= start && !(Math.abs(z(places[k].rows[0]) - z(v)) >= SAME); k--) {
        const o = places[k].rows[0];
        if (!(Math.abs(x(o) - x(v)) >= SAME) && !(Math.abs(y(o) - y(v)) >= SAME)) break;
      }
      if (k < start || Math.abs(z(places[k].rows[0]) - z(v)) >= SAME)
        k = places.push({ rows: [], key, signal, index: Number.isNaN(index) ? -1 : index, collision: false }) - 1;
      places[k].rows.push(v);
      places[k].collision ||= isGeneratorStep(g, v);
      at[v] = k;
    }
  }
  for (const place of places) place.rows.sort((a, b) => a - b);
  return { places, at };
}

/** Which collision particle `p` comes from: "signal", or a pile-up one's "<bunch crossing>:<eventIndex>". `first`: as
 *  for vertexPlaces. */
export function collisionKey(g: Graph, first: string | undefined, p: number) {
  return first === undefined || g.col(first, p) !== 0
    ? "signal"
    : `${g.col("bunchCrossing", p)}:${g.col("eventIndex", p)}`;
}
