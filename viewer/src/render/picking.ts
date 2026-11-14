// Picking: which drawn object is under a point of the screen. Each object is projected to the screen on the CPU and
// compared with the cursor, in units of its layer's pick radius; no GPU read-back, so a pick costs no frame.
import * as THREE from "three";
import type { Layer } from "./layers";

/** An object found under the cursor: its table and row, and the label of the layer it was picked in. */
export interface Hit {
  table: string;
  row: number;
  layer: string;
}

/** Where the cursor is and how the scene is seen: the canvas's rectangle on the page, the camera, and whether the
 *  view is the rho-z projection. */
export interface PickView {
  rect: DOMRect;
  camera: THREE.Camera;
  rz: boolean;
}

/** Every layer's closest object under the screen point (clientX, clientY), one per layer, best first: what is stacked
 *  there, e.g. a candidate, its tracksters, a hit, a truth line. Distances are in units of the layer's pick radius
 *  (times its pickBias), so a big shower and a small cell compete fairly; nothing beyond one radius is picked.
 *  Objects that are cut away, and those `accept` rejects, are ignored. Background (context) layers count only when
 *  nothing else is under the cursor. */
export function pickAll(
  layers: readonly Layer[],
  { rect, camera, rz }: PickView,
  clientX: number,
  clientY: number,
  accept?: (table: string, row: number) => boolean,
): Hit[] {
  const px = clientX - rect.left,
    py = clientY - rect.top,
    hw = 0.5 * rect.width,
    hh = 0.5 * rect.height;
  const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;

  // One pass over every drawn object per pointer move (~640k at PU200), so nothing is allocated per object: the
  // projection writes to a typed array (a number kept in a variable that a closure captures and changes would be
  // boxed on the heap), distances stay squared, and the cut test (a call) is made only for objects close enough to win.
  const out = new Float64Array(2); // screen offset from the cursor of the last point projected
  // ρ-z: `side` (±1) puts the point on one side of the axis (a line's, see Engine.toView); 0: the point's own side.
  const project = (X: Float32Array, Y: Float32Array, Z: Float32Array, i: number, side = 0) => {
    let x = X[i],
      y = Y[i],
      z = Z[i];
    if (rz) {
      y = Math.sqrt(x * x + y * y) * (side || (y >= 0 ? 1 : -1));
      x = Z[i];
      z = 0;
    }
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 0) return false; // behind the camera
    out[0] = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * hw - px;
    out[1] = (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * hh - py;
    return true;
  };

  // A polyline (helix): the squared distance to the closest point of its segments, or Infinity when none of its
  // points is in front of the camera.
  const alongPath = (path: NonNullable<Layer["path"]>, i: number, side: number) => {
    let best = Infinity,
      ax = 0,
      ay = 0,
      prev = false;
    for (let j = i * path.points; j < (i + 1) * path.points; j++) {
      const ok = project(path.x, path.y, path.z, j, side),
        bx = out[0],
        by = out[1];
      if (ok && prev) {
        const ex = bx - ax,
          ey = by - ay,
          len2 = ex * ex + ey * ey;
        const f = len2 > 0 ? Math.min(1, Math.max(0, -(ax * ex + ay * ey) / len2)) : 0,
          dx = ax + f * ex,
          dy = ay + f * ey;
        best = Math.min(best, dx * dx + dy * dy);
      }
      prev = ok;
      ax = bx;
      ay = by;
    }
    return best;
  };

  const found: { hit: Hit; score: number; context?: boolean }[] = [];
  for (const layer of layers) {
    const X = layer.x,
      Y = layer.y,
      Z = layer.z,
      seg = layer.segment,
      path = layer.path,
      bias = layer.pickBias ?? 1;
    const scale = (bias * bias) / (layer.pickRadius * layer.pickRadius);
    let best = -1,
      bestScore = 1;
    for (let i = 0; i < X.length; i++) {
      const side = layer.line ? (Y[i] >= 0 ? 1 : -1) : 0; // a line: the side of its end
      if (path) {
        // the cut test first: a path's points are computed when it is first looked at
        if (!layer.passes(i)) continue;
        path.fill(i);
        const score = scale * alongPath(path, i, side);
        if (score < bestScore && (!accept || accept(layer.table, i))) {
          bestScore = score;
          best = i;
        }
        continue;
      }
      if (!(seg ? project(seg.b[0], seg.b[1], seg.b[2], i, side) : project(X, Y, Z, i))) continue;
      let dx = out[0],
        dy = out[1];
      if (seg && project(seg.a[0], seg.a[1], seg.a[2], i, side)) {
        // a line or a shower's axis: the closest point of the segment
        const ax = out[0],
          ay = out[1],
          ex = dx - ax,
          ey = dy - ay,
          len2 = ex * ex + ey * ey;
        const f = len2 > 0 ? Math.min(1, Math.max(0, -(ax * ex + ay * ey) / len2)) : 0;
        dx = ax + f * ex;
        dy = ay + f * ey;
      }
      const score = scale * (dx * dx + dy * dy);
      if (score < bestScore && layer.passes(i) && (!accept || accept(layer.table, i))) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0)
      found.push({
        hit: { table: layer.table, row: best, layer: layer.label },
        score: bestScore,
        context: layer.context,
      });
  }
  const foreground = found.filter((f) => !f.context);
  return (foreground.length ? foreground : found).sort((a, c) => a.score - c.score).map((f) => f.hit);
}
