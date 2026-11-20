// Straight lines (`segments`): from `position` to `end`, or along a direction for a length (e.g. tracks drawn
// straight, MET, a lepton's direction). Thin lines are WebGL lines, one pixel wide; wider ones and arrows are quads
// whose width the vertex shader keeps constant on screen.
import * as THREE from "three";
import { type DisplayLayer, type Table, toF32 } from "../../io/format";
import { isToCylinder, perRow } from "../geometry";
import { REPLAY_OFF } from "../replay";
import {
  baseUniforms,
  commonFields,
  CULL,
  DASHED_LINE_FRAGMENT,
  followDrawingBuffer,
  halo,
  interleave,
  type Layer,
  type LayerInput,
  positions,
  SHADER_COMMON,
  setLineQuad,
  shaderLayer,
  type Vec3s,
} from "./layer";

/** Lines from `position` to `end` (e.g. a track from its vertex to the calorimeter), or along `direction` for `length`
 *  (`centred`: half each way); in a replay each one shoots out from its start. WebGL draws them 1 pixel wide; with a
 *  `width` or an `arrow`, see wideSegments. Picked and framed by their end point. */
export function segments(input: LayerInput): Layer {
  const { d, t } = input;
  const [start, [x, y, z]] = segmentEnds(d, t, positions(input));
  if ((d.width ?? 1) > 1 || d.arrow) return wideSegments(input, start, [x, y, z]);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3)); // x: 0 at the start, 1 at the end
  const material = new THREE.ShaderMaterial({
    uniforms: { ...baseUniforms(input.pal), uDash: { value: d.truth ? 1 : 0 } },
    vertexShader: /* glsl */ `
      attribute float ix, iy, iz, jx, jy, jz, isel, ipsel, icut, iT;
      attribute vec3 icol;
      varying vec3 vCol;
      varying float vS; // distance along the line [cm], for dashes
      ${SHADER_COMMON}
      void main() {
        ${CULL()}
        float grow = uClock > 1e29 ? 1.0 : clamp((uClock - iT) / 0.5, 0.0, 1.0);
        vec3 c = mix(vec3(ix, iy, iz), vec3(jx, jy, jz), position.x * grow);
        vS = position.x * grow * length(vec3(jx, jy, jz) - vec3(ix, iy, iz));
        float s = selected(ipsel, isel);
        if (uProj > 0.5) c = projectRZ(c, s * 2.0, jy >= 0.0 ? 1.0 : -1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(c, 1.0);
        vCol = fade(mix(icol, vec3(1.0), uFlash * pop(iT)), s) * remaining() + uBg * (1.0 - remaining());
      }`,
    fragmentShader: DASHED_LINE_FRAGMENT,
  });
  const common = shaderLayer(input, g, material, true, {
    ix: start[0],
    iy: start[1],
    iz: start[2],
    jx: x,
    jy: y,
    jz: z,
  });
  const lines = new THREE.LineSegments(g, material);
  lines.frustumCulled = false;
  lines.renderOrder = 1;
  return {
    ...commonFields(input, 8),
    object: lines,
    x,
    y,
    z,
    segment: { a: start, b: [x, y, z] },
    pickBias: 0.8,
    line: true,
    ...common,
    dispose() {
      g.dispose();
      material.dispose();
    },
  };
}

/** A segments layer's start and end points: `position` to `end`, or along `direction` for `length` cm (from
 *  `position`, or `centred` on it). */
export function segmentEnds(d: DisplayLayer, t: Table, position: Vec3s): [Vec3s, Vec3s] {
  if (!d.direction) return [position, (d.end ?? d.position).map((c) => toF32(t.columns[c], t.n)) as Vec3s];
  const n = t.n,
    dir = d.direction.map((c) => toF32(t.columns[c], n)),
    len = perRow(t.columns, n, isToCylinder(d.length) ? undefined : d.length, 100);
  const a: Vec3s = [new Float32Array(n), new Float32Array(n), new Float32Array(n)],
    b: Vec3s = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const m = Math.hypot(dir[0][i], dir[1][i], dir[2][i]) || 1,
      back = d.centred ? 0.5 * len[i] : 0,
      ahead = len[i] - back;
    for (let k = 0; k < 3; k++) {
      a[k][i] = position[k][i] - (back * dir[k][i]) / m;
      b[k][i] = position[k][i] + (ahead * dir[k][i]) / m;
    }
  }
  return [a, b];
}

/** Segments `width` px wide (`d.width`, default 2), e.g. MET or a lepton: each line is a quad, its two sides offset by
 *  half the width across the line's direction on screen in the vertex shader (4 vertices per line, nothing on the
 *  CPU), so it keeps its width at any zoom. `arrow`: a cone head at the end, placed on the CPU (for a few objects). */
function wideSegments(input: LayerInput, start: Vec3s, end: Vec3s): Layer {
  const { d, t } = input,
    n = t.n,
    [x, y, z] = end;
  const g = new THREE.InstancedBufferGeometry();
  setLineQuad(g);
  const px = globalThis.devicePixelRatio ?? 1;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...baseUniforms(input.pal),
      uWidth: { value: (d.width ?? 2) * px },
      uRes: { value: new THREE.Vector2(1, 1) },
      uDash: { value: d.truth ? 1 : 0 },
    },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float isel, ipsel, icut, iT;
      attribute vec3 icol, istart, iend;
      uniform float uWidth;
      uniform vec2 uRes; // drawing buffer size (px)
      varying vec3 vCol;
      varying float vS;
      ${SHADER_COMMON}
      void main() {
        ${CULL()}
        float grow = uClock > 1e29 ? 1.0 : clamp((uClock - iT) / 0.5, 0.0, 1.0), s = selected(ipsel, isel);
        vec3 a = istart, b = mix(istart, iend, grow);
        vS = position.x * length(b - a);
        if (uProj > 0.5) { float side = iend.y >= 0.0 ? 1.0 : -1.0; a = projectRZ(a, 2.0 + s, side); b = projectRZ(b, 2.0 + s, side); }
        vec4 A = projectionMatrix * modelViewMatrix * vec4(a, 1.0), B = projectionMatrix * modelViewMatrix * vec4(b, 1.0);
        vec2 along = (B.xy / B.w - A.xy / A.w) * uRes, across = length(along) > 1e-6 ? normalize(vec2(-along.y, along.x)) : vec2(0.0, 1.0);
        vec4 P = mix(A, B, position.x);
        P.xy += across * position.y * (uWidth * (1.0 + 0.5 * s * selActive() + 2.0 * gPin) + HALO_PX) / uRes * P.w; // half the width each side, in NDC
        gl_Position = P;
        vCol = fade(mix(icol, vec3(1.0), uFlash * pop(iT)), s) * remaining() + uBg * (1.0 - remaining());
      }`,
    fragmentShader: DASHED_LINE_FRAGMENT,
  });
  const common = shaderLayer(input, g, material, true, {}, { istart: interleave(start), iend: interleave(end) });
  const quads = new THREE.Mesh(g, material);
  quads.frustumCulled = false;
  quads.renderOrder = 1;
  followDrawingBuffer(quads, material);
  const quad = new THREE.BufferGeometry(); // the halo's shape
  setLineQuad(quad);
  const ring = halo(g, material, quad, quads.renderOrder, input.pal);
  const group = new THREE.Group().add(quads);
  // Arrow heads: an instanced cone per row at the line's end, along it; hidden when the line is cut or not grown yet.
  // They share the lines' uniforms, so they fade with a selection as the lines do (per head: selected before and now,
  // and pinned).
  let rgb = input.rgb,
    rz = false,
    clock = REPLAY_OFF,
    appear: Float32Array | null = null,
    pinned = -1;
  const headSel = new Float32Array(d.arrow ? 3 * Math.max(n, 1) : 0); // per row: selected now, before, pinned
  const heads = d.arrow
    ? new THREE.InstancedMesh(
        new THREE.ConeGeometry(1, 1, 20).translate(0, -0.5, 0),
        new THREE.ShaderMaterial({
          uniforms: material.uniforms,
          // raw colours, as the lines
          vertexShader: /* glsl */ `
      attribute vec3 iflags;
      varying vec3 vCol;
      ${SHADER_COMMON}
      void main() {
        gPin = iflags.z;
        #ifdef USE_INSTANCING_COLOR
        vCol = fade(instanceColor, selected(iflags.y, iflags.x));
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
          fragmentShader: `varying vec3 vCol; void main() { gl_FragColor = vec4(vCol, 1.0); }`,
        }),
        Math.max(n, 1),
      )
    : null;
  const flags = new THREE.InstancedBufferAttribute(headSel, 3);
  heads?.geometry.setAttribute("iflags", flags);
  const placeHeads = () => {
    if (!heads) return;
    const m = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      up = new THREE.Vector3(0, 1, 0),
      c = new THREE.Color();
    const project = (v: THREE.Vector3, side: number) => (rz ? v.set(v.z, Math.hypot(v.x, v.y) * side, 3) : v);
    for (let i = 0; i < n; i++) {
      const side = y[i] >= 0 ? 1 : -1,
        grown = clock >= REPLAY_OFF || clock >= (appear?.[i] ?? 0) + 0.5;
      project(a.set(start[0][i], start[1][i], start[2][i]), side);
      project(b.set(x[i], y[i], z[i]), side);
      const dir = b.clone().sub(a),
        len = dir.length(),
        h = common.passes(i) && grown && len > 0 ? Math.max(6, 0.1 * len) : 0;
      q.setFromUnitVectors(up, len > 0 ? dir.divideScalar(len) : up);
      heads.setMatrixAt(i, m.compose(b, q, new THREE.Vector3(0.4 * h, h, 0.4 * h)));
      heads.setColorAt(i, c.setRGB(rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2], THREE.LinearSRGBColorSpace));
    }
    heads.instanceMatrix.needsUpdate = true;
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
  };
  if (heads) {
    heads.count = n;
    heads.frustumCulled = false;
    heads.renderOrder = 1;
    group.add(heads);
    placeHeads();
  }
  group.add(ring.object); // the group: the lines, the heads, the halo
  return {
    ...commonFields(input, 10),
    object: group,
    x,
    y,
    z,
    segment: { a: start, b: end },
    pickBias: 0.7,
    line: true,
    ...common,
    setCut(min) {
      const shown = common.setCut(min);
      placeHeads();
      return shown;
    },
    setPinned(row) {
      common.setPinned(row);
      ring.pin(material.uniforms.uPin0.value, material.uniforms.uPin1.value);
      if (!heads) return;
      if (pinned >= 0) headSel[3 * pinned + 2] = 0;
      pinned = row;
      if (row >= 0) headSel[3 * row + 2] = 1;
      flags.needsUpdate = true;
      placeHeads(); // a pinned head is drawn whatever the cut
    },
    setHighlight(rows) {
      common.setHighlight(rows);
      ring.refresh(); // the halo's copy of the selection flags
      if (!heads) return;
      for (let i = 0; i < n; i++) {
        headSel[3 * i + 1] = headSel[3 * i];
        headSel[3 * i] = rows?.has(i) ? 1 : 0;
      }
      flags.needsUpdate = true;
    },
    setColours(c) {
      rgb = c;
      common.setColours(c);
      placeHeads();
    },
    setProjection(v) {
      rz = v;
      common.setProjection(v);
      placeHeads();
    },
    setTimeline(a, l) {
      appear = a;
      common.setTimeline(a, l);
      ring.refresh(); // the halo's copy of the replay's times
      placeHeads();
    },
    setClock(t) {
      const was = clock;
      clock = t;
      common.setClock(t);
      if (heads && (t < REPLAY_OFF || was < REPLAY_OFF)) placeHeads();
    },
    dispose() {
      g.dispose();
      material.dispose();
      quad.dispose();
      ring.dispose();
      heads?.geometry.dispose();
      (heads?.material as THREE.Material | undefined)?.dispose();
      heads?.dispose();
    },
  };
}
