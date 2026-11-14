import { describe, expect, it } from "vitest";
import { CURVATURE, type Field, helixPaths, point, polylines } from "./helix";

const FIELD: Field = { bz: 3.8, rMax: 1000, zMax: 1000 };
const col = (...v: number[]) => Float32Array.from(v);
/** One path: start, momentum, charge, end. */
function one(start: number[], p: number[], q: number, end: number[], field?: Field) {
  const s = start.map((v) => col(v)) as [Float32Array, Float32Array, Float32Array];
  const paths = helixPaths(
    s,
    p.map((v) => col(v)) as [Float32Array, Float32Array, Float32Array],
    col(q),
    end.map((v) => col(v)) as [Float32Array, Float32Array, Float32Array],
    1,
    field,
  );
  const [k, lField, lEnd] = paths.path;
  const at = (l: number) => [
    ...point(start[0], start[1], start[2], paths.dir[0], paths.dir[1], paths.dir[2], k, lField, l, new Float64Array(3)),
  ];
  return { paths, k, lField, lEnd, at, end: paths.end.map((a) => a[0]), arc: at(lEnd) };
}
const radius = (pT: number, b: number) => pT / (CURVATURE * b); // cm
/** The point at path length l on the helix in FIELD (never leaving it), plus `shift`. */
function onHelix(start: number[], p: number[], q: number, l: number, shift = [0, 0, 0]) {
  const mag = Math.hypot(p[0], p[1], p[2]),
    k = (-CURVATURE * q * FIELD.bz) / mag;
  const at = point(start[0], start[1], start[2], p[0] / mag, p[1] / mag, p[2] / mag, k, 1e9, l, new Float64Array(3));
  return [at[0] + shift[0], at[1] + shift[1], at[2] + shift[2]];
}

describe("helix paths", () => {
  it("go straight from start to end without a field, or for a neutral particle: exactly as a segment", () => {
    for (const [q, field] of [
      [1, undefined],
      [0, FIELD],
    ] as const) {
      const h = one([1, 2, 3], [1, 0, 0], q, [4, 6, 3], field);
      expect(h.k).toBe(0);
      expect(h.lEnd).toBeCloseTo(5, 5);
      expect(h.end[0]).toBeCloseTo(4, 5);
      expect(h.end[1]).toBeCloseTo(6, 5);
      expect(h.end[2]).toBeCloseTo(3, 5);
    }
  });

  it("curve on a circle of radius pT / (0.003 B), clockwise for positive charge in a field along +z", () => {
    const R = radius(1, 3.8); // 87.8 cm
    expect(R).toBeCloseTo(87.8, 0);
    const h = one([0, 0, 0], [1, 0, 0], 1, onHelix([0, 0, 0], [1, 0, 0], 1, 100), FIELD);
    for (const l of [10, 40, 80]) {
      const [x, y] = h.at(l);
      expect(Math.hypot(x, y + R)).toBeCloseTo(R, 3); // centre at (0, -R): turning towards -y
      expect(y).toBeLessThan(0);
    }
    const neg = one([0, 0, 0], [1, 0, 0], -1, onHelix([0, 0, 0], [1, 0, 0], -1, 100), FIELD);
    expect(neg.at(40)[1]).toBeGreaterThan(0);
  });

  it("stop level with the end point: its transverse distance for a central path, its z for a forward one", () => {
    const central = one([0, 0, 0], [3, 1, 0.5], 1, onHelix([0, 0, 0], [3, 1, 0.5], 1, 110, [1, 2, 0]), FIELD);
    expect(central.k).not.toBe(0);
    expect(Math.hypot(central.arc[0], central.arc[1])).toBeCloseTo(
      Math.hypot(...onHelix([0, 0, 0], [3, 1, 0.5], 1, 110, [1, 2, 0]).slice(0, 2)),
      3,
    );
    const forward = one([0, 0, 1], [1, 0.5, 4], -1, onHelix([0, 0, 1], [1, 0.5, 4], -1, 300, [0, 0, 3]), FIELD);
    expect(forward.k).not.toBe(0);
    expect(forward.arc[2]).toBeCloseTo(onHelix([0, 0, 1], [1, 0.5, 4], -1, 300)[2] + 3, 3);
  });

  it("recover the length to a point on the path itself, before and after it leaves the field", () => {
    const field: Field = { bz: 3.8, rMax: 60, zMax: 200 };
    const start = [0.1, -0.2, 2],
      p = [0.8, 0.6, 0.9];
    let lo = 0,
      hi = 200; // where the pure helix reaches r = 60
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2,
        [x, y] = onHelix(start, p, 1, mid);
      if (Math.hypot(x, y) < 60) lo = mid;
      else hi = mid;
    }
    const inside = one(start, p, 1, onHelix(start, p, 1, 0.5 * lo), field); // fitted through it: the same helix
    expect(inside.lEnd).toBeCloseTo(0.5 * lo, 3);
    const beyond = one(start, p, 1, onHelix(start, p, 1, 0.5 * lo), { ...field, rMax: 1000 }).at(1.7 * lo);
    const m = Math.hypot(...p),
      k = (-CURVATURE * field.bz) / m; // on the straight part after the field: not fitted
    const along = [
      ...point(start[0], start[1], start[2], p[0] / m, p[1] / m, p[2] / m, k, lo, 1.7 * lo, new Float64Array(3)),
    ];
    const out = one(start, p, 1, along, field);
    expect(out.lField).toBeCloseTo(lo, 3); // leaves the field at r = 60
    expect(out.lEnd).toBeCloseTo(1.7 * lo, 2);
    expect(Math.hypot(beyond[0], beyond[1])).toBeGreaterThan(60);
  });

  it("go straight along the last direction outside the field", () => {
    const field: Field = { bz: 3.8, rMax: 50, zMax: 1000 };
    const h = one([0, 0, 0], [1, 0, 0.2], 1, [150, -60, 30], field);
    const a = h.at(h.lField + 10),
      b = h.at(h.lField + 20),
      c = h.at(h.lField + 30);
    for (let i = 0; i < 3; i++) expect(c[i] - b[i]).toBeCloseTo(b[i] - a[i], 4); // a straight line
    const before = h.at(h.lField - 1e-3),
      after = h.at(h.lField + 1e-3); // no kink where the field ends
    expect(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2])).toBeCloseTo(2e-3, 5);
  });

  it("start straight when the start is outside the field", () => {
    const h = one([0, 0, 600], [1, 0, 1], 1, [10, 0, 610], { bz: 3.8, rMax: 100, zMax: 500 });
    expect(h.k).toBe(0);
    expect(h.end[0]).toBeCloseTo(10, 5);
  });

  it("stay accurate in float32 for a nearly straight (1 TeV) track", () => {
    const h = one([0, 0, 0], [1000, 0, 0], 1, [120, 0, 0], { ...FIELD, rMax: 100 }); // ends outside: not fitted
    expect(Number.isFinite(h.arc[1])).toBe(true);
    const sagitta = (120 * 120) / (8 * radius(1000, 3.8)); // ~0.016 cm, below the deflection over 120 cm
    expect(Math.abs(h.arc[1])).toBeGreaterThan(0.5 * 4 * sagitta);
    expect(Math.abs(h.arc[1])).toBeLessThan(2 * 4 * sagitta); // deflection at the end = 4 x the chord's sagitta
  });

  it("go straight from start to end when the helix cannot reach the end point, or misses it", () => {
    const looper = one([0, 0, 0], [0.1, 0, 0], 1, [30, 0, 0], FIELD); // never further out than 2 R = 17.6 cm
    expect(looper.k).toBe(0);
    expect(looper.end[0]).toBeCloseTo(30, 4);
    const wrong = one([0, 0, 0], [1, 0, 0], 1, [0, 100, 0], FIELD); // where a positive particle never goes
    expect(wrong.k).toBe(0);
    expect(wrong.end[1]).toBeCloseTo(100, 4);
    const [x, y] = onHelix([0, 0, 0], [1, 0, 0], 1, 100);
    expect(one([0, 0, 0], [1, 0, 0], 1, [x + 3, y, 0], FIELD).k).not.toBe(0); // 3 cm off the helix: within 2 cm + 5%
  });

  it("pass exactly through an end point near the helix, with a curvature fitted to it, close to the momentum's", () => {
    const [x, y] = onHelix([0, 0, 0], [1, 0, 0.3], 1, 100),
      h = one([0, 0, 0], [1, 0, 0.3], 1, [x + 1.5, y, 20], FIELD);
    for (let i = 0; i < 3; i++) expect(h.arc[i]).toBeCloseTo([x + 1.5, y, 20][i], 3);
    const k = (-CURVATURE * FIELD.bz) / Math.hypot(1, 0, 0.3);
    expect(Math.abs(h.k / k - 1)).toBeLessThan(0.5); // per cm of path: a little straighter than the momentum's
    // Too far from it (the momentum's curvature off by more than 50%): the arc stops level with it, then a join.
    const [x2, y2] = onHelix([0, 0, 0], [1, 0, 0], 1, 30),
      far = one([0, 0, 0], [1, 0, 0], 1, [x2, y2 + 3, 0], FIELD);
    expect(Math.abs(far.k / ((-CURVATURE * FIELD.bz) / 1) - 1)).toBeLessThan(1e-6);
  });

  it("end at the end point, the arc joined to it by a straight piece, or where the arc ends if it is not finite", () => {
    const field: Field = { bz: 3.8, rMax: 60, zMax: 1000 }; // the end is outside the field: no fit
    const [x, y] = one([0, 0, 0], [1, 0, 0], 1, [500, -400, 0], field).at(120),
      h = one([0, 0, 0], [1, 0, 0], 1, [x, y + 0.4, 0], field);
    expect(h.k).not.toBe(0);
    expect(h.end[1]).toBeCloseTo(y + 0.4, 4);
    expect(Math.hypot(h.arc[0] - h.end[0], h.arc[1] - h.end[1])).toBeGreaterThan(0.2);
    // A join that would be a hook (over 0.5 cm, turning more than 45 degrees): the path ends where the arc does.
    const hook = one([0, 0, 0], [1, 0, 0], 1, [x, y + 1.5, 0], field);
    for (let i = 0; i < 3; i++) expect(hook.end[i]).toBeCloseTo(hook.arc[i], 4);
    const nan = one([0, 0, 0], [1, 0, 0], 1, [NaN, NaN, NaN], FIELD);
    expect(nan.end.every(Number.isFinite)).toBe(true);
  });

  it("give polylines from start to end", () => {
    const h = one([0, 0, 0], [1, 0, 0], 1, [50, -15, 0], FIELD);
    const lines = polylines(h.paths, [col(0), col(0), col(0)], 9);
    lines.fill(0);
    expect(lines.x.length).toBe(9);
    expect(lines.x[0]).toBe(0);
    expect(lines.x[8]).toBeCloseTo(h.end[0], 4);
    expect(lines.y[8]).toBeCloseTo(h.end[1], 4);
  });
});
