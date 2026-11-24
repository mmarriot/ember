// Where the camera goes, as pure geometry (render/engine.ts moves the cameras): the preset directions, fitting a box
// into a 2D view, and the bounding box of what is drawn.
import * as THREE from "three";
import type { ViewName } from "../io/format";
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
 *  with a margin. The smallest size framed is the caller's (Engine.frame: the profile's minRadius, e.g. 15 cm in the
 *  tracker), so a short track fills the view as a long one does. */
export const flatZoom = (frustumW: number, frustumH: number, w: number, h: number) =>
  0.85 * Math.min(frustumW / Math.max(w, 1), frustumH / Math.max(h, 1));

/** A part of the view, as fractions of its width and height from its top left corner: x0 < x1, y0 < y1 in [0, 1]. */
export interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** The whole view. */
export const WHOLE: Area = { x0: 0, y0: 0, x1: 1, y1: 1 };

/** The part of a width x height view (px) that a panel over it leaves free: the largest of the four rectangles beside
 *  it (left, right, above, below), at least 40% of the view each way, so a panel that covers nearly all of it still
 *  leaves room to frame. `cover`: the panel's rectangle (px from the view's top left); null: the whole view. */
export function freeArea(width: number, height: number, cover: Area | null): Area {
  if (!cover || width <= 0 || height <= 0) return WHOLE;
  const x0 = Math.min(Math.max(cover.x0 / width, 0), 1),
    x1 = Math.min(Math.max(cover.x1 / width, 0), 1),
    y0 = Math.min(Math.max(cover.y0 / height, 0), 1),
    y1 = Math.min(Math.max(cover.y1 / height, 0), 1);
  const sides: Area[] = [
    { x0: 0, y0: 0, x1: Math.max(x0, 0.4), y1: 1 },
    { x0: Math.min(x1, 0.6), y0: 0, x1: 1, y1: 1 },
    { x0: 0, y0: 0, x1: 1, y1: Math.max(y0, 0.4) },
    { x0: 0, y0: Math.min(y1, 0.6), x1: 1, y1: 1 },
  ];
  const size = (a: Area) => (a.x1 - a.x0) * width * (a.y1 - a.y0) * height;
  return sides.reduce((a, b) => (size(b) > size(a) ? b : a));
}

/** A 2D view's zoom and target: a width x height (cm) around `ctr` fitted into the `free` part of the view and centred
 *  there, so the target moves on screen from the view's centre to the free part's. */
export function flatAim(
  ctr: THREE.Vector3,
  dir: THREE.Vector3,
  frustumW: number,
  frustumH: number,
  w: number,
  h: number,
  free: Area = WHOLE,
) {
  const zoom = flatZoom((free.x1 - free.x0) * frustumW, (free.y1 - free.y0) * frustumH, w, h);
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
  // The free part's centre, from the view's centre: right and down, as fractions of the frustum.
  const cx = (free.x0 + free.x1) / 2 - 0.5,
    cy = (free.y0 + free.y1) / 2 - 0.5;
  const target = ctr
    .clone()
    .addScaledVector(right, (-cx * frustumW) / zoom)
    .addScaledVector(new THREE.Vector3(0, 1, 0), (cy * frustumH) / zoom);
  return { zoom, target };
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
