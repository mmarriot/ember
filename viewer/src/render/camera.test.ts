import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { boxOf, flatAim, flatView, flatZoom, freeArea, WHOLE } from "./camera";
import type { Layer } from "./layers";

describe("2D views", () => {
  const box = new THREE.Vector3(240, 260, 600); // x, y, z extents of what is framed (cm)
  it("look along z (front) or x (side), and fit the extent across the line of sight", () => {
    expect(flatView("front").dir.toArray()).toEqual([0, 0, 1]);
    expect(flatView("front").extent(box)).toEqual([240, 260]);
    expect(flatView("side").dir.toArray()).toEqual([1, 0, 0]);
    expect(flatView("side").extent(box)).toEqual([600, 260]); // z across the screen
    expect(flatView("rz").extent(new THREE.Vector3(600, 260, 0))).toEqual([600, 260]); // view coordinates: z, rho
  });
  it("zoom so the narrower side decides, with a margin", () => {
    // A 1280 x 640 frustum at zoom 1: a 600 x 260 cm box fills 85% of the width (600 > 260 x 2).
    expect(flatZoom(1280, 640, 600, 260)).toBeCloseTo((0.85 * 1280) / 600, 6);
    expect(flatZoom(1280, 640, 100, 600)).toBeCloseTo((0.85 * 640) / 600, 6);
    expect(flatZoom(1280, 640, 0, 0)).toBeCloseTo(0.85 * 640, 6); // a point: 1 cm across (callers set the least)
  });
});

describe("2D framing beside a panel", () => {
  const ctr = new THREE.Vector3(10, 20, 30),
    left = { x0: 0, y0: 0, x1: 0.7, y1: 1 };
  it("fits into the free part and moves the target so the object sits in its centre", () => {
    const whole = flatAim(ctr, flatView("front").dir, 1280, 640, 600, 260);
    expect(whole.target.toArray()).toEqual([10, 20, 30]);
    expect(whole.zoom).toBeCloseTo(flatZoom(1280, 640, 600, 260), 9);
    const beside = flatAim(ctr, flatView("front").dir, 1280, 640, 600, 260, left);
    expect(beside.zoom).toBeCloseTo(flatZoom(0.7 * 1280, 640, 600, 260), 9);
    expect(beside.target.x - 10).toBeCloseTo((0.5 * 0.3 * 1280) / beside.zoom, 6); // front: screen right is +x
    const side = flatAim(ctr, flatView("side").dir, 1280, 640, 600, 260, left);
    expect(side.target.z - 30).toBeCloseTo((-0.5 * 0.3 * 1280) / side.zoom, 6); // side: screen right is -z
    const below = flatAim(ctr, flatView("front").dir, 1280, 640, 600, 260, { x0: 0, y0: 0.5, x1: 1, y1: 1 });
    expect(below.zoom).toBeCloseTo(flatZoom(1280, 0.5 * 640, 600, 260), 9);
    expect(below.target.y - 20).toBeCloseTo((0.25 * 640) / below.zoom, 6); // the object a quarter view lower
  });
  it("is beside the panel, on the side with most room, never less than 40% of the view", () => {
    expect(freeArea(1000, 800, null)).toEqual(WHOLE);
    // the card on the right: the part on its left
    expect(freeArea(1000, 800, { x0: 600, y0: 12, x1: 988, y1: 788 })).toEqual({ x0: 0, y0: 0, x1: 0.6, y1: 1 });
    // a narrow screen's card over the top half: the part below it
    expect(freeArea(400, 800, { x0: 12, y0: 12, x1: 388, y1: 400 })).toEqual({ x0: 0, y0: 0.5, x1: 1, y1: 1 });
    // covering almost everything: still 40% of the width
    expect(freeArea(1000, 800, { x0: 50, y0: 0, x1: 1000, y1: 800 }).x1).toBeCloseTo(0.4, 9);
  });
});

describe("framing boxes", () => {
  const layer = (table: string, x: number[], extra: Partial<Layer> = {}) =>
    ({
      table,
      x: Float32Array.from(x),
      y: Float32Array.from(x.map(() => 0)),
      z: Float32Array.from(x.map(() => 0)),
      passes: () => true,
      ...extra,
    }) as unknown as Layer;
  const toView = (X: Float32Array, Y: Float32Array, Z: Float32Array, i: number, out: THREE.Vector3) =>
    out.set(X[i], Y[i], Z[i]);
  it("leave out points that are not finite, for the whole event and for a selection", () => {
    const l = layer("T", [1, NaN, 5, Infinity]);
    const [lo, hi] = boxOf([l], undefined, toView)!;
    expect([lo.x, hi.x]).toEqual([1, 5]);
    expect(boxOf([l], new Map([["T", [1]]]), toView)).toBeNull(); // only a NaN row selected: nothing to frame
    const path = {
      points: 2,
      x: Float32Array.from([0, 1, NaN, NaN]),
      y: new Float32Array(4),
      z: new Float32Array(4),
      fill() {},
    };
    const line = layer("P", [1, NaN], { line: true, path });
    const [a, b] = boxOf([line], new Map([["P", [0, 1]]]), toView)!;
    expect([a.x, b.x]).toEqual([0, 1]);
  });
});
