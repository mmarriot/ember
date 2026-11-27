import { describe, expect, it } from "vitest";
import { collisionPoints } from "./collisions";
import { graphOf } from "./graph";

// Vertices: 0 the hard scatter, 1 a shower branching and 2 a hadronization of the signal collision, all at z 1 cm;
// 3 a B decay 3 mm away; 4 and 5 a pile-up collision's (reason 0) at z -3; 6 another pile-up collision's (reason 1)
// at z 5; 7 a shower branching of the signal 1 cm off its point; 8 a hard scatter with nothing made there.
// Particle k is made at vertex k (8: none); the signal's are 0-3 and 7, pile-up collision 1's 4 and 5, 2's 6.
const V = {
  reason: [17, 18, 19, 2, 0, 0, 1, 18, 17],
  x: [0, 0, 0, 0.3, 0, 0, 0, 0, 0],
  y: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  z: [1, 1, 1, 1, -3, -3, 5, 2, 1],
};
const P = {
  pdgId: [21, 21, 211, 321, 211, 211, 211, 21],
  status: [23, 51, 1, 1, 1, 1, 1, 51],
  prodVertexIdx: [0, 1, 2, 3, 4, 5, 6, 7],
  isSignal: [1, 1, 1, 1, 0, 0, 0, 1],
  eventIndex: [0, 0, 0, 0, 1, 1, 2, 0],
  bunchCrossing: [0, 0, 0, 0, 0, 0, 0, 0],
};
const columns = (o: Record<string, number[]>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Float64Array.from(v)]));
const g = graphOf({ n: P.pdgId.length, columns: columns(P) }, undefined, { n: V.reason.length, columns: columns(V) });

describe("collisionPoints", () => {
  const { points, at } = collisionPoints(g, "isSignal");
  it("makes one point of a collision's generator steps, lowest row first", () => {
    expect(points).toEqual([
      { signal: true, index: 0, key: "signal", rows: [0, 1, 2] },
      { signal: false, index: 1, key: "0:1", rows: [4, 5] },
      { signal: false, index: 2, key: "0:2", rows: [6] },
    ]);
    expect([...at]).toEqual([0, 0, 0, -1, 1, 1, 2, -1, -1]);
  });
  it("leaves out a decay, a step away from the point, and a vertex where nothing was made", () => {
    expect(at[3]).toBe(-1);
    expect(at[7]).toBe(-1);
    expect(at[8]).toBe(-1);
  });
  it("reads every collision as the signal without the column that tells pile-up apart", () => {
    expect(collisionPoints(g, undefined).points.map((p) => p.signal)).toEqual([true]);
  });
});
