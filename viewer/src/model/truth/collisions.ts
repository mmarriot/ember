// The collisions of the bunch crossing as points (docs/truth.md "Collisions"): the generator writes each collision as
// many vertices at one place (its hard scatter, shower branchings and hadronizations; a pile-up collision's
// vertices), steps of its calculation, not places. Each such vertex is mapped to its collision's point, so the card,
// the Truth tab and X speak of the collision, whichever of them is selected.
import type { Graph } from "./graph";

/** truth::VertexReason of the generator's steps at a collision's point: unknown (a pile-up collision's vertices),
 *  primary, hard scatter, shower branching, hadronization. */
const STEPS = new Set([0, 1, 17, 18, 19]);
/** Vertices closer than this (cm) are one point. */
const SAME = 1e-4;

/** One collision's point. */
export interface CollisionPoint {
  /** The signal collision (else pile-up). */
  signal: boolean;
  /** Its index in its bunch crossing (the particles' eventIndex: 0 the signal), -1 without the column. */
  index: number;
  /** Which collision it is (collisionKey). */
  key: string;
  /** Its vertex rows at its point, lowest first. The lowest is the vertex that stands for it, as in CMSSW
   *  (truth::interactions: its lowest-numbered production vertex), so the one its reco associations name. */
  rows: number[];
}

/** The collision points of graph `g` and, per vertex row, the index of its point (-1 for a vertex that is not one: a
 *  decay, an interaction in the detector). A vertex belongs to the collision of the first particle made there;
 *  `first`: the particles' column that is 0 for pile-up (isSignal), if any. Once per event. */
export function collisionPoints(g: Graph, first: string | undefined): { points: CollisionPoint[]; at: Int32Array } {
  const at = new Int32Array(g.nv).fill(-1),
    byKey = new Map<string, CollisionPoint>();
  for (let v = 0; v < g.nv; v++) {
    const p = g.outOf(v)[0];
    if (p === undefined || !STEPS.has(g.vcol("reason", v))) continue;
    const key = collisionKey(g, first, p);
    let c = byKey.get(key);
    if (!c) {
      const index = g.col("eventIndex", p);
      byKey.set(key, (c = { signal: key === "signal", index: Number.isNaN(index) ? -1 : index, key, rows: [] }));
    }
    c.rows.push(v);
  }
  const points: CollisionPoint[] = [],
    pos = (v: number) => [g.vcol("x", v), g.vcol("y", v), g.vcol("z", v)];
  for (const c of byKey.values()) {
    // the rows come lowest first; a step away from the first (none in the samples) is no part of its point; without
    // positions, all are
    const p0 = pos(c.rows[0]),
      rows = c.rows.filter((v) => pos(v).every((x, i) => !(Math.abs(x - p0[i]) >= SAME)));
    for (const v of rows) at[v] = points.length;
    points.push({ ...c, rows });
  }
  return { points, at };
}

/** Which collision particle `p` comes from: "signal", or a pile-up one's "<bunch crossing>:<eventIndex>". `first`: as
 *  for collisionPoints. */
export function collisionKey(g: Graph, first: string | undefined, p: number) {
  return first === undefined || g.col(first, p) !== 0
    ? "signal"
    : `${g.col("bunchCrossing", p)}:${g.col("eventIndex", p)}`;
}
