// Where the camera goes, as pure geometry (render/engine.ts moves the cameras): the preset directions, fitting a box
// into a 2D view, the bounding box of what is drawn, and the envelope the tour camera stays out of.
import * as THREE from "three";
import type { ViewName } from "../io/bundle";
import { toCylinder } from "./geometry";
import type { Layer } from "./layers";

/** Rows to frame, per table. */
export type Rows = Map<string, Iterable<number>>;

/** The camera's direction from its target in the 3D view and in the front and side views. */
export const DIRECTIONS: Record<Exclude<ViewName, "rz">, [number, number, number]> = {
  "3d": [0.62, 0.32, 0.72],
  front: [0, 0, 1],
  side: [1, 0, 0],
};

/** The unit direction from the target to the camera of a view preset (3D: the standard 3/4 view). */
export const presetDirection = (view: ViewName) =>
  new THREE.Vector3(...DIRECTIONS[view as Exclude<ViewName, "rz">]).normalize();

/** The 2D views (front, side, rho-z) are orthographic, seen along a fixed direction with y up (rho-z: its shaders put
 *  (z, rho) in the xy plane): the camera direction from the target, and the width and height on screen of a box of
 *  `size` (view coordinates). */
export function flatView(view: Exclude<ViewName, "3d">) {
  const dir = view === "side" ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const extent = (size: THREE.Vector3): [number, number] => [
    Math.abs(view === "side" ? size.z : size.x),
    Math.abs(size.y),
  ];
  return { dir, extent };
}

/** Orthographic zoom that fits a width x height (cm) into a camera whose frustum at zoom 1 is frustumW x frustumH,
 *  with a margin. */
export const flatZoom = (frustumW: number, frustumH: number, w: number, h: number) =>
  0.85 * Math.min(frustumW / Math.max(w + 30, 80), frustumH / Math.max(h + 30, 80));

/** A 2D view's zoom and target: a width x height (cm) around `ctr` fitted into the part of the view a panel on the
 *  right leaves free (`free`: its share of the width, at least 0.4) and centred there, so the target moves right on
 *  screen by half the covered width. */
export function flatAim(
  ctr: THREE.Vector3,
  dir: THREE.Vector3,
  frustumW: number,
  frustumH: number,
  w: number,
  h: number,
  free: number,
) {
  const f = Math.min(1, Math.max(0.4, free)),
    zoom = flatZoom(f * frustumW, frustumH, w, h);
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
  return { zoom, target: ctr.clone().addScaledVector(right, (0.5 * (1 - f) * frustumW) / zoom) };
}

/** A camera distance far enough that the orthographic camera's depth range (+-5000 cm around it) holds the detector. */
export const FLAT_DISTANCE = 1000;

/** Writes point i of the columns X, Y, Z to `out` in view coordinates (see Engine.toView); `sideY`: in rho-z, the
 *  y whose sign decides the side of the axis (a line's end), instead of the point's own. */
type ToView = (
  X: Float32Array,
  Y: Float32Array,
  Z: Float32Array,
  i: number,
  out: THREE.Vector3,
  sideY?: number,
) => THREE.Vector3;
/** Bounding box (view coordinates, from `toView`) of the bulk of the given layers' objects, or of the given rows: 2nd
 *  to 98th percentile per axis, from at most ~20k objects. Context layers count only when nothing else is drawn. A
 *  point that is not finite (a path with no points, a line without an end) is left out: it would make the box NaN. */
export function boxOf(
  drawn: readonly Layer[],
  selection: Rows | undefined,
  toView: ToView,
): [THREE.Vector3, THREE.Vector3] | null {
  const fg = drawn.some((l) => !l.context && l.x.length);
  const layers = drawn.filter((l) => (selection ? selection.has(l.table) : !l.context || !fg));
  const step = Math.max(1, Math.floor(layers.reduce((s, l) => s + l.x.length, 0) / 20000));
  const pts: number[][] = [[], [], []],
    p = new THREE.Vector3(),
    finite = (v: THREE.Vector3) => Number.isFinite(v.x + v.y + v.z);
  let k = 0;
  const add = (l: Layer, i: number) => {
    if (!l.passes(i) || k++ % step) return;
    if (!finite(toView(l.x, l.y, l.z, i, p))) return;
    pts[0].push(p.x);
    pts[1].push(p.y);
    pts[2].push(p.z);
  };
  for (const l of layers) {
    const rows = selection?.get(l.table);
    if (rows) for (const i of rows) add(l, i);
    else for (let i = 0; i < l.x.length; i++) add(l, i);
  }
  if (!pts[0].length) return null;
  const sorted = pts.map((a) => Float64Array.from(a).sort());
  const q = (f: number) => new THREE.Vector3(...sorted.map((a) => a[Math.floor(f * (a.length - 1))]));
  const trim = pts[0].length > 50 ? 0.02 : 0;
  const lo = q(trim),
    hi = q(1 - trim);
  // A selection's lines (e.g. a candidate's track, from the vertex) stay in view whole: their start points are
  // few, so the trimming above would drop them.
  const grow = () => {
    if (finite(p)) {
      lo.min(p);
      hi.max(p);
    }
  };
  for (const l of layers) {
    if (!selection || !l.line) continue;
    const rows = selection.get(l.table) ?? [],
      path = l.path;
    if (path) {
      for (const i of rows) {
        if (!l.passes(i)) continue;
        path.fill(i);
        for (let j = i * path.points; j < (i + 1) * path.points; j++) {
          toView(path.x, path.y, path.z, j, p, l.y[i]);
          grow();
        }
      }
    } else if (l.segment) {
      const [X, Y, Z] = l.segment.a;
      for (const i of rows)
        if (l.passes(i)) {
          toView(X, Y, Z, i, p, l.y[i]);
          grow();
        }
    }
  }
  return [lo, hi];
}

/** An angle in (-pi, pi]. */
export const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The cylinder around the beam axis (z) that the tour camera stays out of: radius `r` and half length `z` (cm). */
export interface Envelope {
  r: number;
  z: number;
}

/** The drawn objects' extent with 10% + 15 cm to spare. Lines (tracks, particles) are left out: they reach past
 *  the detector. */
export function envelopeOf(layers: Layer[]): Envelope {
  let r2 = 0,
    z = 0;
  for (const l of layers) {
    if (l.line) continue;
    for (let i = 0; i < l.x.length; i++) {
      r2 = Math.max(r2, l.x[i] * l.x[i] + l.y[i] * l.y[i]);
      z = Math.max(z, Math.abs(l.z[i]));
    }
  }
  return { r: 1.1 * Math.sqrt(r2) + 15, z: 1.1 * z + 15 };
}

/** How far from `p` along the unit direction `dir` the envelope is left (0 if `p` is outside it). */
export const exitDistance = (env: Envelope, p: THREE.Vector3, dir: THREE.Vector3) =>
  toCylinder(p.x, p.y, p.z, dir.x, dir.y, dir.z, env.r, env.z);
