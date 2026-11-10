// Drawable layers. Each is one draw call (instanced); colours come precomputed per object, the shaders handle
// projection, the cut, the selection fade and the replay. A cut change or a replay frame is one uniform; a selection
// rewrites a byte per object.
import * as THREE from "three";
import type { DisplayLayer, Table } from "../io/bundle";
import { toF32, type Pal } from "./colour";
import { REPLAY_OFF } from "./replay";

export interface Layer {
  readonly key: string;
  readonly table: string;
  readonly label: string;
  readonly pickRadius: number; // px
  readonly object: THREE.Object3D;
  readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array;
  passes(i: number): boolean; // survives the current cut
  setCut(min: number): number; // returns the number of objects shown
  setColours(rgb: Float32Array): void;
  setHighlight(rows: Set<number> | null): void; // the new selection; setHighlightMix fades from the previous one
  setHighlightMix(k: number): void; // 0: as before the last setHighlight, 1: as after
  setProjection(rz: boolean): void;
  setTimeline(appear: Float32Array, link: Float32Array): void; // replay: when each object appears / joins its group (s)
  setClock(t: number): void; // replay time in s; REPLAY_OFF shows the final state
  setRetire(t: number): void; // replay: when the layer gives way to the next reconstruction stage (s); REPLAY_OFF: never
  setFade?(from: number, to: number, amount: number): void; // replay: fade towards the background between these times
  setColourStages?(stages: ColourStage[]): void; // replay: colours (and emphasis) from time t on, e.g. per stage
  dispose(): void;
}
export interface ColourStage { t: number; rgb: Float32Array; emphasis?: Uint8Array }
export interface LayerInput { key: string; d: DisplayLayer; t: Table; pal: Pal; rgb: Float32Array; emphasis?: Uint8Array; cut?: Float32Array }

const GLSL = /* glsl */ `
uniform float uProj, uAct0, uAct1, uMix, uCut, uClock, uFlash, uRetire;
uniform vec3 uBg, uRim, uGrey, uFade;
vec3 projectRZ(vec3 c, float depth) { return vec3(c.z, length(c.xy) * (c.y >= 0.0 ? 1.0 : -1.0), depth); }
// Selection, cross-faded between the previous and the current one: selActive = something selected, s = this one is.
float selActive() { return mix(uAct0, uAct1, uMix); }
float selected(float before, float now) { return mix(before, now, uMix); }
vec3 fade(vec3 col, float s) { return mix(col, uBg, 0.85 * selActive() * (1.0 - s)); }
float pop(float t) { return exp(-max(uClock - t, 0.0) * 6.0); } // 1 when an object appears, then decays in ~0.3 s
// 1 until the layer retires in a replay, then down to 0 over 0.6 s (always 1 outside a replay).
float remaining() { return uClock > 1e29 ? 1.0 : clamp(1.0 - (uClock - uRetire) / 0.6, 0.0, 1.0); }
// Replay: how far the layer has faded towards the background (uFade: from, to, amount; none outside a replay).
float faded() { return uClock > 1e29 ? 0.0 : uFade.z * smoothstep(uFade.x, uFade.y, uClock); }`;
const CULL = "if (icut < uCut || iT > uClock || remaining() <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }";
// Colours go to the shaders as raw sRGB values, like the per-object colours (no linear conversion).
const raw = (c: number | string) => (typeof c === "number" ? new THREE.Color().setHex(c, THREE.LinearSRGBColorSpace) : new THREE.Color().setStyle(c, THREE.LinearSRGBColorSpace));
const baseUniforms = (pal: Pal) => ({
  uProj: { value: 0 }, uAct0: { value: 0 }, uAct1: { value: 0 }, uMix: { value: 1 }, uCut: { value: -1e30 }, uClock: { value: REPLAY_OFF }, uRetire: { value: REPLAY_OFF }, uFade: { value: new THREE.Vector3(0, 1, 0) }, uFlash: { value: pal.flash },
  uBg: { value: raw(pal.background) }, uRim: { value: new THREE.Color(...pal.rim) }, uGrey: { value: raw(pal.unassigned) },
});

/** Replay bookkeeping for the shader-driven layers: per-object times as attributes, the clock as a uniform. */
function timeline(n: number, g: THREE.BufferGeometry, material: THREE.ShaderMaterial, instanced: boolean) {
  const Attr = instanced ? THREE.InstancedBufferAttribute : THREE.BufferAttribute;
  g.setAttribute("iT", new Attr(new Float32Array(n), 1));
  g.setAttribute("iL", new Attr(new Float32Array(n), 1));
  return {
    setTimeline(appear: Float32Array, link: Float32Array) { // rewrite in place: a new attribute would orphan its GPU buffer
      for (const [name, v] of [["iT", appear], ["iL", link]] as const) {
        const attr = g.getAttribute(name) as THREE.BufferAttribute;
        (attr.array as Float32Array).set(v);
        attr.needsUpdate = true;
      }
    },
    setClock(t: number) { material.uniforms.uClock.value = t; },
  };
}

/** Cut bookkeeping shared by all layer kinds. */
function cutter(n: number, values: Float32Array | undefined, onChange: (min: number) => void) {
  let min = -Infinity;
  return {
    values: values ?? new Float32Array(n),
    passes: (i: number) => !values || values[i] >= min,
    setCut(m: number) {
      min = values ? m : -Infinity;
      onChange(min);
      if (!values) return n;
      let shown = 0;
      for (let i = 0; i < n; i++) if (values[i] >= min) shown++;
      return shown;
    },
  };
}

/** Selection as two byte masks (previous and current) and a mix uniform, so a change cross-fades on the GPU:
 *  one mask copy per selection change, one uniform per frame while it fades. */
function selectionMask(n: number, g: THREE.BufferGeometry, material: THREE.ShaderMaterial, instanced: boolean) {
  const Attr = instanced ? THREE.InstancedBufferAttribute : THREE.BufferAttribute, u = material.uniforms;
  const now = new Uint8Array(n), before = new Uint8Array(n);
  g.setAttribute("isel", new Attr(now, 1, true));
  g.setAttribute("ipsel", new Attr(before, 1, true));
  return {
    setHighlight(rows: Set<number> | null) {
      before.set(now);
      now.fill(0);
      rows?.forEach((r) => (now[r] = 255));
      g.getAttribute("isel").needsUpdate = true;
      g.getAttribute("ipsel").needsUpdate = true;
      u.uAct0.value = u.uAct1.value;
      u.uAct1.value = rows ? 1 : 0;
      u.uMix.value = 0;
    },
    setHighlightMix(k: number) { u.uMix.value = k; },
  };
}

function replaceColours(attr: THREE.BufferAttribute, rgb: Float32Array) {
  (attr.array as Float32Array).set(rgb);
  attr.needsUpdate = true;
}

const positions = ({ d, t }: LayerInput) => d.position.map((c) => toF32(t.columns[c], t.n)) as [Float32Array, Float32Array, Float32Array];

/** Calorimeter cells as hexagonal prisms lying in their layer planes. */
export function cells(input: LayerInput): Layer {
  const { key, d, t, rgb } = input;
  const [x, y, z] = positions(input);
  const size = toF32(d.size ? t.columns[d.size] : undefined, t.n, 0.6);
  const base = new THREE.CylinderGeometry(1, 1, 1, 6).rotateX(Math.PI / 2);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute("position", base.getAttribute("position"));
  g.setAttribute("normal", base.getAttribute("normal"));
  const material = new THREE.ShaderMaterial({
    uniforms: baseUniforms(input.pal),
    vertexShader: /* glsl */ `
      attribute float ix, iy, iz, isize, isel, ipsel, icut, iT;
      attribute vec3 icol;
      varying vec3 vCol;
      ${GLSL}
      void main() {
        ${CULL}
        vec3 c = vec3(ix, iy, iz);
        float s = selected(ipsel, isel);
        if (uProj > 0.5) c = projectRZ(c, s * 2.0);
        float p = pop(iT), r = isize * (1.0 + 0.9 * p);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(c + position * vec3(r, r, 0.3), 1.0);
        float light = uProj > 0.5 ? 1.0 : 0.75 + 0.25 * abs(dot(normalize(normal), normalize(vec3(0.4, 0.7, 0.6))));
        vCol = mix(fade(mix(icol * light, vec3(1.0), uFlash * p), s), uBg, faded());
      }`,
    fragmentShader: `varying vec3 vCol; void main() { gl_FragColor = vec4(vCol, 1.0); }`,
  });
  const cut = cutter(t.n, input.cut, (m) => (material.uniforms.uCut.value = Math.max(m, -1e30)));
  const sel = selectionMask(t.n, g, material, true);
  for (const [name, a] of [["ix", x], ["iy", y], ["iz", z], ["isize", size], ["icut", cut.values]] as const)
    g.setAttribute(name, new THREE.InstancedBufferAttribute(a, 1));
  g.setAttribute("icol", new THREE.InstancedBufferAttribute(rgb, 3));
  g.instanceCount = t.n;
  const replay = timeline(t.n, g, material, true);
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  return {
    key, table: d.table, label: d.label, pickRadius: 8, object: mesh, x, y, z,
    passes: cut.passes, setCut: cut.setCut, setColours: (c) => replaceColours(g.getAttribute("icol") as THREE.BufferAttribute, c),
    ...sel,
    setProjection(rz) { material.uniforms.uProj.value = rz ? 1 : 0; },
    ...replay,
    setRetire(t) { material.uniforms.uRetire.value = t; },
    setFade(from, to, amount) { material.uniforms.uFade.value.set(from, to, amount); },
    dispose() { g.dispose(); base.dispose(); material.dispose(); },
  };
}

/** Objects as discs of constant pixel size with a dark rim, drawn on top of cells. Objects without emphasis
 *  (e.g. layer clusters in no trackster) are small, rimless and faded, so they stay in the background. */
export function markers(input: LayerInput): Layer {
  const { key, d, t, rgb } = input;
  const [x, y, z] = positions(input);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * t.n), 3)); // unused, required by three
  const material = new THREE.ShaderMaterial({
    uniforms: { ...baseUniforms(input.pal), uPx: { value: window.devicePixelRatio } },
    depthTest: false,
    vertexShader: /* glsl */ `
      attribute float ix, iy, iz, isel, ipsel, iemph, icut, iT, iL;
      attribute vec3 icol;
      uniform float uPx;
      varying vec3 vCol;
      varying float vRim;
      ${GLSL}
      void main() {
        ${CULL}
        vec3 c = vec3(ix, iy, iz);
        if (uProj > 0.5) c = projectRZ(c, 4.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(c, 1.0);
        bool linked = iL <= uClock; // replay: grey and small until linked
        float s = selected(ipsel, isel), chosen = selActive() * s; // 0..1 while a selection fades in or out
        float emph = linked ? iemph : 0.0, p = max(pop(iT), linked ? pop(iL) : 0.0);
        gl_PointSize = mix(emph > 0.5 ? 7.0 : 4.0, 10.0, chosen) * (1.0 + 1.2 * p) * uPx * remaining();
        vec3 col = linked ? icol : uGrey;
        col = mix(col, uBg, 0.45 * (1.0 - chosen) * (1.0 - emph)); // objects in no group are background
        vCol = fade(mix(col, vec3(1.0), uFlash * p), s);
        vRim = max(chosen, (1.0 - selActive()) * emph);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uRim;
      varying vec3 vCol;
      varying float vRim;
      void main() {
        vec2 d = gl_PointCoord * 2.0 - 1.0; float r = dot(d, d);
        if (r > 1.0) discard;
        gl_FragColor = vec4(r > 0.5 ? mix(vCol, uRim, 0.55 * vRim) : vCol, 1.0);
      }`,
  });
  const cut = cutter(t.n, input.cut, (m) => (material.uniforms.uCut.value = Math.max(m, -1e30)));
  const sel = selectionMask(t.n, g, material, false);
  for (const [name, a] of [["ix", x], ["iy", y], ["iz", z], ["icut", cut.values]] as const) g.setAttribute(name, new THREE.BufferAttribute(a, 1));
  g.setAttribute("icol", new THREE.BufferAttribute(rgb, 3));
  g.setAttribute("iemph", new THREE.BufferAttribute(input.emphasis ?? new Uint8Array(t.n).fill(1), 1, true));
  const replay = timeline(t.n, g, material, false);
  // Replay colour stages: the final colours are kept aside and restored when the replay ends.
  const final = { rgb: Float32Array.from(rgb), emphasis: Uint8Array.from(g.getAttribute("iemph").array as Uint8Array) };
  let stages: ColourStage[] = [], showing = -1;
  const showStage = (k: number) => {
    if (k === showing) return;
    showing = k;
    const c = k < 0 ? final : stages[k];
    replaceColours(g.getAttribute("icol") as THREE.BufferAttribute, c.rgb);
    const emph = g.getAttribute("iemph") as THREE.BufferAttribute;
    (emph.array as Uint8Array).set(c.emphasis ?? final.emphasis);
    emph.needsUpdate = true;
  };
  const points = new THREE.Points(g, material);
  points.frustumCulled = false;
  points.renderOrder = 2;
  return {
    key, table: d.table, label: d.label, pickRadius: 9, object: points, x, y, z,
    passes: cut.passes, setCut: cut.setCut,
    setColours(c) { final.rgb.set(c); if (showing < 0) replaceColours(g.getAttribute("icol") as THREE.BufferAttribute, c); },
    ...sel,
    setProjection(rz) { material.uniforms.uProj.value = rz ? 1 : 0; },
    ...replay,
    setClock(t) {
      replay.setClock(t);
      let k = -1; // the last stage that has started (none outside a replay)
      if (t < REPLAY_OFF) stages.forEach((s, j) => { if (s.t <= t) k = j; });
      showStage(k);
    },
    setRetire(t) { material.uniforms.uRetire.value = t; },
    setColourStages(s) { stages = s; showStage(-1); },
    dispose() { g.dispose(); material.dispose(); },
  };
}

/** Showers: translucent ellipsoids (2 sigma along each PCA axis, sigma clamped to sane sizes) plus a +-2 sigma
 *  principal-axis line. While something is selected, unrelated showers are hidden so they cannot cover it.
 *  In a replay each grows in over GROW seconds, and on a selection change unrelated ones shrink away (a CPU update
 *  per frame while either happens: a few hundred objects, buffers rewritten in place). */
export function ellipsoids(input: LayerInput): Layer {
  const { key, d, t } = input;
  let rgb = input.rgb;
  const [x, y, z] = positions(input);
  const axis = (d.axis ?? []).map((c) => toF32(t.columns[c], t.n));
  const extent = (d.extent ?? []).map((c) => toF32(t.columns[c], t.n));
  const geometry = new THREE.SphereGeometry(1, 24, 16);
  const material = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.5, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(t.n, 1));
  mesh.count = t.n;
  mesh.frustumCulled = false;
  const seg = new Float32Array(6 * t.n), segCol = new Float32Array(6 * t.n); // written in place by update()
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.BufferAttribute(seg, 3));
  lineGeometry.setAttribute("color", new THREE.BufferAttribute(segCol, 3));
  const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ vertexColors: true }));
  lines.frustumCulled = false;
  const group = new THREE.Group().add(mesh, lines);
  let rz = false, highlighted: Set<number> | null = null, previous: Set<number> | null = null, hlMix = 1;
  const shown = (set: Set<number> | null, i: number) => (set === null || set.has(i) ? 1 : 0);
  let appear: Float32Array | null = null, clock = REPLAY_OFF, settled = Infinity; // replay: all grown once clock >= settled
  let retire = REPLAY_OFF; // replay: shrink away from this time
  const GROW = 0.6, RETIRE = 0.6;
  const smooth = (a: number) => (a >= 1 ? 1 : a <= 0 ? 0 : a * a * (3 - 2 * a));
  const remaining = () => (clock >= REPLAY_OFF ? 1 : smooth(1 - (clock - retire) / RETIRE));
  const growth = (i: number) => smooth((clock - (appear?.[i] ?? 0)) / GROW) * remaining();

  const update = () => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const a = new THREE.Vector3(), zAxis = new THREE.Vector3(0, 0, 1), c = new THREE.Color();
    const project = (v: THREE.Vector3) => (rz ? v.set(v.z, Math.hypot(v.x, v.y) * (v.y >= 0 ? 1 : -1), 3) : v);
    seg.fill(0);
    for (let i = 0; i < t.n; i++) {
      a.set(axis[0]?.[i] ?? 0, axis[1]?.[i] ?? 0, axis[2]?.[i] ?? 0);
      const hasAxis = a.lengthSq() > 1e-6;
      if (hasAxis) a.normalize();
      const sigma = (k: number) => Math.min(k === 0 ? 30 : 8, Math.max(1, Math.sqrt(Math.max(extent[k]?.[i] ?? 0, 0)))); // cm
      const vis = shown(previous, i) + (shown(highlighted, i) - shown(previous, i)) * hlMix;
      const g = growth(i) * vis, hidden = !cut.passes(i) || g === 0;
      c.setRGB(rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2]);
      const centre = new THREE.Vector3(x[i], y[i], z[i]);
      const ends = [centre.clone().addScaledVector(a, 2 * g * sigma(0)), centre.clone().addScaledVector(a, -2 * g * sigma(0))];
      if (hasAxis && !hidden) ends.forEach((e, k) => { project(e); seg.set([e.x, e.y, e.z], 6 * i + 3 * k); segCol.set([c.r, c.g, c.b], 6 * i + 3 * k); });
      q.setFromUnitVectors(zAxis, hasAxis && !rz ? a : zAxis);
      s.set(...((hidden ? [0, 0, 0] : hasAxis && !rz ? [sigma(1), sigma(2), sigma(0)] : [1, 1, 1]) as [number, number, number])).multiplyScalar(2 * g);
      mesh.setMatrixAt(i, m.compose(project(p.copy(centre)), q, s));
      mesh.setColorAt(i, c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    lineGeometry.getAttribute("position").needsUpdate = true;
    lineGeometry.getAttribute("color").needsUpdate = true;
  };
  const cut = cutter(t.n, input.cut, () => update());
  update();
  return {
    key, table: d.table, label: d.label, pickRadius: 22, object: group, x, y, z,
    passes: cut.passes, setCut: cut.setCut, setColours(c) { rgb = c; update(); },
    setHighlight(rows) { previous = highlighted; highlighted = rows; hlMix = 0; update(); },
    setHighlightMix(k) { if (k !== hlMix) { hlMix = k; update(); } },
    setProjection(v) { rz = v; update(); },
    setTimeline(t) { appear = t; settled = Math.max(t.reduce((m, v) => Math.max(m, v), 0) + GROW, retire < REPLAY_OFF ? retire + RETIRE : 0); },
    setClock(t) { const was = clock; clock = t; if (appear && !(was >= settled && t >= settled)) update(); },
    setRetire(t) { retire = t; if (appear) settled = Math.max(settled, t < REPLAY_OFF ? t + RETIRE : 0); },
    dispose() { geometry.dispose(); material.dispose(); mesh.dispose(); lines.geometry.dispose(); (lines.material as THREE.Material).dispose(); },
  };
}

/** Lines from `position` to `end` (e.g. a track from its vertex to the calorimeter); in a replay each one shoots out
 *  from its start. WebGL draws them 1 pixel wide. Picked and framed by their end point. */
export function segments(input: LayerInput): Layer {
  const { key, d, t, rgb } = input;
  const start = positions(input);
  const [x, y, z] = (d.end ?? d.position).map((c) => toF32(t.columns[c], t.n)) as [Float32Array, Float32Array, Float32Array];
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3)); // x: 0 at the start, 1 at the end
  const material = new THREE.ShaderMaterial({
    uniforms: baseUniforms(input.pal),
    vertexShader: /* glsl */ `
      attribute float ix, iy, iz, jx, jy, jz, isel, ipsel, icut, iT;
      attribute vec3 icol;
      varying vec3 vCol;
      ${GLSL}
      void main() {
        ${CULL}
        float grow = uClock > 1e29 ? 1.0 : clamp((uClock - iT) / 0.5, 0.0, 1.0);
        vec3 c = mix(vec3(ix, iy, iz), vec3(jx, jy, jz), position.x * grow);
        float s = selected(ipsel, isel);
        if (uProj > 0.5) c = projectRZ(c, s * 2.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(c, 1.0);
        vCol = fade(mix(icol, vec3(1.0), uFlash * pop(iT)), s) * remaining() + uBg * (1.0 - remaining());
      }`,
    fragmentShader: `varying vec3 vCol; void main() { gl_FragColor = vec4(vCol, 1.0); }`,
  });
  const cut = cutter(t.n, input.cut, (m) => (material.uniforms.uCut.value = Math.max(m, -1e30)));
  const sel = selectionMask(t.n, g, material, true);
  for (const [name, a] of [["ix", start[0]], ["iy", start[1]], ["iz", start[2]], ["jx", x], ["jy", y], ["jz", z], ["icut", cut.values]] as const)
    g.setAttribute(name, new THREE.InstancedBufferAttribute(a, 1));
  g.setAttribute("icol", new THREE.InstancedBufferAttribute(rgb, 3));
  g.instanceCount = t.n;
  const replay = timeline(t.n, g, material, true);
  const lines = new THREE.LineSegments(g, material);
  lines.frustumCulled = false;
  lines.renderOrder = 1;
  return {
    key, table: d.table, label: d.label, pickRadius: 8, object: lines, x, y, z,
    passes: cut.passes, setCut: cut.setCut, setColours: (c) => replaceColours(g.getAttribute("icol") as THREE.BufferAttribute, c),
    ...sel,
    setProjection(rz) { material.uniforms.uProj.value = rz ? 1 : 0; },
    ...replay,
    setRetire(t) { material.uniforms.uRetire.value = t; },
    dispose() { g.dispose(); material.dispose(); },
  };
}

export const builders = { cells, markers, ellipsoids, segments } as const;
