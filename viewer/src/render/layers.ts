// Drawable layers. Each is one draw call (instanced); colours come precomputed per object. Cells, markers and
// segments do projection, cut, selection fade and replay in their shaders; showers are a few thousand objects at
// most and are updated on the CPU.
import * as THREE from "three";
import type { DisplayLayer, Table } from "../io/bundle";
import { toF32, type Pal } from "./colour";
import { REPLAY_OFF } from "./replay";

export interface Layer {
  readonly key: string;
  readonly table: string;
  readonly label: string;
  readonly pickRadius: number; // px
  readonly context?: boolean; // a background layer: left out of framing
  readonly object: THREE.Object3D;
  readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array;
  /** Objects picked along a segment rather than at a point (lines; showers along their principal axis): its ends. */
  readonly segment?: { readonly a: readonly [Float32Array, Float32Array, Float32Array]; readonly b: readonly [Float32Array, Float32Array, Float32Array] };
  /** Lines (tracks, truth particles): framing a selection keeps them whole, start to end. */
  readonly line?: boolean;
  /** Multiplies the pick distance (default 1): below 1, the layer wins over others nearby (e.g. showers over hits). */
  readonly pickBias?: number;
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
  setOutline?(on: boolean): void; // shower objects: draw as outlines (e.g. the reco objects matched to a truth particle)
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

/** What the shader-drawn layers (cells, markers, segments) share. Per object: the given float attributes, the cut
 *  value, the colour, the selection as two byte masks (previous and current, cross-faded by a uniform) and the
 *  replay times. A cut or a replay frame is one uniform; a selection change is one mask copy. */
function shaderLayer(input: LayerInput, g: THREE.BufferGeometry, material: THREE.ShaderMaterial, instanced: boolean, attributes: Record<string, Float32Array>) {
  const n = input.t.n, u = material.uniforms, Attr = instanced ? THREE.InstancedBufferAttribute : THREE.BufferAttribute;
  const cut = cutter(n, input.cut, (m) => (u.uCut.value = Math.max(m, -1e30)));
  const now = new Uint8Array(n), before = new Uint8Array(n), appear = new Float32Array(n), link = new Float32Array(n);
  for (const [name, a] of Object.entries({ ...attributes, icut: cut.values, iT: appear, iL: link })) g.setAttribute(name, new Attr(a, 1));
  g.setAttribute("icol", new Attr(input.rgb, 3));
  g.setAttribute("isel", new Attr(now, 1, true));
  g.setAttribute("ipsel", new Attr(before, 1, true));
  const changed = (...names: string[]) => names.forEach((a) => (g.getAttribute(a).needsUpdate = true));
  return {
    passes: cut.passes,
    setCut: cut.setCut,
    setColours(rgb: Float32Array) { (g.getAttribute("icol").array as Float32Array).set(rgb); changed("icol"); },
    setHighlight(rows: Set<number> | null) {
      before.set(now);
      now.fill(0);
      rows?.forEach((r) => (now[r] = 255));
      changed("isel", "ipsel");
      u.uAct0.value = u.uAct1.value;
      u.uAct1.value = rows ? 1 : 0;
      u.uMix.value = 0;
    },
    setHighlightMix(k: number) { u.uMix.value = k; },
    setProjection(rz: boolean) { u.uProj.value = rz ? 1 : 0; },
    setTimeline(a: Float32Array, l: Float32Array) { appear.set(a); link.set(l); changed("iT", "iL"); }, // in place: a new attribute would orphan its GPU buffer
    setClock(t: number) { u.uClock.value = t; },
    setRetire(t: number) { u.uRetire.value = t; },
  };
}

/** What every layer takes from its display hint. A background layer is picked over a smaller radius, so objects
 *  in front of it win. */
const identity = ({ key, d }: LayerInput, pickRadius: number) =>
  ({ key, table: d.table, label: d.label, context: d.context, pickRadius: d.context ? (3 / 8) * pickRadius : pickRadius });

const positions = ({ d, t }: LayerInput) => d.position.map((c) => toF32(t.columns[c], t.n)) as [Float32Array, Float32Array, Float32Array];

/** Calorimeter cells as hexagonal prisms lying in their layer planes. */
export function cells(input: LayerInput): Layer {
  const { d, t } = input;
  const [x, y, z] = positions(input);
  const size = toF32(d.size ? t.columns[d.size] : undefined, t.n, 0.6);
  const base = new THREE.CylinderGeometry(1, 1, 1, 6).rotateX(Math.PI / 2);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute("position", base.getAttribute("position"));
  g.setAttribute("normal", base.getAttribute("normal"));
  const material = new THREE.ShaderMaterial({
    // A background layer is thinner, so cells drawn at the same place by another layer enclose it and show.
    uniforms: { ...baseUniforms(input.pal), uThick: { value: d.context ? 0.1 : 0.3 } },
    vertexShader: /* glsl */ `
      attribute float ix, iy, iz, isize, isel, ipsel, icut, iT;
      attribute vec3 icol;
      uniform float uThick;
      varying vec3 vCol;
      ${GLSL}
      void main() {
        ${CULL}
        vec3 c = vec3(ix, iy, iz);
        float s = selected(ipsel, isel);
        if (uProj > 0.5) c = projectRZ(c, s * 2.0);
        float p = pop(iT), r = isize * (1.0 + 0.9 * p);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(c + position * vec3(r, r, uThick), 1.0);
        // Cells that overlap in one plane (e.g. partial cells at module edges) would z-fight: a tiny, fixed depth
        // offset per cell decides which is in front. 3 steps of 2e-7 in NDC stay below the depth gap between layers
        // 1 cm apart up to ~1000 cm away.
        gl_Position.z -= gl_Position.w * 2e-7 * float(gl_InstanceID % 4);
        float light = uProj > 0.5 ? 1.0 : 0.75 + 0.25 * abs(dot(normalize(normal), normalize(vec3(0.4, 0.7, 0.6))));
        vCol = mix(fade(mix(icol * light, vec3(1.0), uFlash * p), s), uBg, faded());
      }`,
    fragmentShader: `varying vec3 vCol; void main() { gl_FragColor = vec4(vCol, 1.0); }`,
  });
  const common = shaderLayer(input, g, material, true, { ix: x, iy: y, iz: z, isize: size });
  g.instanceCount = t.n;
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  if (d.context) { // drawn first and without depth, so it never hides the event in front of or behind it
    material.depthWrite = false;
    mesh.renderOrder = -1;
  }
  return {
    ...identity(input, 8), object: mesh, x, y, z,
    ...common,
    setFade(from, to, amount) { material.uniforms.uFade.value.set(from, to, amount); },
    dispose() { g.dispose(); base.dispose(); material.dispose(); },
  };
}

/** Objects as discs of constant pixel size with a dark rim, drawn on top of cells. Objects without emphasis
 *  (e.g. layer clusters in no trackster) are small, rimless and faded, so they stay in the background. */
export function markers(input: LayerInput): Layer {
  const { t } = input;
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
  const common = shaderLayer(input, g, material, false, { ix: x, iy: y, iz: z });
  const emph = new THREE.BufferAttribute(input.emphasis ?? new Uint8Array(t.n).fill(1), 1); // 0 or 1, not normalised
  g.setAttribute("iemph", emph);
  // Replay colour stages: the final colours are kept aside and restored when the replay ends.
  const final = { rgb: Float32Array.from(input.rgb), emphasis: Uint8Array.from(emph.array as Uint8Array) };
  let stages: ColourStage[] = [], showing = -1;
  const showStage = (k: number) => {
    if (k === showing) return;
    showing = k;
    const c = k < 0 ? final : stages[k];
    common.setColours(c.rgb);
    (emph.array as Uint8Array).set(c.emphasis ?? final.emphasis);
    emph.needsUpdate = true;
  };
  const points = new THREE.Points(g, material);
  points.frustumCulled = false;
  points.renderOrder = 2;
  return {
    ...identity(input, 9), object: points, x, y, z,
    ...common,
    setColours(c) { final.rgb.set(c); if (showing < 0) common.setColours(c); },
    setClock(t) {
      common.setClock(t);
      let k = -1; // the last stage that has started (none outside a replay)
      if (t < REPLAY_OFF) stages.forEach((s, j) => { if (s.t <= t) k = j; });
      showStage(k);
    },
    setColourStages(s) { stages = s; showStage(-1); },
    dispose() { g.dispose(); material.dispose(); },
  };
}

const SHOWER_STYLES = { solid: 0, shell: 1, cage: 2, core: 3 } as const;
// Instanced unit spheres scaled and rotated per shower; normals use the inverse transpose, so the shading and the
// rim follow the ellipsoid's real surface.
const SHOWER_VERTEX = /* glsl */ `
  varying vec3 vN, vV, vP, vCol;
  void main() {
    mat4 mv = modelViewMatrix * instanceMatrix;
    vec4 p = mv * vec4(position, 1.0);
    vN = normalize(transpose(inverse(mat3(mv))) * normal);
    vV = normalize(-p.xyz);
    vP = position;
    #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
    #else
    vCol = vec3(0.6);
    #endif
    gl_Position = projectionMatrix * p;
  }`;
// Surfaces: solid (tracksters): translucent, softly shaded, a light rim; shell (linked tracksters): clear inside,
// bright outline; cage (interpretations): three rings around the principal axes; core (candidates): opaque, glossy.
const SHOWER_FRAGMENT = /* glsl */ `
  uniform float uStyle;
  varying vec3 vN, vV, vP, vCol;
  void main() {
    vec3 n = normalize(vN), v = normalize(vV);
    if (!gl_FrontFacing) n = -n;
    float facing = abs(dot(n, v)), rim = 1.0 - facing;
    vec3 l = normalize(vec3(0.35, 0.65, 0.7));
    float diffuse = 0.55 + 0.45 * max(dot(n, l), 0.0);
    vec3 col; float a;
    if (uStyle < 0.5) { col = vCol * diffuse + 0.18 * pow(rim, 2.0); a = 0.22 + 0.5 * pow(rim, 2.5); }
    else if (uStyle < 1.5) { col = mix(vCol, vec3(1.0), 0.15); a = 0.03 + 0.85 * pow(rim, 4.0); }
    else if (uStyle < 2.5) {
      vec3 w = 1.5 * fwidth(vP); // rings about 1.5 pixels wide on screen, whatever the ellipsoid's size
      vec3 r = 1.0 - smoothstep(0.5 * w, w, abs(vP));
      float ring = max(max(r.x, r.y), r.z);
      col = mix(vCol, vec3(1.0), 0.1 * ring); a = 0.04 + 0.8 * ring + 0.15 * pow(rim, 3.0);
    } else {
      float spec = pow(max(dot(reflect(-l, n), v), 0.0), 28.0);
      col = vCol * (0.35 + 0.75 * diffuse) + 0.45 * spec + 0.12 * pow(rim, 3.0); a = 1.0;
    }
    gl_FragColor = vec4(col, a);
  }`;

/** Showers: translucent ellipsoids (2 sigma along each PCA axis, sigma clamped to sane sizes) plus a +-2 sigma
 *  principal-axis line; each `shape` has its own surface (SHOWER_FRAGMENT), so reconstruction stages are told apart
 *  at a glance. While something is selected, unrelated showers shrink away so they cannot cover it; in a replay each
 *  grows in over GROW seconds. Both are CPU updates per frame while they run (buffers rewritten in place). */
export function ellipsoids(input: LayerInput): Layer {
  const { d, t } = input;
  let rgb = input.rgb;
  const [x, y, z] = positions(input);
  const axis = (d.axis ?? []).map((c) => toF32(t.columns[c], t.n));
  const extent = (d.extent ?? []).map((c) => toF32(t.columns[c], t.n));
  const shape = d.shape ?? "solid", style = SHOWER_STYLES[shape];
  const geometry = new THREE.SphereGeometry(1, 40, 24);
  const material = new THREE.ShaderMaterial({
    vertexShader: SHOWER_VERTEX, fragmentShader: SHOWER_FRAGMENT, uniforms: { uStyle: { value: style } },
    transparent: shape !== "core", depthWrite: shape === "core", side: shape === "shell" || shape === "cage" ? THREE.DoubleSide : THREE.FrontSide,
  });
  const core = shape === "core" ? 0.55 : 1; // a candidate is a compact core inside the shower it stands for
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(t.n, 1));
  mesh.count = t.n;
  mesh.frustumCulled = false;
  const seg = new Float32Array(6 * t.n), segCol = new Float32Array(6 * t.n); // axis lines, written in place by update()
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.BufferAttribute(seg, 3));
  lineGeometry.setAttribute("color", new THREE.BufferAttribute(segCol, 3));
  const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ vertexColors: true }));
  lines.frustumCulled = false;
  const group = new THREE.Group().add(mesh, lines);
  const drawAxis = shape === "solid" || shape === "core"; // shells and cages stay uncluttered
  const pickA = [new Float32Array(t.n), new Float32Array(t.n), new Float32Array(t.n)] as const;
  const pickB = [new Float32Array(t.n), new Float32Array(t.n), new Float32Array(t.n)] as const;
  let rz = false, highlighted: Set<number> | null = null, previous: Set<number> | null = null, hlMix = 1;
  const shown = (set: Set<number> | null, i: number) => (set === null || set.has(i) ? 1 : 0);
  let appear: Float32Array | null = null, clock = REPLAY_OFF, settled = Infinity; // replay: all grown once clock >= settled
  let retire = REPLAY_OFF; // replay: shrink away from this time
  const GROW = 0.6, RETIRE = 0.6;
  const smooth = (a: number) => (a >= 1 ? 1 : a <= 0 ? 0 : a * a * (3 - 2 * a));
  const remaining = () => (clock >= REPLAY_OFF ? 1 : smooth(1 - (clock - retire) / RETIRE));
  const growth = (i: number) => smooth((clock - (appear?.[i] ?? 0)) / GROW) * remaining();
  const sigma = (k: number, i: number) => Math.min(k === 0 ? 30 : 8, Math.max(1, Math.sqrt(Math.max(extent[k]?.[i] ?? 0, 0)))); // cm

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const a = new THREE.Vector3(), zAxis = new THREE.Vector3(0, 0, 1), c = new THREE.Color();
  const project = (v: THREE.Vector3) => (rz ? v.set(v.z, Math.hypot(v.x, v.y) * (v.y >= 0 ? 1 : -1), 3) : v);
  const update = () => {
    seg.fill(0);
    for (let i = 0; i < t.n; i++) {
      a.set(axis[0]?.[i] ?? 0, axis[1]?.[i] ?? 0, axis[2]?.[i] ?? 0);
      const hasAxis = a.lengthSq() > 1e-6;
      if (hasAxis) a.normalize();
      const vis = shown(previous, i) + (shown(highlighted, i) - shown(previous, i)) * hlMix;
      const g = growth(i) * vis, hidden = !cut.passes(i) || g === 0, half = 2 * g * sigma(0, i);
      for (let e = 0; e < 2; e++) { // the axis' ends: picked along it, and drawn
        const end = e ? pickB : pickA;
        p.set(x[i], y[i], z[i]).addScaledVector(a, e ? -half : half);
        end[0][i] = p.x; end[1][i] = p.y; end[2][i] = p.z;
        if (!hasAxis || hidden || !drawAxis) continue;
        project(p);
        const o = 6 * i + 3 * e;
        seg[o] = p.x; seg[o + 1] = p.y; seg[o + 2] = p.z;
        segCol[o] = rgb[3 * i]; segCol[o + 1] = rgb[3 * i + 1]; segCol[o + 2] = rgb[3 * i + 2];
      }
      q.setFromUnitVectors(zAxis, hasAxis && !rz ? a : zAxis);
      if (hidden) s.set(0, 0, 0);
      else if (hasAxis && !rz) s.set(sigma(1, i), sigma(2, i), sigma(0, i));
      else s.set(1, 1, 1);
      mesh.setMatrixAt(i, m.compose(project(p.set(x[i], y[i], z[i])), q, s.multiplyScalar(2 * g * core)));
      mesh.setColorAt(i, c.setRGB(rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2]));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    lineGeometry.getAttribute("position").needsUpdate = true;
    lineGeometry.getAttribute("color").needsUpdate = true;
  };
  const cut = cutter(t.n, input.cut, () => update());
  update();
  return {
    // Picked anywhere along the principal axis (the drawn length), and preferred over hits and clusters nearby.
    ...identity(input, 14), object: group, x, y, z, segment: { a: pickA, b: pickB }, pickBias: shape === "core" ? 0.3 : 0.45,
    passes: (i) => cut.passes(i) && shown(highlighted, i) === 1, // showers hidden by a selection cannot be picked
    setCut: cut.setCut, setColours(c) { rgb = c; update(); },
    setOutline(on) { material.uniforms.uStyle.value = on ? SHOWER_STYLES.shell : style; material.side = on ? THREE.DoubleSide : material.side; },
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
  const { d, t } = input;
  const start = positions(input);
  const [x, y, z] = (d.end ?? d.position).map((c) => toF32(t.columns[c], t.n)) as [Float32Array, Float32Array, Float32Array];
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3)); // x: 0 at the start, 1 at the end
  const material = new THREE.ShaderMaterial({
    uniforms: { ...baseUniforms(input.pal), uDash: { value: d.truth ? 1 : 0 } },
    vertexShader: /* glsl */ `
      attribute float ix, iy, iz, jx, jy, jz, isel, ipsel, icut, iT;
      attribute vec3 icol;
      varying vec3 vCol;
      varying float vS; // distance along the line [cm], for dashes
      ${GLSL}
      void main() {
        ${CULL}
        float grow = uClock > 1e29 ? 1.0 : clamp((uClock - iT) / 0.5, 0.0, 1.0);
        vec3 c = mix(vec3(ix, iy, iz), vec3(jx, jy, jz), position.x * grow);
        vS = position.x * grow * length(vec3(jx, jy, jz) - vec3(ix, iy, iz));
        float s = selected(ipsel, isel);
        if (uProj > 0.5) c = projectRZ(c, s * 2.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(c, 1.0);
        vCol = fade(mix(icol, vec3(1.0), uFlash * pop(iT)), s) * remaining() + uBg * (1.0 - remaining());
      }`,
    // Simulation truth is dashed (4 cm on, 3 cm off), so it never looks like a reconstructed track.
    fragmentShader: `uniform float uDash; uniform vec3 uBg; varying vec3 vCol; varying float vS;
      void main() {
        if (uDash > 0.5 && mod(vS, 7.0) > 4.0) discard;
        gl_FragColor = vec4(uDash > 0.5 ? mix(vCol, uBg, 0.35) : vCol, 1.0); // truth dimmer than reconstructed tracks
      }`,
  });
  const common = shaderLayer(input, g, material, true, { ix: start[0], iy: start[1], iz: start[2], jx: x, jy: y, jz: z });
  g.instanceCount = t.n;
  const lines = new THREE.LineSegments(g, material);
  lines.frustumCulled = false;
  lines.renderOrder = 1;
  return {
    ...identity(input, 8), object: lines, x, y, z, segment: { a: start, b: [x, y, z] }, pickBias: 0.8, line: true,
    ...common,
    dispose() { g.dispose(); material.dispose(); },
  };
}

export const builders = { cells, markers, ellipsoids, segments } as const;
