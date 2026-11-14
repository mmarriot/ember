import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { boxOf, flatAim, flatView, flatZoom } from "./engine";
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
    // A 1280 x 640 frustum at zoom 1: a 600 x 260 cm box fills 85% of the width (630 > 290 x 2).
    expect(flatZoom(1280, 640, 600, 260)).toBeCloseTo((0.85 * 1280) / 630, 6);
    expect(flatZoom(1280, 640, 100, 600)).toBeCloseTo((0.85 * 640) / 630, 6);
    expect(flatZoom(1280, 640, 0, 0)).toBeCloseTo((0.85 * 640) / 80, 6); // a point: at most 80 cm across
  });
});

describe("2D framing beside a panel", () => {
  const ctr = new THREE.Vector3(10, 20, 30);
  it("fits into the uncovered width and moves the target right on screen by half the covered width", () => {
    const whole = flatAim(ctr, flatView("front").dir, 1280, 640, 600, 260, 1);
    expect(whole.target.toArray()).toEqual([10, 20, 30]);
    expect(whole.zoom).toBeCloseTo(flatZoom(1280, 640, 600, 260), 9);
    const beside = flatAim(ctr, flatView("front").dir, 1280, 640, 600, 260, 0.7);
    expect(beside.zoom).toBeCloseTo(flatZoom(0.7 * 1280, 640, 600, 260), 9);
    expect(beside.target.x - 10).toBeCloseTo((0.5 * 0.3 * 1280) / beside.zoom, 6); // front: screen right is +x
    const side = flatAim(ctr, flatView("side").dir, 1280, 640, 600, 260, 0.7);
    expect(side.target.z - 30).toBeCloseTo((-0.5 * 0.3 * 1280) / side.zoom, 6); // side: screen right is -z
    expect(flatAim(ctr, flatView("front").dir, 1280, 640, 600, 260, 0.1).zoom).toBeCloseTo(
      flatZoom(0.4 * 1280, 640, 600, 260),
      9,
    ); // at most 60% covered
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
