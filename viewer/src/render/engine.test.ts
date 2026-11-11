import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { flatView, flatZoom } from "./engine";

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
