import { describe, expect, it } from "vitest";
import { boxPoint, endsOrCylinder, etaPhiDirection, perRow, toCylinder, towerPoint } from "./geometry";

const col = (...v: number[]) => Float32Array.from(v);
const near = (a: readonly number[], b: readonly number[], digits = 4) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe("perRow", () => {
  const columns = { e: col(0.5, 2, 200, -3, NaN) };
  it("takes a constant, a column, or a fallback for a missing hint or column", () => {
    expect([...perRow(columns, 2, 7, 1)]).toEqual([7, 7]);
    expect([...perRow(columns, 2, "e", 1)]).toEqual([0.5, 2]);
    expect([...perRow(columns, 2, undefined, 1)]).toEqual([1, 1]);
    expect([...perRow(columns, 2, "nope", 1)]).toEqual([1, 1]);
    expect([...perRow(columns, 2, { column: "nope", scale: 2 }, 1)]).toEqual([1, 1]);
  });
  it("scales the absolute value, clamped; a non-finite value gives the minimum", () => {
    expect([...perRow(columns, 5, { column: "e", scale: 4, min: 1, max: 45 }, 0)]).toEqual([2, 8, 45, 12, 1]);
  });
  it("in log mode, gives cm per decade of 1 + |value|", () => {
    const v = perRow(columns, 3, { column: "e", scale: 20, log: true, max: 45 }, 0);
    expect(v[0]).toBeCloseTo(20 * Math.log10(1.5), 5);
    expect(v[1]).toBeCloseTo(20 * Math.log10(3), 5);
    expect(v[2]).toBe(45); // 46 cm, capped
  });
});

describe("etaPhiDirection", () => {
  it("is a unit vector at the polar angle of eta", () => {
    for (const [eta, phi] of [[0, 0], [1.2, 2], [-3, -1]]) {
      const d = etaPhiDirection(eta, phi), theta = 2 * Math.atan(Math.exp(-eta));
      expect(Math.hypot(...d)).toBeCloseTo(1, 6);
      near(d, [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)]);
    }
  });
});

describe("toCylinder", () => {
  it("is the distance to the barrel surface or the end cap, whichever comes first", () => {
    expect(toCylinder(0, 0, 0, 1, 0, 0, 129, 300)).toBeCloseTo(129, 4);
    expect(toCylinder(0, 0, 0, 0, 0, -1, 129, 300)).toBeCloseTo(300, 4);
    const [dx, dy, dz] = etaPhiDirection(2, 0.3); // forward: through the end cap
    const l = toCylinder(0, 0, 0, dx, dy, dz, 129, 300);
    expect(l * dz).toBeCloseTo(300, 3);
    expect(Math.hypot(l * dx, l * dy)).toBeLessThan(129);
  });
  it("starts from a point off the beam line, and is 0 from outside", () => {
    expect(toCylinder(10, 0, 5, 1, 0, 0, 129, 300)).toBeCloseTo(119, 4);
    expect(toCylinder(200, 0, 0, 1, 0, 0, 129, 300)).toBe(0);
  });
});

describe("towerPoint", () => {
  // An ECAL barrel crystal: front face centre at rho 129 cm, eta 0.5, phi 1; 0.0174 x 0.0174, 23 cm deep.
  const phi = 1, eta = 0.5, rho = 129, x = rho * Math.cos(phi), y = rho * Math.sin(phi), z = rho * Math.sinh(eta);
  it("on a cylinder: the front centre is the position, the back is further out along rho at the same eta, phi", () => {
    near(towerPoint(x, y, z, 0.0174, 0.0174, 23, false, 0, 0, 0), [x, y, z], 3);
    const b = towerPoint(x, y, z, 0.0174, 0.0174, 23, false, 0, 0, 1);
    expect(Math.hypot(b[0], b[1])).toBeCloseTo(152, 3);
    expect(Math.asinh(b[2] / Math.hypot(b[0], b[1]))).toBeCloseTo(eta, 5);
    expect(Math.atan2(b[1], b[0])).toBeCloseTo(phi, 5);
  });
  it("corners span the eta-phi bin", () => {
    const c = towerPoint(x, y, z, 0.0174, 0.0174, 23, false, 0.5, -0.5, 1);
    expect(Math.asinh(c[2] / Math.hypot(c[0], c[1]))).toBeCloseTo(eta + 0.0087, 5);
    expect(Math.atan2(c[1], c[0])).toBeCloseTo(phi - 0.0087, 5);
  });
  it("on a disc: faces at constant |z|, outwards on both ends", () => {
    for (const s of [1, -1]) {
      const zf = s * 1115, r = 50, b = towerPoint(r, 0, zf, 0.175, 0.175, 30, true, 0, 0, 1);
      expect(b[2]).toBeCloseTo(s * 1145, 3);
      expect(Math.asinh(b[2] / Math.hypot(b[0], b[1]))).toBeCloseTo(Math.asinh(zf / r), 4); // same eta
      const corner = towerPoint(r, 0, zf, 0.175, 0.175, 30, true, 0.5, 0, 0);
      expect(corner[2]).toBeCloseTo(zf, 3);
      expect(Math.asinh(corner[2] / Math.hypot(corner[0], corner[1]))).toBeCloseTo(Math.asinh(zf / r) + 0.0875, 4); // u spans signed eta
    }
  });
});

describe("boxPoint", () => {
  it("places the corners of a trapezoid along its axes", () => {
    const c = [0, 400, 100], u = [1, 0, 0], v = [0, 0, 1], size = [50, 80, 120, 10] as [number, number, number, number];
    near(boxPoint(c, u, v, size, 0, 0, 0), c);
    near(boxPoint(c, u, v, size, 1, -1, 0), [50, 400, -20]); // half width 50 at -v
    near(boxPoint(c, u, v, size, -1, 1, 0), [-80, 400, 220]); // half width 80 at +v
    near(boxPoint(c, u, v, size, 0, 0, 1), [0, 400 - 10, 100]); // the normal u x v = -y
  });
});

describe("endsOrCylinder", () => {
  it("keeps finite ends and puts the others where the momentum's line leaves the cylinder", () => {
    const start = [col(0, 0), col(0, 0), col(0, 0)] as const, p = [col(1, 0), col(0, 1), col(0, 0)] as const;
    const end: [Float32Array, Float32Array, Float32Array] = [col(5, NaN), col(6, NaN), col(7, NaN)];
    const out = endsOrCylinder(start, p, end, 2, { r: 129, z: 300 });
    near([out[0][0], out[1][0], out[2][0]], [5, 6, 7]);
    near([out[0][1], out[1][1], out[2][1]], [0, 129, 0], 3);
    expect(end[0][1]).toBeNaN(); // a copy
    const all: [Float32Array, Float32Array, Float32Array] = [col(1), col(2), col(3)];
    expect(endsOrCylinder(start, p, all, 1, { r: 129, z: 300 })).toBe(all);
  });
});
