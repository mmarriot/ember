// Drawable layers. Each is one draw call (instanced); colours come precomputed per object. Cells, markers and
// segments do projection, cut, selection fade and replay in their shaders; showers are a few thousand objects at
// most and are updated on the CPU.
import * as THREE from "three";
import type { DisplayLayer, PerRow, Table, ViewName } from "../io/bundle";
import { position, toF32, type Pal, valueRange } from "./colour";
import { endsOrCylinder, etaPhiDirection, isToCylinder, perRow, toCylinder, towerPoint } from "./geometry";
import { type Field, helixPaths, type Paths, polylines } from "./helix";
import { HIDDEN } from "../model/cuts";
import { REPLAY_OFF } from "./replay";

export interface Layer {
  readonly key: string;
  readonly table: string;
  readonly label: string;
  readonly pickRadius: number; // px
  readonly context?: boolean; // a background layer: left out of framing
  readonly views?: readonly ViewName[]; // the views that draw it (none: all)
  readonly object: THREE.Object3D;
  readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array;
  /** Objects picked along a segment rather than at a point (lines; showers along their principal axis): its ends. */
  readonly segment?: { readonly a: readonly [Float32Array, Float32Array, Float32Array]; readonly b: readonly [Float32Array, Float32Array, Float32Array] };
  /** Curved lines (helices): each object's path as `points` points, object i at [i * points, (i + 1) * points), picked
   *  along it and framed whole. */
  readonly path?: { readonly points: number; readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array; fill(i: number): void };
  /** Lines (tracks, truth particles): framing a selection keeps them whole, start to end. */
  readonly line?: boolean;
  /** Multiplies the pick distance (default 1): below 1, the layer wins over others nearby (e.g. showers over hits). */
  readonly pickBias?: number;
  passes(i: number): boolean; // survives the current cut
  setCut(min: number): number; // returns the number of objects shown
  setPinned(row: number): void; // an object drawn whatever the cut (the selected one); -1: none
  setColours(rgb: Float32Array): void;
  setHighlight(rows: Set<number> | null): void; // the new selection; setHighlightMix fades from the previous one
  setHighlightMix(k: number): void; // 0: as before the last setHighlight, 1: as after
  setProjection(rz: boolean): void;
  setTimeline(appear: Float32Array, link: Float32Array): void; // replay: when each object appears / joins its group, or for a path being built is complete (s)
  setClock(t: number): void; // replay time in s; REPLAY_OFF shows the final state
  setRetire(t: number): void; // replay: when the layer gives way to the next reconstruction stage (s); REPLAY_OFF: never
  setFade?(from: number, to: number, amount: number): void; // replay: fade towards the background between these times
  /** Shower objects: draw as outlines (e.g. the reco objects matched to a truth particle); `envelope`: as a
   *  full-size outline, also for compact cores (the focus around the level shown inside it). */
  setOutline?(on: boolean, envelope?: boolean): void;
  dispose(): void;
}
export interface LayerInput { key: string; d: DisplayLayer; t: Table; pal: Pal; rgb: Float32Array; emphasis?: Uint8Array; cut?: Float32Array; field?: Field }

const GLSL = /* glsl */ `
uniform float uProj, uAct0, uAct1, uMix, uCut, uClock, uFlash, uRetire, uPin0, uPin1;
uniform vec3 uBg, uRim, uGrey, uFade;
vec3 projectRZ(vec3 c, float depth) { return vec3(c.z, length(c.xy) * (c.y >= 0.0 ? 1.0 : -1.0), depth); }
// A line keeps one side of the axis (the side of its end, \`side\`), so a line crossing y = 0 does not jump across it.
vec3 projectRZ(vec3 c, float depth, float side) { return vec3(c.z, length(c.xy) * side, depth); }
// Selection, cross-faded between the previous and the current one: selActive = something selected, s = this one is.
float selActive() { return mix(uAct0, uAct1, uMix); }
float selected(float before, float now) { return mix(before, now, uMix); }
vec3 fade(vec3 col, float s) { return mix(col, uBg, 0.85 * selActive() * (1.0 - s)); }
float pop(float t) { return exp(-max(uClock - t, 0.0) * 6.0); } // 1 when an object appears, then decays in ~0.3 s
// 1 until the layer retires in a replay, then down to 0 over 0.6 s (always 1 outside a replay).
float remaining() { return uClock > 1e29 ? 1.0 : clamp(1.0 - (uClock - uRetire) / 0.6, 0.0, 1.0); }
// Replay: how far the layer has faded towards the background (uFade: from, to, amount; none outside a replay).
float faded() { return uClock > 1e29 ? 0.0 : uFade.z * smoothstep(uFade.x, uFade.y, uClock); }`;
// Instances (markers: vertices) uPin0 <= id < uPin1 are the pinned object's: drawn whatever the cut.
const CULL = (id = "gl_InstanceID") => `float pinned = float(${id}) >= uPin0 && float(${id}) < uPin1 ? 1.0 : 0.0;
  if ((icut < uCut && pinned < 0.5) || iT > uClock || remaining() <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }`;
// Colours go to the shaders as raw sRGB values, like the per-object colours (no linear conversion).
const raw = (c: number | string) => (typeof c === "number" ? new THREE.Color().setHex(c, THREE.LinearSRGBColorSpace) : new THREE.Color().setStyle(c, THREE.LinearSRGBColorSpace));
const baseUniforms = (pal: Pal) => ({
  uProj: { value: 0 }, uPin0: { value: -1 }, uPin1: { value: -1 }, uAct0: { value: 0 }, uAct1: { value: 0 }, uMix: { value: 1 }, uCut: { value: -1e30 }, uClock: { value: REPLAY_OFF }, uRetire: { value: REPLAY_OFF }, uFade: { value: new THREE.Vector3(0, 1, 0) }, uFlash: { value: pal.flash },
  uBg: { value: raw(pal.background) }, uRim: { value: new THREE.Color(...pal.rim) }, uGrey: { value: raw(pal.unassigned) },
});

/** Cut bookkeeping shared by all layer kinds. A pinned object (the selected one) passes whatever the cut. */
function cutter(n: number, values: Float32Array | undefined, onChange: (min: number) => void) {
  let min = -Infinity, pinned = -1;
  const passes = (i: number) => !values || i === pinned || values[i] >= min;
  return {
    values: values ?? new Float32Array(n),
    passes,
    pin(row: number) { pinned = row; },
    setCut(m: number) {
      min = values ? m : -Infinity;
      onChange(min);
      if (!values) return n;
      let shown = 0;
      for (let i = 0; i < n; i++) if (passes(i)) shown++;
      return shown;
    },
  };
}

/** What the shader-drawn layers (cells, markers, segments, helices) share. Per object: the given float attributes (`vec3`:
 *  three floats each), the cut value, the colour, the selection as two byte masks (previous and current, cross-faded
 *  by a uniform) and the replay times. A cut or a replay frame is one uniform; a selection change is one mask copy.
 *  Layers whose cut values hide rows for good (a filter, or a layer that shows only the selection's objects) get
 *  instances (markers: points) for the other rows only: each runs the vertex shader every frame, even when its object
 *  is hidden (100k truth helices of 48 points each are 5M vertices), and a layer rebuilt on every click (the hits of the
 *  selection's tracks) then uploads only the selection's rows. `pieces` (instanced): instances per row, for a row
 *  drawn in several pieces (a helix of many turns), each with its piece number in the attribute `ipiece` and the
 *  row's count in `ipieces`. */
function shaderLayer(input: LayerInput, g: THREE.BufferGeometry, material: THREE.ShaderMaterial, instanced: boolean,
  attributes: Record<string, Float32Array>, vec3: Record<string, Float32Array> = {}, pieces?: Uint16Array) {
  const n = input.t.n, u = material.uniforms, Attr = instanced ? THREE.InstancedBufferAttribute : THREE.BufferAttribute;
  const cut = cutter(n, input.cut, (m) => (u.uCut.value = Math.max(m, -1e30)));
  // The row of each instance, if not one instance per row; `slot`: each row's first instance, -1 for none.
  let rows: Uint32Array | null = null, slot: Int32Array | null = null, piece: Float32Array | null = null;
  const kept: number[] = [];
  if (input.cut) for (let i = 0; i < n; i++) if (input.cut[i] > HIDDEN) kept.push(i);
  if ((input.cut && kept.length < n) || pieces?.some((c) => c > 1)) {
    const use = input.cut ? kept : Array.from({ length: n }, (_, i) => i), count = (r: number) => (pieces ? pieces[r] : 1);
    rows = new Uint32Array(use.reduce((s, r) => s + count(r), 0));
    slot = new Int32Array(n).fill(-1);
    if (pieces) piece = new Float32Array(rows.length);
    let k = 0;
    for (const r of use) {
      slot[r] = k;
      for (let j = 0; j < count(r); j++, k++) { rows[k] = r; if (piece) piece[k] = j; }
    }
  }
  const m = rows ? rows.length : n;
  const pick = <T extends Float32Array | Uint8Array>(a: T, size = 1): T => {
    if (!rows) return a;
    const out = new (a.constructor as new (n: number) => T)(size * rows.length);
    for (let k = 0; k < rows.length; k++) for (let c = 0; c < size; c++) out[size * k + c] = a[size * rows[k] + c];
    return out;
  };
  const now = new Uint8Array(m), before = new Uint8Array(m), appear = new Float32Array(m), link = new Float32Array(m);
  for (const [name, a] of Object.entries({ ...attributes, icut: cut.values, ...(pieces ? { ipieces: Float32Array.from(pieces) } : {}) }))
    g.setAttribute(name, new Attr(pick(a), 1));
  if (pieces) g.setAttribute("ipiece", new Attr(piece ?? new Float32Array(m), 1));
  for (const [name, a] of Object.entries({ iT: appear, iL: link })) g.setAttribute(name, new Attr(a, 1));
  for (const [name, a] of Object.entries(vec3)) g.setAttribute(name, new Attr(pick(a, 3), 3));
  g.setAttribute("icol", new Attr(pick(input.rgb, 3), 3));
  g.setAttribute("isel", new Attr(now, 1, true));
  g.setAttribute("ipsel", new Attr(before, 1, true));
  if (instanced) (g as THREE.InstancedBufferGeometry).instanceCount = m;
  const changed = (...names: string[]) => names.forEach((a) => (g.getAttribute(a).needsUpdate = true));
  return {
    pick,
    passes: cut.passes,
    setCut: cut.setCut,
    setPinned(row: number) { // its instances: from its slot, as long as they are its own
      cut.pin(row);
      let k = row < 0 ? -1 : slot ? slot[row] : row, end = k;
      if (k >= 0) while (end < m && (rows ? rows[end] === row : end === row)) end++;
      u.uPin0.value = k; u.uPin1.value = end;
    },
    setColours(rgb: Float32Array) { (g.getAttribute("icol").array as Float32Array).set(pick(rgb, 3)); changed("icol"); },
    setHighlight(sel: Set<number> | null) {
      before.set(now);
      now.fill(0);
      sel?.forEach((r) => { for (let k = slot ? slot[r] : r; k >= 0 && k < m && (rows ? rows[k] === r : k === r); k++) now[k] = 255; });
      changed("isel", "ipsel");
      u.uAct0.value = u.uAct1.value;
      u.uAct1.value = sel ? 1 : 0;
      u.uMix.value = 0;
    },
    setHighlightMix(k: number) { u.uMix.value = k; },
    setProjection(rz: boolean) { u.uProj.value = rz ? 1 : 0; },
    setTimeline(a: Float32Array, l: Float32Array) { appear.set(pick(a)); link.set(pick(l)); changed("iT", "iL"); }, // in place: a new attribute would orphan its GPU buffer
    setClock(t: number) { u.uClock.value = t; },
    setRetire(t: number) { u.uRetire.value = t; },
  };
}

/** What every layer takes from its display hint. A background layer is picked over a smaller radius, so objects
 *  in front of it win. */
const identity = ({ key, d }: LayerInput, pickRadius: number) =>
  ({ key, table: d.table, label: d.label, context: d.context, views: d.views, pickRadius: d.context ? (3 / 8) * pickRadius : pickRadius });

const positions = ({ d, t }: LayerInput) => d.position.map((c) => toF32(t.columns[c], t.n)) as [Float32Array, Float32Array, Float32Array];

/** Calorimeter cells as hexagonal prisms lying in their layer planes. */
export function cells(input: LayerInput): Layer {
  const { d, t } = input;
  if (d.cell?.shape === "tower") return towers(input);
  if (d.cell?.shape === "box") return boxes(input);
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
        ${CULL()}
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

/** A cells layer drawn as instanced solids of another shape (towers, boxes): `base` is a unit box whose corners the
 *  vertex shader `body` places (it sets `c`, the point, and `nrm`, the normal, from the instance's attributes; uniform
 *  `uDisc` from `disc`). Lighting, selection fade, replay pop and the background (context) mode are as for hexagons. */
function solidCells(input: LayerInput, declarations: string, body: string, attributes: Record<string, Float32Array>,
  vec3: Record<string, Float32Array>, disc = false) {
  const { d } = input, base = new THREE.BoxGeometry(1, 1, 1), g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute("position", base.getAttribute("position"));
  g.setAttribute("normal", base.getAttribute("normal"));
  const material = new THREE.ShaderMaterial({
    uniforms: { ...baseUniforms(input.pal), uDisc: { value: disc ? 1 : 0 } },
    vertexShader: /* glsl */ `
      attribute float isel, ipsel, icut, iT;
      attribute vec3 icol;
      ${declarations}
      uniform float uDisc;
      varying vec3 vCol;
      ${GLSL}
      void main() {
        ${CULL()}
        float s = selected(ipsel, isel), p = pop(iT), k = 1.0 + 0.9 * p; // k: grows as it appears in a replay
        vec3 c, nrm;
        ${body}
        if (uProj > 0.5) c = projectRZ(c, s * 2.0, ipos.y >= 0.0 ? 1.0 : -1.0); // one side of the axis per object
        gl_Position = projectionMatrix * modelViewMatrix * vec4(c, 1.0);
        float light = uProj > 0.5 ? 1.0 : 0.7 + 0.3 * abs(dot(normalize(nrm), normalize(vec3(0.4, 0.7, 0.6))));
        vCol = mix(fade(mix(icol * light, vec3(1.0), uFlash * p), s), uBg, faded());
      }`,
    fragmentShader: `varying vec3 vCol; void main() { gl_FragColor = vec4(vCol, 1.0); }`,
  });
  const common = shaderLayer(input, g, material, true, attributes, vec3);
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  if (d.context) { // as hexagons: drawn first and without depth, so it never hides the event
    material.depthWrite = false;
    mesh.renderOrder = -1;
  }
  return {
    object: mesh, ...common,
    setFade(from: number, to: number, amount: number) { material.uniforms.uFade.value.set(from, to, amount); },
    dispose() { g.dispose(); base.dispose(); material.dispose(); },
  };
}

/** Calorimeter cells as eta-phi towers seen from the origin (`cell.shape: "tower"`): the bin [eta +- dEta/2] x
 *  [phi +- dPhi/2] of the cell whose front-face centre is `position`, from that face (a cylinder rho = const, or a
 *  `disc` |z| = const) outwards by `depth` cm, e.g. a crystal's length or its energy. The vertex shader builds the
 *  corners (geometry.ts towerPoint is its CPU twin): 6 floats per cell besides the common ones, no geometry on the
 *  CPU. Picked along the axis, front to back. */
function towers(input: LayerInput): Layer {
  const { d, t } = input, n = t.n, cell = d.cell as Extract<NonNullable<DisplayLayer["cell"]>, { shape: "tower" }>, disc = cell.face === "disc";
  const [x, y, z] = positions(input);
  const dEta = perRow(t.columns, n, cell.dEta, 0.087), dPhi = perRow(t.columns, n, cell.dPhi, 0.087), depth = perRow(t.columns, n, cell.depth, 10);
  for (let i = 0; i < n; i++) depth[i] = Math.max(depth[i], MIN_DEPTH); // never flat: a cell seen edge-on stays visible
  const back = [new Float32Array(n), new Float32Array(n), new Float32Array(n)] as const;
  for (let i = 0; i < n; i++) {
    const b = towerPoint(x[i], y[i], z[i], dEta[i], dPhi[i], depth[i], disc, 0, 0, 1);
    back[0][i] = b[0]; back[1][i] = b[1]; back[2][i] = b[2];
  }
  const solid = solidCells(input, "attribute vec3 ipos, ibin; // ibin: dEta, dPhi, depth (cm)", /* glsl */ `
        float rho0 = length(ipos.xy), w = position.z + 0.5;
        float eta = asinh(ipos.z / rho0) + position.x * ibin.x * k, phi = atan(ipos.y, ipos.x) + position.y * ibin.y * k;
        vec3 er = vec3(cos(phi), sin(phi), 0.0), ep = vec3(-er.y, er.x, 0.0), ee, ed;
        if (uDisc < 0.5) { float r = rho0 + w * ibin.z; c = vec3(r * er.xy, r * sinh(eta)); ee = vec3(0.0, 0.0, 1.0); ed = er; }
        else { float zz = ipos.z + sign(ipos.z) * w * ibin.z; c = vec3(abs(zz) / sinh(abs(eta)) * er.xy, zz); ee = -sign(ipos.z) * er; ed = vec3(0.0, 0.0, sign(ipos.z)); }
        nrm = normal.x * ee + normal.y * ep + normal.z * ed;`,
    {}, { ipos: interleave([x, y, z]), ibin: interleave([dEta, dPhi, depth]) }, disc);
  return { ...identity(input, 8), x, y, z, segment: { a: [x, y, z], b: back }, ...solid };
}
const MIN_DEPTH = 0.3; // cm, as the hexagons' thickness

/** Oriented boxes or trapezoids (`cell.shape: "box"`), e.g. muon chambers: centre `position`, unit axes `u` (width)
 *  and `v` (length) as columns, `size` [half width at -v, half width at +v, half length, half thickness] (geometry.ts
 *  boxPoint is the CPU twin). Picked at the centre. */
function boxes(input: LayerInput): Layer {
  const { d, t } = input, n = t.n, cell = d.cell as Extract<NonNullable<DisplayLayer["cell"]>, { shape: "box" }>;
  const [x, y, z] = positions(input), cols = (c: readonly string[]) => c.map((k) => toF32(t.columns[k], n)) as [Float32Array, Float32Array, Float32Array];
  const size = cell.size.map((v: PerRow) => perRow(t.columns, n, v, 1));
  const solid = solidCells(input, "attribute vec3 ipos, iu, iv, isize; attribute float ithick; // isize: half widths at -v, +v, half length", /* glsl */ `
        vec3 nv = normalize(cross(iu, iv));
        float hw = mix(isize.x, isize.y, position.y + 0.5); // ("half" is reserved in GLSL)
        c = ipos + 2.0 * k * (position.x * hw * iu + position.y * isize.z * iv) + 2.0 * position.z * ithick * nv;
        nrm = normal.x * iu + normal.y * iv + normal.z * nv;`,
    { ithick: size[3] }, { ipos: interleave([x, y, z]), iu: interleave(cols(cell.u)), iv: interleave(cols(cell.v)), isize: interleave([size[0], size[1], size[2]]) });
  return { ...identity(input, 8), x, y, z, ...solid };
}

/** Objects as discs of constant pixel size with a dark rim, drawn on top of cells. Objects without emphasis
 *  (e.g. layer clusters in no trackster) are small, rimless and faded, so they stay in the background. With a `size`
 *  column, larger values give larger discs (5 to 14 px over the bulk of the values, as the colour scale), e.g. the
 *  primary vertex (largest sum of pT^2) stands out among the pile-up vertices. */
export function markers(input: LayerInput): Layer {
  const { d, t } = input;
  const [x, y, z] = positions(input);
  const sizeCol = d.size ? t.columns[d.size] : undefined, sized = new Float32Array(t.n);
  if (sizeCol) {
    const v = toF32(sizeCol, t.n), r = valueRange(v);
    for (let i = 0; i < t.n; i++) { const p = position(r, v[i]); sized[i] = p > 0 ? (p < 1 ? p : 1) : 0; } // NaN -> 0
  }
  const g = new THREE.BufferGeometry();
  const material = new THREE.ShaderMaterial({
    uniforms: { ...baseUniforms(input.pal), uPx: { value: window.devicePixelRatio }, uSized: { value: sizeCol ? 1 : 0 } },
    depthTest: false,
    vertexShader: /* glsl */ `
      attribute float ix, iy, iz, isel, ipsel, iemph, icut, iT, iL, isize;
      attribute vec3 icol;
      uniform float uPx, uSized;
      varying vec3 vCol;
      varying float vRim;
      ${GLSL}
      void main() {
        ${CULL("gl_VertexID")}
        vec3 c = vec3(ix, iy, iz);
        if (uProj > 0.5) c = projectRZ(c, 4.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(c, 1.0);
        bool linked = iL <= uClock; // replay: grey and small until linked
        float s = selected(ipsel, isel), chosen = selActive() * s; // 0..1 while a selection fades in or out
        float emph = linked ? iemph : 0.0, p = max(pop(iT), linked ? pop(iL) : 0.0);
        float big = uSized > 0.5 ? mix(5.0, 14.0, isize) : 7.0;
        gl_PointSize = mix(emph > 0.5 ? big : 4.0, max(10.0, big), chosen) * (1.0 + 1.2 * p) * uPx * remaining();
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
  const { pick, ...common } = shaderLayer(input, g, material, false, { ix: x, iy: y, iz: z, isize: sized });
  // three draws as many points as `position` has entries; the shader does not read it, so it shares ix's buffer.
  g.setAttribute("position", g.getAttribute("ix"));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity); // not computed from it (three's depth sort asks)
  const emph = new THREE.BufferAttribute(pick(input.emphasis ?? new Uint8Array(t.n).fill(1)), 1); // 0 or 1, not normalised
  g.setAttribute("iemph", emph);
  const points = new THREE.Points(g, material);
  points.frustumCulled = false;
  points.renderOrder = 2;
  return {
    ...identity(input, 9), object: points, x, y, z,
    ...common,
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
  let core = shape === "core" ? 0.55 : 1; // a candidate is a compact core inside the shower it stands for
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
  let rz = false, highlighted: Set<number> | null = null, previous: Set<number> | null = null, hlMix = 1, enveloped = false;
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
    setPinned(row) { cut.pin(row); update(); },
    setOutline(on, envelope = false) {
      material.uniforms.uStyle.value = on || envelope ? SHOWER_STYLES.shell : style;
      material.side = on || envelope ? THREE.DoubleSide : material.side;
      if (envelope === enveloped) return;
      // An envelope is see-through and full size; without one, the shape's own settings come back.
      enveloped = envelope;
      material.transparent = envelope || shape !== "core";
      material.depthWrite = !envelope && shape === "core";
      if (!envelope && !on) material.side = shape === "shell" || shape === "cage" ? THREE.DoubleSide : THREE.FrontSide;
      material.needsUpdate = true; // transparency and depth writes are compiled into the shader program's state
      core = envelope || shape !== "core" ? 1 : 0.55;
      update();
    },
    setHighlight(rows) { previous = highlighted; highlighted = rows; hlMix = 0; update(); },
    setHighlightMix(k) { if (k !== hlMix) { hlMix = k; update(); } },
    setProjection(v) { rz = v; update(); },
    setTimeline(t) { appear = t; settled = Math.max(t.reduce((m, v) => Math.max(m, v), 0) + GROW, retire < REPLAY_OFF ? retire + RETIRE : 0); },
    setClock(t) { const was = clock; clock = t; if (appear && !(was >= settled && t >= settled)) update(); },
    setRetire(t) { retire = t; if (appear) settled = Math.max(settled, t < REPLAY_OFF ? t + RETIRE : 0); },
    dispose() { geometry.dispose(); material.dispose(); mesh.dispose(); lines.geometry.dispose(); (lines.material as THREE.Material).dispose(); },
  };
}

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
      ${GLSL}
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
    // Simulation truth is dashed (4 cm on, 3 cm off), so it never looks like a reconstructed track.
    fragmentShader: `uniform float uDash; uniform vec3 uBg; varying vec3 vCol; varying float vS;
      void main() {
        if (uDash > 0.5 && mod(vS, 7.0) > 4.0) discard;
        gl_FragColor = vec4(uDash > 0.5 ? mix(vCol, uBg, 0.35) : vCol, 1.0); // truth dimmer than reconstructed tracks
      }`,
  });
  const common = shaderLayer(input, g, material, true, { ix: start[0], iy: start[1], iz: start[2], jx: x, jy: y, jz: z });
  const lines = new THREE.LineSegments(g, material);
  lines.frustumCulled = false;
  lines.renderOrder = 1;
  return {
    ...identity(input, 8), object: lines, x, y, z, segment: { a: start, b: [x, y, z] }, pickBias: 0.8, line: true,
    ...common,
    dispose() { g.dispose(); material.dispose(); },
  };
}

type Vec3s = [Float32Array, Float32Array, Float32Array];
/** A segments layer's start and end points: `position` to `end`, or along `direction` for `length` cm (from
 *  `position`, or `centred` on it). */
export function segmentEnds(d: DisplayLayer, t: Table, position: Vec3s): [Vec3s, Vec3s] {
  if (!d.direction) return [position, (d.end ?? d.position).map((c) => toF32(t.columns[c], t.n)) as Vec3s];
  const n = t.n, dir = d.direction.map((c) => toF32(t.columns[c], n)), len = perRow(t.columns, n, isToCylinder(d.length) ? undefined : d.length, 100);
  const a: Vec3s = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], b: Vec3s = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const m = Math.hypot(dir[0][i], dir[1][i], dir[2][i]) || 1, back = d.centred ? 0.5 * len[i] : 0, ahead = len[i] - back;
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
  const { d, t } = input, n = t.n, [x, y, z] = end;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], 3)); // x: along, y: across
  g.setIndex([0, 2, 1, 2, 3, 1]);
  const px = globalThis.devicePixelRatio ?? 1;
  const material = new THREE.ShaderMaterial({
    uniforms: { ...baseUniforms(input.pal), uWidth: { value: (d.width ?? 2) * px }, uRes: { value: new THREE.Vector2(1, 1) }, uDash: { value: d.truth ? 1 : 0 } },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float isel, ipsel, icut, iT;
      attribute vec3 icol, istart, iend;
      uniform float uWidth;
      uniform vec2 uRes; // drawing buffer size (px)
      varying vec3 vCol;
      varying float vS;
      ${GLSL}
      void main() {
        ${CULL()}
        float grow = uClock > 1e29 ? 1.0 : clamp((uClock - iT) / 0.5, 0.0, 1.0), s = selected(ipsel, isel);
        vec3 a = istart, b = mix(istart, iend, grow);
        vS = position.x * length(b - a);
        if (uProj > 0.5) { float side = iend.y >= 0.0 ? 1.0 : -1.0; a = projectRZ(a, 2.0 + s, side); b = projectRZ(b, 2.0 + s, side); }
        vec4 A = projectionMatrix * modelViewMatrix * vec4(a, 1.0), B = projectionMatrix * modelViewMatrix * vec4(b, 1.0);
        vec2 along = (B.xy / B.w - A.xy / A.w) * uRes, across = length(along) > 1e-6 ? normalize(vec2(-along.y, along.x)) : vec2(0.0, 1.0);
        vec4 P = mix(A, B, position.x);
        P.xy += across * position.y * uWidth * (1.0 + 0.5 * s * selActive()) / uRes * P.w; // half the width each side, in NDC
        gl_Position = P;
        vCol = fade(mix(icol, vec3(1.0), uFlash * pop(iT)), s) * remaining() + uBg * (1.0 - remaining());
      }`,
    fragmentShader: `uniform float uDash; uniform vec3 uBg; varying vec3 vCol; varying float vS;
      void main() {
        if (uDash > 0.5 && mod(vS, 7.0) > 4.0) discard;
        gl_FragColor = vec4(uDash > 0.5 ? mix(vCol, uBg, 0.35) : vCol, 1.0);
      }`,
  });
  const common = shaderLayer(input, g, material, true, {}, { istart: interleave(start), iend: interleave(end) });
  const quads = new THREE.Mesh(g, material);
  quads.frustumCulled = false;
  quads.renderOrder = 1;
  const res = new THREE.Vector2();
  quads.onBeforeRender = (r) => material.uniforms.uRes.value.copy(r.getDrawingBufferSize(res));
  const group = new THREE.Group().add(quads);
  // Arrow heads: an instanced cone per row at the line's end, along it; hidden when the line is cut or not grown yet.
  let rgb = input.rgb, rz = false, clock = REPLAY_OFF, appear: Float32Array | null = null;
  const heads = d.arrow ? new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 20).translate(0, -0.5, 0), new THREE.ShaderMaterial({ // raw colours, as the lines
    vertexShader: /* glsl */ `varying vec3 vCol;
      void main() {
        #ifdef USE_INSTANCING_COLOR
        vCol = instanceColor;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `varying vec3 vCol; void main() { gl_FragColor = vec4(vCol, 1.0); }`,
  }), Math.max(n, 1)) : null;
  const placeHeads = () => {
    if (!heads) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), a = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    const project = (v: THREE.Vector3, side: number) => (rz ? v.set(v.z, Math.hypot(v.x, v.y) * side, 3) : v);
    for (let i = 0; i < n; i++) {
      const side = y[i] >= 0 ? 1 : -1, grown = clock >= REPLAY_OFF || clock >= (appear?.[i] ?? 0) + 0.5;
      project(a.set(start[0][i], start[1][i], start[2][i]), side);
      project(b.set(x[i], y[i], z[i]), side);
      const dir = b.clone().sub(a), len = dir.length(), h = common.passes(i) && grown && len > 0 ? Math.max(6, 0.1 * len) : 0;
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
  return {
    ...identity(input, 10), object: group, x, y, z, segment: { a: start, b: end }, pickBias: 0.7, line: true,
    ...common,
    setCut(min) { const shown = common.setCut(min); placeHeads(); return shown; },
    setPinned(row) { common.setPinned(row); placeHeads(); },
    setColours(c) { rgb = c; common.setColours(c); placeHeads(); },
    setProjection(v) { rz = v; common.setProjection(v); placeHeads(); },
    setTimeline(a, l) { appear = a; common.setTimeline(a, l); placeHeads(); },
    setClock(t) { const was = clock; clock = t; common.setClock(t); if (heads && (t < REPLAY_OFF || was < REPLAY_OFF)) placeHeads(); },
    dispose() { g.dispose(); material.dispose(); heads?.geometry.dispose(); (heads?.material as THREE.Material | undefined)?.dispose(); heads?.dispose(); },
  };
}

/** Points per drawn piece of helix (a line strip): HELIX_POINTS - 1 along the arc, then the end point. A path of many
 *  turns (a looper) is drawn in several pieces, each at most TURNS_PER_PIECE turns (about 11 degrees per segment), so
 *  it stays round. Each point costs one vertex-shader run per frame (a few sin and cos), nothing on the CPU. */
const HELIX_POINTS = 48, TURNS_PER_PIECE = 1.5, MAX_PIECES = 256;
const PICK_POINTS = 17; // the CPU polyline used for picking and framing
// Paths per table and hint, kept while the event's table lives: a layer that shows only the selection's objects is
// rebuilt on every click, and its paths do not change.
const pathCache = new WeakMap<Table, Map<string, { paths: Paths; pieces: Uint16Array; ends: Float32Array[]; pick: NonNullable<Layer["path"]> }>>();
/** Three columns as one array of 3 floats per row (a vec3 attribute: WebGL gives a shader at most 16 attributes). */
const interleave = (a: readonly [Float32Array, Float32Array, Float32Array]) => {
  const out = new Float32Array(3 * a[0].length);
  for (let i = 0; i < a[0].length; i++) { out[3 * i] = a[0][i]; out[3 * i + 1] = a[1][i]; out[3 * i + 2] = a[2][i]; }
  return out;
};

/** Charged particles' paths in the solenoid field (render/helix.ts), drawn and picked like segments (cuts, selection,
 *  replay, truth dashes). Per object the GPU gets the start, the unit direction, the curvature, two lengths and the end
 *  point; the vertex shader puts each point of the strip on the path, so a path costs 48 bytes, not a polyline. Picking and framing use a coarser polyline computed on the CPU, per path when first needed. */
export function helices(input: LayerInput): Layer {
  const { d, t, field } = input;
  const start = positions(input), cols = (names?: readonly string[]) => (names ?? []).map((c) => toF32(t.columns[c], t.n)) as [Float32Array, Float32Array, Float32Array];
  const key = JSON.stringify([d.position, d.momentum, d.charge, d.end, d.length, field]);
  let byHint = pathCache.get(t);
  if (!byHint) pathCache.set(t, (byHint = new Map()));
  let cached = byHint.get(key);
  if (!cached) {
    const momentum = d.momentum ? cols(d.momentum) : cols(["", "", ""]), charge = toF32(d.charge ? t.columns[d.charge] : undefined, t.n);
    let end = cols(d.end ?? d.position);
    if (isToCylinder(d.length)) end = endsOrCylinder(start, momentum, end, t.n, d.length.to); // where `end` is not finite
    const paths = helixPaths(start, momentum, charge, end, t.n, field), pieces = new Uint16Array(t.n);
    for (let i = 0; i < t.n; i++) { // turns in the field: |k| (rad/cm) times the arc's length there
      const turns = (Math.abs(paths.path[3 * i]) * Math.min(paths.path[3 * i + 1], paths.path[3 * i + 2])) / (2 * Math.PI);
      pieces[i] = Math.min(MAX_PIECES, Math.max(1, Math.ceil(turns / TURNS_PER_PIECE)));
    }
    byHint.set(key, (cached = { paths, pieces, ends: [interleave(start), interleave(paths.end)], pick: polylines(paths, start, PICK_POINTS) }));
  }
  const { paths, pieces, ends: [istart, iend], pick } = cached, [x, y, z] = paths.end;
  const g = new THREE.InstancedBufferGeometry();
  // x: 0 to 1 along the arc of the piece; 2 for the last point, the end point (on the last piece).
  g.setAttribute("position", new THREE.Float32BufferAttribute(Array.from({ length: 3 * HELIX_POINTS }, (_, i) =>
    (i % 3 ? 0 : i / 3 === HELIX_POINTS - 1 ? 2 : i / 3 / (HELIX_POINTS - 2))), 3));
  const material = new THREE.ShaderMaterial({
    uniforms: { ...baseUniforms(input.pal), uDash: { value: d.truth ? 1 : 0 } },
    vertexShader: /* glsl */ `
      attribute float isel, ipsel, icut, iT, iL, ipiece, ipieces;
      attribute vec3 istart, iend, icol, idir, ipath; // ipath: curvature (rad/cm), length in the field, length of the arc (cm)
      varying vec3 vCol;
      varying float vS;
      ${GLSL}
      // The point at path length l: helix in the field, then straight along its last direction (render/helix.ts).
      vec3 pathAt(float l) {
        float lh = min(l, ipath.y), h = 0.5 * ipath.x * lh;
        float s = abs(h) < 1e-4 ? 1.0 - h * h / 6.0 : sin(h) / h, a = s * cos(h), b = s * sin(h);
        float c = cos(2.0 * h), sn = sin(2.0 * h), rest = max(l - lh, 0.0);
        return istart + vec3(lh * (idir.x * a - idir.y * b) + rest * (idir.x * c - idir.y * sn),
                             lh * (idir.y * a + idir.x * b) + rest * (idir.x * sn + idir.y * c),
                             l * idir.z);
      }
      void main() {
        ${CULL()}
        // Replay: the path grows from its start over 0.5 s once it appears, or until iL if later (a path being built).
        float grow = uClock > 1e29 ? 1.0 : clamp((uClock - iT) / (iL > iT ? iL - iT : 0.5), 0.0, 1.0), len = grow * ipath.z;
        float l0 = len * ipiece / ipieces, l1 = len * (ipiece + 1.0) / ipieces;
        vec3 c = pathAt(position.x > 1.5 ? l1 : mix(l0, l1, position.x)), e = iend;
        vS = position.x > 1.5 ? l1 : mix(l0, l1, position.x);
        // The last point of the last piece, once grown: the end point, joined to the arc by a straight piece.
        if (position.x > 1.5 && ipiece + 1.0 >= ipieces && grow >= 1.0) { vS += length(e - c); c = e; }
        float s = selected(ipsel, isel);
        if (uProj > 0.5) c = projectRZ(c, s * 2.0, iend.y >= 0.0 ? 1.0 : -1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(c, 1.0);
        // A selected line is lifted towards white: a thin line in a dark colour (a low-pT track) would be hard to see.
        // It flashes as it appears and, when built, as it is complete.
        float p = max(pop(iT), iL > iT && grow >= 1.0 ? pop(iL) : 0.0);
        vCol = fade(mix(mix(icol, vec3(1.0), 0.3 * s * selActive()), vec3(1.0), uFlash * p), s) * remaining() + uBg * (1.0 - remaining());
      }`,
    fragmentShader: `uniform float uDash; uniform vec3 uBg; varying vec3 vCol; varying float vS;
      void main() {
        if (uDash > 0.5 && mod(vS, 7.0) > 4.0) discard;
        gl_FragColor = vec4(uDash > 0.5 ? mix(vCol, uBg, 0.35) : vCol, 1.0);
      }`,
  });
  const common = shaderLayer(input, g, material, true, {}, { istart, iend, idir: paths.dir, ipath: paths.path }, pieces);
  const lines = new THREE.Line(g, material);
  lines.frustumCulled = false;
  lines.renderOrder = 1;
  return {
    ...identity(input, 8), object: lines, x, y, z, path: pick, pickBias: 0.8, line: true,
    ...common,
    dispose() { g.dispose(); material.dispose(); },
  };
}


/** Unit cone for `cones`, not indexed: per side triangle the apex (z = 0, xy the middle angle of the triangle) and
 *  two base points (z = 1, xy cos and sin of their angle); per cap triangle the base centre (xy = 0, z = 1) and two
 *  base points, marked by `cap` = 1. */
export function unitCone(segments = 32) {
  const pos: number[] = [], cap: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (2 * Math.PI * i) / segments, a1 = (2 * Math.PI * (i + 1)) / segments, am = (a0 + a1) / 2;
    pos.push(Math.cos(am), Math.sin(am), 0, Math.cos(a0), Math.sin(a0), 1, Math.cos(a1), Math.sin(a1), 1);
    pos.push(0, 0, 1, Math.cos(a1), Math.sin(a1), 1, Math.cos(a0), Math.sin(a0), 1);
    cap.push(0, 0, 0, 1, 1, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("cap", new THREE.Float32BufferAttribute(cap, 1));
  return g;
}

/** Objects with an eta-phi extent seen from a point, e.g. jets: a translucent cone from `position` along `direction`
 *  ([eta, phi] columns), its base the circle of `radius` (eta-phi) at `length` cm (a number, a column, a scaled
 *  column, or `{to: {r, z}}`: to that cylinder's surface). The vertex shader places each vertex at apex + L dir(eta +
 *  R cos t, phi + R sin t); in rho-z each cone becomes a wedge on its axis's side. `setOutline`: the rim only, so
 *  the cone stays out of the way of what is inside it (e.g. in a detector's view). Picked along its axis. */
export function cones(input: LayerInput): Layer {
  const { d, t } = input, n = t.n;
  const start = positions(input);
  const [eta, phi] = (d.direction ?? ["eta", "phi"]).map((c) => toF32(t.columns[c], n));
  const radius = perRow(t.columns, n, d.radius, 0.4);
  const length = isToCylinder(d.length) ? new Float32Array(n) : perRow(t.columns, n, d.length, 100);
  const ends = [new Float32Array(n), new Float32Array(n), new Float32Array(n)] as [Float32Array, Float32Array, Float32Array];
  for (let i = 0; i < n; i++) {
    const [dx, dy, dz] = etaPhiDirection(eta[i], phi[i]), x0 = start[0][i], y0 = start[1][i], z0 = start[2][i];
    if (isToCylinder(d.length)) length[i] = toCylinder(x0, y0, z0, dx, dy, dz, d.length.to.r, d.length.to.z);
    ends[0][i] = x0 + length[i] * dx; ends[1][i] = y0 + length[i] * dy; ends[2][i] = z0 + length[i] * dz;
  }
  const base = unitCone(), g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", base.getAttribute("position"));
  g.setAttribute("cap", base.getAttribute("cap"));
  const material = new THREE.ShaderMaterial({
    uniforms: { ...baseUniforms(input.pal), uOutline: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float ilen, isel, ipsel, icut, iT, cap;
      attribute vec3 icol, istart, icone; // icone: eta, phi, radius
      varying vec3 vCol, vN, vV, vA;
      varying float vEdge;
      ${GLSL}
      vec3 dirOf(float eta, float phi) { return vec3(cos(phi) / cosh(eta), sin(phi) / cosh(eta), tanh(eta)); }
      void main() {
        ${CULL()}
        float grow = uClock > 1e29 ? 1.0 : clamp((uClock - iT) / 0.5, 0.0, 1.0), L = ilen * grow;
        vec3 axis = dirOf(icone.x, icone.y), rim = istart + L * dirOf(icone.x + icone.z * position.x, icone.y + icone.z * position.y);
        bool centre = cap > 0.5 && dot(position.xy, position.xy) < 0.01;
        vec3 c = position.z < 0.5 ? istart : centre ? istart + L * axis : rim;
        vec3 nrm = cap > 0.5 ? axis : normalize(rim - istart - dot(rim - istart, axis) * axis);
        float s = selected(ipsel, isel);
        if (uProj > 0.5) c = projectRZ(c, s * 2.0, istart.y + ilen * axis.y >= 0.0 ? 1.0 : -1.0); // the side of its end, as picked
        vec4 mv = modelViewMatrix * vec4(c, 1.0);
        gl_Position = projectionMatrix * mv;
        vN = uProj > 0.5 ? vec3(0.0) : normalMatrix * nrm; vV = -mv.xyz; vA = normalMatrix * axis;
        vEdge = cap > 0.5 ? dot(position.xy, position.xy) : position.z; // 1 on the base's circle
        vCol = fade(mix(icol, vec3(1.0), 0.3 * s * selActive()), s) * remaining() + uBg * (1.0 - remaining());
      }`,
    // Translucent, more opaque towards the rim; in rho-z (no normal) evenly. Outline: the base's circle (about 1.5 px)
    // and the sides' silhouette, which fades as the cone is seen along its axis (then the circle is the outline).
    fragmentShader: /* glsl */ `
      uniform float uOutline;
      varying vec3 vCol, vN, vV, vA;
      varying float vEdge;
      void main() {
        bool flat2d = dot(vN, vN) < 1e-6;
        float rim = flat2d ? 0.55 : 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float ring = smoothstep(1.0 - 1.5 * fwidth(vEdge), 1.0, vEdge);
        float side = flat2d ? 0.0 : pow(rim, 6.0) * (1.0 - abs(dot(normalize(vA), normalize(vV))));
        float a = uOutline > 0.5 ? max(0.9 * ring, 0.8 * side) : 0.12 + 0.55 * pow(rim, 2.0);
        gl_FragColor = vec4(vCol * (0.8 + 0.4 * rim), a);
      }`,
  });
  const common = shaderLayer(input, g, material, true, { ilen: length }, { istart: interleave(start), icone: interleave([eta, phi, radius]) });
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3; // after the opaque objects, so they show through
  return {
    ...identity(input, 14), object: mesh, x: ends[0], y: ends[1], z: ends[2], segment: { a: start, b: ends }, pickBias: 0.6, line: true,
    ...common,
    setOutline(on: boolean, envelope = false) { material.uniforms.uOutline.value = on || envelope ? 1 : 0; },
    dispose() { g.dispose(); base.dispose(); material.dispose(); },
  };
}

export const builders = { cells, markers, ellipsoids, segments, helix: helices, cones } as const;
