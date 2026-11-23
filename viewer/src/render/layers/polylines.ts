// Paths through measured points (`polyline`), e.g. a muon track through its hits and segments: one straight piece
// per pair of consecutive points, one instance each.
import * as THREE from "three";
import type { DisplayLayer } from "../../io/format";
import {
  baseUniforms,
  commonFields,
  CULL,
  followDrawingBuffer,
  halo,
  type Layer,
  type LayerInput,
  SHADER_COMMON,
  setLineQuad,
  shaderLayer,
} from "./layer";

/** Each row's points for `polyline`: through relation `points.relation`, the `to` rows' positions in stored order.
 *  Returns per row the number of pieces (point pairs, at least 1: a row with fewer than 2 points draws nothing) and a
 *  flat point list with each row's first point index. */
export function polylinePoints(d: DisplayLayer, n: number, relation: LayerInput["relation"]) {
  const rel = d.points && relation?.(d.points.relation),
    cols = d.points?.position ?? ["x", "y", "z"];
  const offsets = new Uint32Array(n + 1),
    xyz: number[] = [];
  for (let i = 0; i < n; i++) {
    if (rel && i + 1 < rel.offsets.length) {
      const p = cols.map((c) => rel.to.columns[c]);
      for (let k = rel.offsets[i]; k < rel.offsets[i + 1]; k++) {
        const j = rel.indices[k],
          v = p.map((c) => (c ? Number(c[j]) : NaN));
        if (v.every(Number.isFinite)) xyz.push(...v);
      }
    }
    offsets[i + 1] = xyz.length / 3;
  }
  const pieces = new Uint16Array(n);
  for (let i = 0; i < n; i++) pieces[i] = Math.min(65535, Math.max(1, offsets[i + 1] - offsets[i] - 1));
  return { offsets, xyz: Float32Array.from(xyz), pieces };
}

const PICK_MAX = 64; // points per path kept for picking and framing

/** Paths through measured points (e.g. a muon track through its hits and segments): one straight piece per pair of
 *  consecutive points, an instance each, `width` px wide (quads across the line on screen) or 1 px lines. In a replay
 *  each path grows piece by piece from its first point. Picked and framed along its points (up to 64 per path). */
export function pointPaths(input: LayerInput): Layer {
  const { d, t } = input,
    n = t.n,
    wide = (d.width ?? 1) > 1;
  const { offsets, xyz, pieces } = polylinePoints(d, n, input.relation);
  const g = new THREE.InstancedBufferGeometry();
  if (wide) setLineQuad(g);
  else g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3)); // x: 0 at the start, 1 at the end
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...baseUniforms(input.pal, input.d.context),
      uWidth: { value: (d.width ?? 1) * (globalThis.devicePixelRatio ?? 1) },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    defines: wide ? { WIDE: 1 } : {},
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float isel, ipsel, icut, iT, ipiece, ipieces;
      attribute vec3 icol, ia, ib; // this piece's ends
      uniform float uWidth;
      uniform vec2 uRes;
      varying vec3 vCol;
      ${SHADER_COMMON}
      void main() {
        ${CULL()}
        // Replay: the path grows over 0.5 s, piece after piece.
        float f = uClock > 1e29 ? 1.0 : clamp(clamp((uClock - iT) / 0.5, 0.0, 1.0) * ipieces - ipiece, 0.0, 1.0), s = selected(ipsel, isel);
        vec3 a = ia, b = mix(ia, ib, f);
        if (uProj > 0.5) { float side = ib.y >= 0.0 ? 1.0 : -1.0; a = projectRZ(a, 2.0 + s, side); b = projectRZ(b, 2.0 + s, side); }
        vec4 A = projectionMatrix * modelViewMatrix * vec4(a, 1.0), B = projectionMatrix * modelViewMatrix * vec4(b, 1.0);
        gl_Position = mix(A, B, position.x);
        #ifdef WIDE
        vec2 along = (B.xy / B.w - A.xy / A.w) * uRes, across = length(along) > 1e-6 ? normalize(vec2(-along.y, along.x)) : vec2(0.0, 1.0);
        gl_Position.xy += across * position.y * (uWidth * (1.0 + 0.5 * s * selActive() + 2.0 * gPin) + HALO_PX) / uRes * gl_Position.w;
        #endif
        gl_Position = inFront(gl_Position, s);
        vCol = fade(mix(mix(icol, vec3(1.0), 0.3 * s * selActive()), vec3(1.0), uFlash * pop(iT)), s) * remaining() + uBg * (1.0 - remaining());
      }`,
    fragmentShader: `varying vec3 vCol; void main() { gl_FragColor = vec4(vCol, 1.0); }`,
  });
  const common = shaderLayer(input, g, material, true, {}, {}, pieces);
  // The pieces' ends, in the instances' order (shaderLayer: each kept row's pieces in turn).
  const rowOf = common.toInstances(Float32Array.from({ length: n }, (_, i) => i)),
    piece = g.getAttribute("ipiece").array as Float32Array;
  const m = rowOf.length,
    a = new Float32Array(3 * m),
    b = new Float32Array(3 * m);
  for (let k = 0; k < m; k++) {
    const r = rowOf[k],
      first = offsets[r],
      count = offsets[r + 1] - first,
      j = first + Math.min(piece[k], Math.max(count - 2, 0));
    for (let c = 0; c < 3; c++) {
      a[3 * k + c] = count ? xyz[3 * j + c] : 0;
      b[3 * k + c] = count > 1 ? xyz[3 * (j + 1) + c] : a[3 * k + c];
    }
  }
  g.setAttribute("ia", new THREE.InstancedBufferAttribute(a, 3));
  g.setAttribute("ib", new THREE.InstancedBufferAttribute(b, 3));
  const mesh = wide ? new THREE.Mesh(g, material) : new THREE.LineSegments(g, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  if (wide) followDrawingBuffer(mesh, material);
  const quad = new THREE.BufferGeometry(); // the halo's shape
  setLineQuad(quad);
  const ring = halo(g, material, quad, mesh.renderOrder, input.pal);
  // Picking and framing: each path's points, at most PICK_MAX (evenly chosen), padded with its last point; its last
  // point is where it is (x, y, z), as for lines.
  let most = 2;
  for (let i = 0; i < n; i++) most = Math.max(most, Math.min(PICK_MAX, offsets[i + 1] - offsets[i]));
  const px = new Float32Array(n * most),
    py = new Float32Array(n * most),
    pz = new Float32Array(n * most);
  const x = new Float32Array(n),
    y = new Float32Array(n),
    z = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const first = offsets[i],
      count = offsets[i + 1] - first;
    for (let j = 0; j < most; j++) {
      const at = count
        ? first +
          Math.round((Math.min(j, Math.min(count, most) - 1) * (count - 1)) / Math.max(Math.min(count, most) - 1, 1))
        : -1;
      px[i * most + j] = at < 0 ? NaN : xyz[3 * at];
      py[i * most + j] = at < 0 ? NaN : xyz[3 * at + 1];
      pz[i * most + j] = at < 0 ? NaN : xyz[3 * at + 2];
    }
    x[i] = px[i * most + most - 1];
    y[i] = py[i * most + most - 1];
    z[i] = pz[i * most + most - 1];
  }
  return {
    ...commonFields(input, 8),
    object: new THREE.Group().add(mesh, ring.object),
    x,
    y,
    z,
    path: { points: most, x: px, y: py, z: pz, fill() {} },
    pickBias: 0.8,
    line: true,
    ...common,
    setPinned(row) {
      common.setPinned(row);
      ring.pin(material.uniforms.uPin0.value, material.uniforms.uPin1.value);
    },
    setHighlight(rows) {
      common.setHighlight(rows);
      ring.refresh(); // the halo's copy of the selection flags
    },
    setTimeline(appear, link) {
      common.setTimeline(appear, link);
      ring.refresh(); // and of the replay's times
    },
    dispose() {
      g.dispose();
      quad.dispose();
      material.dispose();
      ring.dispose();
    },
  };
}
