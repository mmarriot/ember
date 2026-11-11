// Paths of charged particles in a uniform solenoid field along z (header `field`), for the `helix` representation.
// Each path is a helix from its start along its momentum while inside the field cylinder (r < rMax, |z| < zMax),
// then a straight line along its last direction; a neutral particle, or any particle without a field, goes straight
// from its start to its end (as `segments`). The path is parametrised by its 3D length l (cm):
//   x(l) = x0 + l (dx S - dy C),  y(l) = y0 + l (dy S + dx C),  z(l) = z0 + l dz,
// with d the unit direction at the start, theta = k l the turn about z so far, S = sin(theta) / theta and
// C = (1 - cos(theta)) / theta. Written with half angles (S = s(h) cos h, C = s(h) sin h, h = theta / 2,
// s(h) = sin h / h), this has no cancellation for a nearly straight track (huge radius), so it is exact in float32 too:
// the vertex shader of the helix layer (render/layers.ts) evaluates the same formula.
//
// Where a path stops: z is linear in l along the whole path (the field turns only the transverse direction), so a
// path that moves mostly along the beam stops where it reaches the end point's z; one that moves mostly outwards stops
// where its transverse distance from the start reaches the end point's. With a measured momentum the helix passes
// near, not exactly through, the end point (a track's outermost hit, a particle's decay or the calorimeter front);
// either way the arc stops level with it and never runs past it. A helix that cannot get level with the end point (a
// looper that never gets as far out), or ends far from it (more than 2 cm + 5% of its length: e.g. an electron that
// lost energy on the way, a particle that scattered, an end point extrapolated without the field), is drawn straight
// from start to end instead, so paths always end at their end points.

/** Uniform field along z (T) inside the cylinder r < rMax, |z| < zMax (cm); none outside. */
export interface Field { bz: number; rMax: number; zMax: number }

/** Curvature per cm of path per T, for momentum in GeV and charge in e: k = -CURVATURE q Bz / p (rad/cm). A
 *  positive particle in a field along +z turns clockwise seen from +z. */
export const CURVATURE = 0.00299792458;

const BIG = 1e9; // cm: "never" (a path that does not leave the field)
const MISS = 2, MISS_FRACTION = 0.05; // a helix ending further than 2 cm + 5% of its length from the end point is not drawn

/** Per object (n of them): the unit direction at the start (3n, interleaved), the path parameters (3n: k rad/cm,
 *  length in the field, total length; cm) and the end point of the drawn path. */
export interface Paths {
  n: number;
  dir: Float32Array;
  path: Float32Array;
  end: [Float32Array, Float32Array, Float32Array];
}
type Columns3 = readonly [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>];

/** The paths from `start` with momentum `p` and `charge`, stopping level with `end` (see above). */
export function helixPaths(start: Columns3, p: Columns3, charge: ArrayLike<number>, end: Columns3, n: number, field?: Field): Paths {
  const dir = new Float32Array(3 * n), path = new Float32Array(3 * n), out: Paths["end"] = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const at = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    const x0 = start[0][i], y0 = start[1][i], z0 = start[2][i], ex = end[0][i], ey = end[1][i], ez = end[2][i];
    const px = p[0][i], py = p[1][i], pz = p[2][i], mag = Math.hypot(px, py, pz), q = charge[i];
    let k = field && q && mag > 0 && Number.isFinite(mag) ? (-CURVATURE * q * field.bz) / mag : 0;
    let dx = 0, dy = 0, dz = 0, lField = 0, lEnd = 0;
    if (k && !outside(field!, x0, y0, z0)) {
      dx = px / mag; dy = py / mag; dz = pz / mag;
      lField = fieldLength(field!, x0, y0, z0, dx, dy, dz, k);
      lEnd = endLength(x0, y0, z0, dx, dy, dz, k, lField, ex, ey, ez);
      point(x0, y0, z0, dx, dy, dz, k, lField, lEnd, at);
      // A helix that misses the end point (energy lost on the way, a scatter, an inconsistent end): straight instead,
      // so the path still ends where the end point is (e.g. where a particle's daughters start).
      if (!(Math.hypot(at[0] - ex, at[1] - ey, at[2] - ez) <= MISS + MISS_FRACTION * lEnd)) k = 0;
    } else k = 0;
    if (!k) { // straight from start to end, exactly as a segment
      const len = Math.hypot(ex - x0, ey - y0, ez - z0);
      [dx, dy, dz] = len > 0 ? [(ex - x0) / len, (ey - y0) / len, (ez - z0) / len] : mag > 0 ? [px / mag, py / mag, pz / mag] : [0, 0, 1];
      lField = 0;
      lEnd = Number.isFinite(len) ? len : 0;
    }
    dir[3 * i] = dx; dir[3 * i + 1] = dy; dir[3 * i + 2] = dz;
    path[3 * i] = k; path[3 * i + 1] = Math.min(lField, BIG); path[3 * i + 2] = lEnd;
    point(x0, y0, z0, dx, dy, dz, k, lField, lEnd, at);
    out[0][i] = at[0]; out[1][i] = at[1]; out[2][i] = at[2];
  }
  return { n, dir, path, end: out };
}

const outside = (f: Field, x: number, y: number, z: number) => Math.hypot(x, y) >= f.rMax || Math.abs(z) >= f.zMax;

/** sin(h) / h, 1 at 0. */
const sinc = (h: number) => (Math.abs(h) < 1e-4 ? 1 - (h * h) / 6 : Math.sin(h) / h);

/** The point at path length l (written to `out`), for a path from (x0, y0, z0) along unit d, turning k rad/cm while
 *  in the field (the first lField cm). */
export function point(x0: number, y0: number, z0: number, dx: number, dy: number, dz: number, k: number, lField: number, l: number, out: Float64Array) {
  const lh = Math.min(l, lField), h = 0.5 * k * lh, s = sinc(h), a = s * Math.cos(h), b = s * Math.sin(h);
  const c = Math.cos(2 * h), sn = Math.sin(2 * h), rest = Math.max(l - lh, 0); // the straight part, along the last direction
  out[0] = x0 + lh * (dx * a - dy * b) + rest * (dx * c - dy * sn);
  out[1] = y0 + lh * (dy * a + dx * b) + rest * (dx * sn + dy * c);
  out[2] = z0 + l * dz;
  return out;
}

/** Path length at which the helix leaves the field cylinder (BIG if it never does: a looper). */
function fieldLength(f: Field, x0: number, y0: number, z0: number, dx: number, dy: number, dz: number, k: number) {
  let l = dz > 0 ? (f.zMax - z0) / dz : dz < 0 ? (-f.zMax - z0) / dz : BIG;
  const dT = Math.hypot(dx, dy);
  if (dT < 1e-12) return l;
  // Transverse circle: curvature w per cm of transverse path, centre c, radius R. The radius from the beam axis along
  // it is rho^2 = |c|^2 + R^2 + 2 R |c| cos(beta - gamma), beta the angle on the circle, gamma the centre's azimuth.
  const w = k / dT, R = 1 / Math.abs(w), ux = dx / dT, uy = dy / dT;
  const cx = x0 - uy / w, cy = y0 + ux / w, cr = Math.hypot(cx, cy);
  const cosTarget = (f.rMax * f.rMax - cr * cr - R * R) / (2 * R * cr);
  if (cr > 1e-9 && Math.abs(cosTarget) <= 1) {
    const beta0 = Math.atan2(y0 - cy, x0 - cx), gamma = Math.atan2(cy, cx), off = Math.acos(cosTarget), sign = Math.sign(w);
    for (const target of [gamma + off, gamma - off]) {
      const turn = mod2pi(sign * (target - beta0)); // angle turned to get there, in the direction of motion
      if (turn > 1e-9) l = Math.min(l, (turn * R) / dT);
    }
  }
  return l;
}

const mod2pi = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

/** Path length at which the path is level with the end point (see the top of the file). */
function endLength(x0: number, y0: number, z0: number, dx: number, dy: number, dz: number, k: number, lField: number, ex: number, ey: number, ez: number) {
  const along = ez - z0, across = Math.hypot(ex - x0, ey - y0);
  if (!Number.isFinite(along) || !Number.isFinite(across)) return 0;
  const lz = dz !== 0 && along / dz > 0 ? along / dz : NaN;
  const lt = transverseLength(x0, y0, dx, dy, k, lField, across);
  const pick = Math.abs(along) >= across ? [lz, lt] : [lt, lz];
  return pick.find((l) => Number.isFinite(l)) ?? NaN; // neither: e.g. a looper that never gets as far out
}

/** First path length at which the transverse distance from the start is `dist`, NaN if never. On the helix it grows
 *  as 2 R sin(turn / 2) up to half a turn; after the field, along the straight line. */
function transverseLength(x0: number, y0: number, dx: number, dy: number, k: number, lField: number, dist: number) {
  const dT = Math.hypot(dx, dy);
  if (dT < 1e-12) return NaN;
  const R = dT / Math.abs(k), sField = lField * dT; // radius and transverse length in the field
  if (dist <= 2 * R) {
    const s = 2 * R * Math.asin(dist / (2 * R));
    if (s <= sField) return s / dT;
  }
  if (sField >= Math.PI * R) return NaN; // still in the field after half a turn: a looper that never gets so far
  const p = point(x0, y0, 0, dx, dy, 0, k, lField, lField, new Float64Array(3)), th = k * lField;
  const ax = p[0] - x0, ay = p[1] - y0, ux = dx * Math.cos(th) - dy * Math.sin(th), uy = dx * Math.sin(th) + dy * Math.cos(th);
  const b = ax * ux + ay * uy, uu = ux * ux + uy * uy, disc = b * b - uu * (ax * ax + ay * ay - dist * dist);
  if (disc < 0 || uu < 1e-24) return NaN;
  const t = (-b + Math.sqrt(disc)) / uu;
  return t >= 0 ? lField + t : NaN;
}

/** `points` points per path, evenly spaced in length from start to end (interleaved per path: path i is
 *  [i * points, (i + 1) * points)), for picking and framing on the CPU. Filled per path on first use (`fill(i)`):
 *  most paths of a big layer (e.g. 100k truth particles at PU200, drawn only for a selection) are never picked, and
 *  the pages of the arrays they would use are then never touched. */
export function polylines(paths: Paths, start: Columns3, points: number) {
  const { n, dir, path } = paths, x = new Float32Array(n * points), y = new Float32Array(n * points), z = new Float32Array(n * points);
  const done = new Uint8Array(n), at = new Float64Array(3);
  const fill = (i: number) => {
    if (done[i]) return;
    done[i] = 1;
    for (let j = 0; j < points; j++) {
      point(start[0][i], start[1][i], start[2][i], dir[3 * i], dir[3 * i + 1], dir[3 * i + 2], path[3 * i], path[3 * i + 1],
        (path[3 * i + 2] * j) / (points - 1), at);
      x[i * points + j] = at[0]; y[i * points + j] = at[1]; z[i * points + j] = at[2];
    }
  };
  return { points, x, y, z, fill };
}
