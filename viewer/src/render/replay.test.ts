import { describe, expect, it } from "vitest";
import type { DisplayLayer, Table } from "../io/bundle";
import type { Layer } from "./layers";
import { planReplay, type ReplayItem } from "./replay";

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
});
