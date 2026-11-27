import { describe, expect, it } from "vitest";
import { graphOf } from "./graph";
import { collisionKey, isGeneratorStep, vertexPlaces } from "./places";

// Vertices: 0 the hard scatter, 1 a shower branching, 2 a hadronization and 3 an ω decay of the signal collision, all
// at z 1 cm; 4 a B decay 3 mm away and 5 the ω decay it made there; 6 and 7 a pile-up collision's (reason 0) at z -3;
// 8 another pile-up collision's (reason 1) at z 5; 9 a shower branching of the signal 1 cm off its point; 10 a hard
// scatter with nothing made there; 11 a vertex of an out-of-time collision with the same eventIndex as 6 and 7's, at
// their point. Particle k is made at vertex k (10: none); the signal's are 0-5 and 9.
const V = {
  reason: [17, 18, 19, 2, 2, 2, 0, 0, 1, 18, 17, 0],
  x: [0, 0, 0, 0, 0.3, 0.3, 0, 0, 0, 0, 0, 0],
  y: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  z: [1, 1, 1, 1, 1, 1, -3, -3, 5, 2, 1, -3],
};
const P = {
  pdgId: [21, 21, 211, 211, 321, 211, 211, 211, 211, 21, 0, 211],
  status: [23, 51, 1, 1, 1, 1, 1, 1, 1, 51, 0, 1],
  prodVertexIdx: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, -1, 11],
  isSignal: [1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0],
  eventIndex: [0, 0, 0, 0, 0, 0, 1, 1, 2, 0, 0, 1],
  bunchCrossing: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1],
};
const columns = (o: Record<string, number[]>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Float64Array.from(v)]));
const g = graphOf({ n: P.pdgId.length, columns: columns(P) }, undefined, { n: V.reason.length, columns: columns(V) });

describe("vertexPlaces", () => {
  const { places, at } = vertexPlaces(g, "isSignal");
  const placeOf = (v: number) => places[at[v]];
  it("makes one place of a collision's vertices at one position, its point with the decays there", () => {
    expect(placeOf(0)).toEqual({ rows: [0, 1, 2, 3], key: "signal", signal: true, index: 0, collision: true });
    expect(placeOf(6)).toEqual({ rows: [6, 7], key: "0:1", signal: false, index: 1, collision: true });
    expect(placeOf(8)).toMatchObject({ rows: [8], key: "0:2", collision: true });
  });
  it("makes one place of a decay and the decays at its position, apart from the collision's point", () => {
    expect(placeOf(4)).toMatchObject({ rows: [4, 5], key: "signal", collision: false });
  });
  it("keeps a step away from the point, another bunch crossing and a vertex where nothing was made apart", () => {
    expect(placeOf(9).rows).toEqual([9]);
    expect(placeOf(11)).toMatchObject({ rows: [11], key: "-1:1" });
    expect(at[10]).toBe(-1);
    expect(places.length).toBe(6);
  });
  it("reads every collision as the signal without the column that tells pile-up apart", () => {
    expect(vertexPlaces(g, undefined).places.every((p) => p.signal)).toBe(true);
  });
});

describe("collisionKey and isGeneratorStep", () => {
  it("name a particle's collision and the generator's steps", () => {
    expect([0, 6, 8, 11].map((p) => collisionKey(g, "isSignal", p))).toEqual(["signal", "0:1", "0:2", "-1:1"]);
    expect([0, 1, 2, 3, 6, 8].map((v) => isGeneratorStep(g, v))).toEqual([true, true, true, false, true, true]);
  });
});
