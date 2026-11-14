// Geometry shared by the representations in render/layers/: per-row values from display hints, eta-phi directions,
// calorimeter towers, oriented boxes, and where a line leaves a cylinder around the beam. The vertex shaders build the
// same shapes on the GPU (layers/cells.ts, layers/cones.ts); these CPU twins give picking, framing and the tests the
// same answers.
import type { Column, PerRow, ToCylinder } from "../io/format";

type Columns = Record<string, Column>;

const f32 = (c: Column | undefined, n: number, fill: number) => {
  const out = new Float32Array(n);
  if (!c) return out.fill(fill);
  for (let i = 0; i < n; i++) out[i] = Number(c[i]);
  return out;
};

/** A number per row: a constant, a column, or a column scaled and clamped (`Scaled`: cm per unit, or with `log` cm
 *  per decade of 1 + |value|, so a few GeV and a few hundred both read); `fallback` for a hint that is absent or names
 *  a column the table lacks. */
export function perRow(columns: Columns, n: number, v: PerRow | undefined, fallback: number): Float32Array {
  if (v === undefined) return new Float32Array(n).fill(fallback);
  if (typeof v === "number") return new Float32Array(n).fill(v);
  if (typeof v === "string") return f32(columns[v], n, fallback);
  const c = columns[v.column];
  if (!c) return new Float32Array(n).fill(fallback);
  const out = new Float32Array(n),
    lo = v.min ?? 0,
    hi = v.max ?? Infinity;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(Number(c[i])),
      s = v.log ? v.scale * Math.log10(1 + a) : v.scale * a;
    out[i] = Number.isFinite(s) ? Math.min(hi, Math.max(lo, s)) : lo;
  }
  return out;
}

export const isToCylinder = (v: unknown): v is ToCylinder => typeof v === "object" && v !== null && "to" in v;

/** Unit vector of pseudorapidity `eta` and azimuth `phi`. */
export function etaPhiDirection(eta: number, phi: number): [number, number, number] {
  const s = 1 / Math.cosh(eta); // sin(theta)
  return [s * Math.cos(phi), s * Math.sin(phi), Math.tanh(eta)]; // cos(theta) = tanh(eta)
}

/** Distance from (x, y, z) along the unit direction (dx, dy, dz) to where the line leaves the cylinder rho < r,
 *  |z| < zMax; 0 from a point already outside it. */
export function toCylinder(
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  r: number,
  zMax: number,
): number {
  if (Math.hypot(x, y) >= r || Math.abs(z) >= zMax) return 0;
  let t = Infinity;
  if (Math.abs(dz) > 1e-12) t = ((dz > 0 ? zMax : -zMax) - z) / dz;
  const a = dx * dx + dy * dy,
    b = 2 * (x * dx + y * dy),
    c = x * x + y * y - r * r;
  if (a > 1e-12) t = Math.min(t, (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a));
  return Number.isFinite(t) ? t : 0;
}

/** Where a calorimeter tower's corner is: the eta-phi bin of the cell whose front-face centre is (x, y, z), widths
 *  dEta x dPhi, from that face outwards by `depth` (cm); `u`, `v` in [-1/2, 1/2] across eta and phi, `w` in [0, 1]
 *  front to back. On a `cylinder` the faces are at constant rho (barrel), on a `disc` at constant |z| (endcap,
 *  forward). The vertex shader of `towers` (layers/cells.ts) does the same. */
export function towerPoint(
  x: number,
  y: number,
  z: number,
  dEta: number,
  dPhi: number,
  depth: number,
  disc: boolean,
  u: number,
  v: number,
  w: number,
): [number, number, number] {
  const rho0 = Math.hypot(x, y),
    eta = Math.asinh(z / rho0) + u * dEta,
    phi = Math.atan2(y, x) + v * dPhi;
  if (!disc) {
    const r = rho0 + w * depth;
    return [r * Math.cos(phi), r * Math.sin(phi), r * Math.sinh(eta)];
  }
  const zz = z + Math.sign(z) * w * depth,
    r = Math.abs(zz) / Math.sinh(Math.abs(eta));
  return [r * Math.cos(phi), r * Math.sin(phi), zz];
}

/** A corner of an oriented box (a trapezoid when the half widths differ): centre c, unit axes u (width) and v
 *  (length), normal u x v; half widths `bottom` at -v and `top` at +v, half `length` along v, half `thickness` along
 *  the normal; (a, b, c) in [-1, 1]^3. The vertex shader of `boxes` (layers/cells.ts) does the same. */
export function boxPoint(
  centre: readonly number[],
  u: readonly number[],
  v: readonly number[],
  size: readonly [number, number, number, number],
  a: number,
  b: number,
  c: number,
): [number, number, number] {
  const [bottom, top, length, thickness] = size,
    half = bottom + ((b + 1) / 2) * (top - bottom);
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return [0, 1, 2].map((k) => centre[k] + a * half * u[k] + b * length * v[k] + c * thickness * n[k]) as [
    number,
    number,
    number,
  ];
}

type Columns3 = readonly [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>];
/** End points, with those that are not finite replaced by where the straight line from `start` along `p` leaves the
 *  cylinder `to` (e.g. a particle-flow candidate without a calorimeter entrance point: the helix then stops level
 *  with the calorimeter, see helix.ts). Returns `end` itself when every end is finite. */
export function endsOrCylinder(
  start: Columns3,
  p: Columns3,
  end: [Float32Array, Float32Array, Float32Array],
  n: number,
  to: { r: number; z: number },
): [Float32Array, Float32Array, Float32Array] {
  let out: [Float32Array, Float32Array, Float32Array] | null = null;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(end[0][i]) && Number.isFinite(end[1][i]) && Number.isFinite(end[2][i])) continue;
    out ??= [Float32Array.from(end[0]), Float32Array.from(end[1]), Float32Array.from(end[2])];
    const m = Math.hypot(p[0][i], p[1][i], p[2][i]);
    if (!(m > 0)) continue; // no direction: stays without an end
    const dx = p[0][i] / m,
      dy = p[1][i] / m,
      dz = p[2][i] / m,
      l = toCylinder(start[0][i], start[1][i], start[2][i], dx, dy, dz, to.r, to.z);
    out[0][i] = start[0][i] + l * dx;
    out[1][i] = start[1][i] + l * dy;
    out[2][i] = start[2][i] + l * dz;
  }
  return out ?? end;
}
