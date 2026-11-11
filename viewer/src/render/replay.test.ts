import { describe, expect, it } from "vitest";
import type { DisplayLayer, Table } from "../io/bundle";
import type { Layer } from "./layers";
import { type Parts, planReplay, type ReplayItem } from "./replay";

const C = 29.9792458; // cm/ns

/** Hits along the z axis at the given distances (cm), with the given time column (ns). */
function hits(z: number[], time: number[]) {
  let appear = new Float32Array();
  const layer = {
    x: new Float32Array(z.length), y: new Float32Array(z.length), z: Float32Array.from(z),
    passes: () => true, setTimeline: (a: Float32Array) => (appear = a), setRetire: () => {},
  } as unknown as Layer;
  const d = { table: "Hits", repr: "cells", label: "Hits", time: "time" } as DisplayLayer;
  const t: Table = { n: z.length, columns: { time: Float32Array.from(time) } };
  return { item: { layer, d, t } as ReplayItem, appear: () => appear };
}

describe("replay timeline", () => {
  it("uses a fixed random order, not distance or time, with order: random", () => {
    const z = [300, 310, 320, 330, 340, 350, 360, 370];
    const h = hits(z, z.map((v) => v / C));
    const plan = planReplay([h.item], { order: "random" });
    const first = [...h.appear()];
    expect(first.some((v, i) => i > 0 && v < first[i - 1])).toBe(true); // not in distance order
    planReplay([h.item], { order: "random" });
    expect([...h.appear()]).toEqual(first); // the same every replay
    expect(plan.caption(0.5)?.detail).toContain("no arrival times");
  });
  it("orders hits by measured arrival time, not by distance", () => {
    // all at 330-345 cm (11-11.5 ns of flight); the nearest hit arrives last (a slow particle)
    const h = hits([330, 335, 340, 345, 331, 332], [11.0, 11.2, 11.4, 11.6, 18.0, 11.1]);
    planReplay([h.item], undefined);
    const a = [...h.appear()];
    expect(a[4]).toBe(Math.max(...a));
    expect(a[0]).toBeLessThan(a[5]);
    expect(a[5]).toBeLessThan(a[1]);
  });
  it("puts hits without a time (-99) at their time of flight", () => {
    const z = [300, 330, 360, 390, 420, 450];
    const h = hits(z, z.map((v, i) => (i === 2 ? -99 : v / C + 0.2)));
    planReplay([h.item], undefined);
    const a = [...h.appear()];
    expect(a[1]).toBeLessThan(a[2]);
    expect(a[2]).toBeLessThan(a[3]);
  });
  it("adds the flight back to times corrected for it, and ignores unknown conventions", () => {
    const z = [300, 330, 360, 390, 420, 450];
    const corrected = hits(z, [0.1, 0.1, 0.1, 0.1, 0.1, -0.2]); // prompt: ~0 at the vertex
    const nonsense = hits(z, [500, 500, 500, 500, 500, 1]);
    planReplay([corrected.item], undefined);
    planReplay([nonsense.item], undefined);
    for (const h of [corrected, nonsense]) {
      const a = [...h.appear()];
      expect(a.slice(0, 5)).toEqual([...a.slice(0, 5)].sort((p, q) => p - q)); // follows distance
    }
  });
  it("runs physics, then clustering, then linking, with captions", () => {
    const h = hits([330, 340], [11, 11.3]);
    const plan = planReplay([h.item], undefined);
    expect(plan.travel).toBeLessThan(plan.clusterStart);
    expect(plan.clusterStart).toBeLessThan(plan.linkStart);
    expect(plan.caption(0.1)?.title).toMatch(/^t = 1\d\.\d\d ns after the collision$/);
    expect(planReplay([h.item], { direction: [0, -1, 0] }).caption(0.1)?.title).toBe("Particles crossing the detector");
  });
  it("walks the reconstruction stages in order, each giving way to the next, and ends on the last", () => {
    const shower = (table: string, stage: number) => {
      const out = { appear: new Float32Array(), retire: 0 };
      const layer = {
        x: Float32Array.of(0), y: Float32Array.of(0), z: Float32Array.of(340), passes: () => true,
        setTimeline: (a: Float32Array) => (out.appear = a), setRetire: (t: number) => (out.retire = t),
      } as unknown as Layer;
      const d = { table, repr: "ellipsoids", group: table, label: table, stage } as DisplayLayer;
      return { item: { layer, d, t: { n: 1, columns: {} } } as ReplayItem, out };
    };
    const hits1 = hits([330], [11]), a = shower("Tracksters", 0), b = shower("Linked", 1), c = shower("Candidates", 3);
    const plan = planReplay([hits1.item, c.item, a.item, b.item], undefined);
    expect(plan.stages.map((s) => s.tables)).toEqual([["Tracksters"], ["Linked"], ["Candidates"]]);
    expect(a.out.appear[0]).toBeLessThan(b.out.appear[0]);
    expect(b.out.appear[0]).toBeLessThan(c.out.appear[0]);
    expect(a.out.retire).toBe(plan.stages[1].start);
    expect(b.out.retire).toBe(plan.stages[2].start);
    expect(c.out.retire).toBeGreaterThan(1e29); // the last stage stays
    expect(plan.linkEnd).toBeGreaterThan(plan.stages[2].start);
    expect(plan.caption(plan.stages[1].start + 0.1)?.title).toBe("Tracksters → linked");
  });
  it("builds paths from their parts before the clustering: seeds, then growth at one speed, then the fit", () => {
    // Two straight paths along x from the origin (polylines of 17 points: 16 along the arc, then the end point), 100
    // and 50 cm long; the second fails its cut. Six parts on the first, two on the second.
    const P = 17, ends = [100, 50], out = { appear: new Float32Array(), done: new Float32Array() };
    const path = { points: P, x: new Float32Array(2 * P), y: new Float32Array(2 * P), z: new Float32Array(2 * P), fill: () => {} };
    ends.forEach((e, i) => { for (let j = 0; j < P; j++) path.x[i * P + j] = (e * Math.min(j, P - 2)) / (P - 2); });
    const tracks = {
      x: Float32Array.from(ends), y: new Float32Array(2), z: new Float32Array(2), path, passes: (i: number) => i === 0,
      setTimeline: (a: Float32Array, l: Float32Array) => { out.appear = a; out.done = l; }, setRetire: () => {},
    } as unknown as Layer;
    const at = [5, 10, 20, 40, 60, 90, 10, 30];
    let lit = new Float32Array();
    const partLayer = {
      x: Float32Array.from(at), y: new Float32Array(at.length), z: new Float32Array(at.length), passes: () => true,
      setTimeline: (_: Float32Array, l: Float32Array) => (lit = l), setRetire: () => {}, setFade: () => {},
    } as unknown as Layer;
    const items: ReplayItem[] = [
      { layer: tracks, d: { table: "Tracks", repr: "helix", group: "Tracks", kind: "track", label: "Tracks", grow: { parts: "trackHits", seed: 3 } } as DisplayLayer, t: { n: 2, columns: {} } },
      { layer: partLayer, d: { table: "Hits", repr: "markers", group: "Track hits", kind: "hit", label: "Hits" } as DisplayLayer, t: { n: at.length, columns: {} } },
    ];
    const parts: Parts = (name) => (name === "trackHits" ? { to: "Hits", offsets: Uint32Array.of(0, 6, 8), indices: Uint32Array.from(at.keys()) } : undefined);
    const plan = planReplay(items, undefined, parts), g = plan.growth!;
    expect(g.start).toBeGreaterThanOrEqual(plan.travel);
    expect(g.start).toBeLessThan(g.build);
    expect(out.appear[0]).toBeCloseTo(g.build, 5); // float32
    expect(out.done[0]).toBeGreaterThan(g.build);
    expect(out.done[0]).toBeLessThan(g.end);
    const l = [...lit];
    expect(l[0]).toBe(l[1]); expect(l[1]).toBe(l[2]); // the seed: together, before the building
    expect(l[0]).toBeLessThan(g.build);
    for (const k of [3, 4, 5]) { // then in order along the path, as it reaches them
      expect(l[k]).toBeGreaterThan(g.build);
      expect(l[k]).toBeGreaterThan(l[k - 1]);
    }
    expect(l[4]).toBeCloseTo(g.build + 0.6 * (out.done[0] - g.build), 4); // 60 of 100 cm
    expect(l[6]).toBeGreaterThan(1e28); // the parts of a path not drawn stay unlit
    expect(plan.caption(g.start + 0.1)?.title).toBe("Seeding tracks");
    expect(plan.caption(g.start + 0.1)?.detail).toBe("each starts from a seed: its first 3 track hits");
    expect(plan.caption(g.build + 0.5)?.title).toBe("Building tracks outwards");
    expect(plan.caption(g.end - 0.1)?.title).toBe("Fitting tracks");
    expect(plan.seconds).toBeGreaterThan(g.end);
  });
  it("starts the clustering and the stages after the paths are built, and is unchanged without them", () => {
    const h = hits([330, 340], [11, 11.3]), without = planReplay([h.item], undefined);
    expect(without.growth).toBeUndefined();
    expect([without.clusterStart, without.linkStart]).toEqual([3.2, 4.6]);
    const path = { points: 3, x: Float32Array.of(0, 50, 100), y: new Float32Array(3), z: new Float32Array(3), fill: () => {} };
    const tracks = { x: Float32Array.of(100), y: new Float32Array(1), z: new Float32Array(1), path, passes: () => true, setTimeline: () => {}, setRetire: () => {} } as unknown as Layer;
    const d = { table: "Tracks", repr: "helix", group: "Tracks", label: "Tracks", grow: { parts: "none" } } as DisplayLayer;
    const plan = planReplay([h.item, { layer: tracks, d, t: { n: 1, columns: {} } }], undefined);
    expect(plan.clusterStart).toBeGreaterThan(plan.growth!.end - 1e-6);
    expect(plan.linkStart - plan.clusterStart).toBeCloseTo(without.linkStart - without.clusterStart, 6);
  });
  it("ends the physics window with the other hits when the parts of built paths arrive before them", () => {
    // 200 parts (e.g. tracker hits) at 10 to 110 cm, 20 later hits (e.g. a calorimeter's) at 330 to 349 cm
    const near = Array.from({ length: 200 }, (_, i) => 10 + i / 2), far = Array.from({ length: 20 }, (_, i) => 330 + i);
    const partHits = hits(near, near.map(() => -99)), calo = hits(far, far.map(() => -99));
    partHits.item.d = { ...partHits.item.d, table: "Parts" };
    const path = { points: 3, x: Float32Array.of(0, 50, 100), y: new Float32Array(3), z: new Float32Array(3), fill: () => {} };
    const tracks = { x: Float32Array.of(100), y: new Float32Array(1), z: new Float32Array(1), path, passes: () => true, setTimeline: () => {}, setRetire: () => {} } as unknown as Layer;
    const d = { table: "Tracks", repr: "helix", group: "Tracks", label: "Tracks", grow: { parts: "rel" } } as DisplayLayer;
    const parts: Parts = () => ({ to: "Parts", offsets: Uint32Array.of(0, 0), indices: new Uint32Array() });
    const plan = planReplay([partHits.item, calo.item, { layer: tracks, d, t: { n: 1, columns: {} } }], undefined, parts);
    const a = [...calo.appear()];
    expect(a[a.length - 2]).toBeLessThanOrEqual(plan.travel + 1e-6); // the bulk of the later hits within the window
    expect(partHits.appear()[0]).toBeLessThan(0.1 * plan.travel); // the parts arrive first
  });
});
