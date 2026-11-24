// What every drawn layer shares. A layer is one table drawn in one representation: one three.js object, usually one
// instanced draw call, with colours computed per object on the CPU beforehand (render/colour.ts).
//
// Most representations do the per-frame work in their vertex shaders: the rho-z projection, the cut, the selection
// fade and the replay clock are uniforms, so a slider step or a replay frame changes a few numbers, not the buffers.
// Showers (ellipsoids.ts) are the exception: a few thousand objects at most, updated on the CPU.
import * as THREE from "three";
import { type DisplayLayer, type Table, toF32, type ViewName } from "../../io/format";
import type { Pal } from "../colour";
import type { Field } from "../helix";
import { HIDDEN } from "../../model/custom/cuts";
import { REPLAY_OFF } from "../replay";

/** A drawn layer, as the engine sees it: its three.js object, where its objects are (for picking and framing), and
 *  the setters control/scene.ts calls. */
export interface Layer {
  readonly key: string;
  readonly table: string;
  readonly label: string;
  /** How far from an object (in px) a click still picks it. */
  readonly pickRadius: number;
  /** A background layer: left out of framing. */
  readonly context?: boolean;
  /** The views that draw it (none: all). */
  readonly views?: readonly ViewName[];
  readonly object: THREE.Object3D;
  /** Where each object is (cm): its position, or for lines their end point. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Objects picked along a segment rather than at a point (lines; showers along their principal axis): its ends. */
  readonly segment?: {
    readonly a: readonly [Float32Array, Float32Array, Float32Array];
    readonly b: readonly [Float32Array, Float32Array, Float32Array];
  };
  /** Curved lines (helices): each object's path as `points` points, object i at [i * points, (i + 1) * points), picked
   *  along it and framed whole. `fill(i)` computes object i's points the first time they are needed. */
  readonly path?: {
    readonly points: number;
    readonly x: Float32Array;
    readonly y: Float32Array;
    readonly z: Float32Array;
    fill(i: number): void;
  };
  /** Lines (tracks, truth particles): framing a selection keeps them whole, start to end. */
  readonly line?: boolean;
  /** Multiplies the pick distance (default 1): below 1, the layer wins over others nearby (e.g. showers over hits). */
  readonly pickBias?: number;
  /** Whether object i survives the current cut. */
  passes(i: number): boolean;
  /** Set the cut's minimum; returns the number of objects shown. */
  setCut(min: number): number;
  /** An object drawn whatever the cut (the selected one); -1 for none. */
  setPinned(row: number): void;
  /** New colours, 3 floats (RGB) per object. */
  setColours(rgb: Float32Array): void;
  /** The new selection's rows (null: nothing selected); setHighlightMix fades from the previous one to it. */
  setHighlight(rows: Set<number> | null): void;
  /** 0: drawn as before the last setHighlight, 1: as after. */
  setHighlightMix(k: number): void;
  /** Draw in the rho-z projection, or in 3D. */
  setProjection(rz: boolean): void;
  /** Replay: when each object appears, and when it joins its group (or, for a path being built, when it is
   *  complete), in seconds. */
  setTimeline(appear: Float32Array, link: Float32Array): void;
  /** Replay time in seconds; REPLAY_OFF shows the final state. */
  setClock(t: number): void;
  /** Replay: when the layer gives way to the next reconstruction stage (s); REPLAY_OFF: never. */
  setRetire(t: number): void;
  /** Replay: fade towards the background between these times, by `amount` (0..1). */
  setFade?(from: number, to: number, amount: number): void;
  /** Shower objects: draw as outlines (e.g. the reco objects matched to a truth particle); `envelope`: as a
   *  full-size outline, also for compact cores (the focus around the level shown inside it). */
  setOutline?(on: boolean, envelope?: boolean): void;
  /** Showers in the pair view, per row (null: none): 1 a faint thin rim (a shower holding only a split-off part of the
   *  particle), 2 brighter (its match), so the match is the one shower that reads as filled. */
  setPairStyle?(rows: Uint8Array | null): void;
  /** The view drawn, for layers that draw differently in the 2D views (cone outlines as wedges). */
  setView?(view: ViewName): void;
  /** Free the GPU buffers and shader programs. */
  dispose(): void;
}

/** What a layer is built from. */
export interface LayerInput {
  key: string;
  d: DisplayLayer;
  t: Table;
  pal: Pal;
  /** 3 floats (RGB) per object. */
  rgb: Float32Array;
  /** Per object, 0 for objects drawn as background (markers: nothing to take a colour from). */
  emphasis?: Uint8Array;
  /** Drawn first and under the other layers, as a background layer is (drawBehind; markers). */
  behind?: boolean;
  /** Per object, the value compared with the cut's minimum; HIDDEN for objects never shown. */
  cut?: Float32Array;
  /** The solenoid field, for helices. */
  field?: Field;
  /** A relation of the event, with its `to` table (`polyline` reads its points through it). */
  relation?: (name: string) => { offsets: Uint32Array; indices: Uint32Array; to: Table } | undefined;
}

/** Three columns, one value per object each (x, y, z). */
export type Vec3s = [Float32Array, Float32Array, Float32Array];

/** Three zeroed columns of n values. */
export const newVec3s = (n: number): Vec3s => [new Float32Array(n), new Float32Array(n), new Float32Array(n)];

/** Three columns of a table as floats (a missing column: zeros). */
export const columns3 = (t: Table, names: readonly string[]) => names.map((c) => toF32(t.columns[c], t.n)) as Vec3s;

/** How far towards the background everything unrelated to a selection fades (0..1), per the user's choice (store
 *  `rest`); hidden (1) is not drawn at all (`gone` in SHADER_COMMON). */
export const REST_FADE = { dim: 0.85, faint: 0.95, hidden: 1 } as const;
/** The uniform `uRest`, one object shared by every layer's material, so setting it changes them all at the next
 *  frame. Context layers and the detector outlines keep the dim level: they are the detector, not the event. */
export const restUniform = { value: REST_FADE.dim as number };
/** The dim level as a GLSL float literal, for the detector outlines. */
export const FADE_GLSL = REST_FADE.dim.toFixed(2);

/** GLSL shared by the shader-drawn layers: their common uniforms (baseUniforms) and helpers for the rho-z
 *  projection, the selection fade and the replay. */
export const SHADER_COMMON = /* glsl */ `
uniform float uProj, uAct0, uAct1, uMix, uCut, uClock, uFlash, uRetire, uPin0, uPin1, uRest;
uniform vec3 uBg, uRim, uGrey, uFade;
vec3 projectRZ(vec3 c, float depth) { return vec3(c.z, length(c.xy) * (c.y >= 0.0 ? 1.0 : -1.0), depth); }
// A line keeps one side of the axis (the side of its end, \`side\`), so a line crossing y = 0 does not jump across it.
vec3 projectRZ(vec3 c, float depth, float side) { return vec3(c.z, length(c.xy) * side, depth); }
// Selection, cross-faded between the previous and the current one: selActive = something selected, s = this one is.
float selActive() { return mix(uAct0, uAct1, uMix); }
float selected(float before, float now) { return mix(before, now, uMix); }
// The selected object (the pinned instances, see CULL) stands out from its own parts: its colour is pulled halfway
// to the rim colour (near white on the dark theme, near black on the light one), which keeps its hue (what it is); a
// line drawn as a ribbon is three times as wide and a marker larger.
float gPin = 0.0;
const float PIN = 0.55;
vec3 fade(vec3 col, float s) { return mix(mix(col, uBg, uRest * selActive() * (1.0 - s)), uRim, PIN * gPin); }
// With the rest hidden (uRest 1), what is not the selection's is not drawn once the cross-fade has taken it to the
// background colour, so it fades out rather than vanishing half way.
bool gone(float s) { return uRest > 0.99 && selActive() * (1.0 - s) > 0.99 && gPin < 0.5; }
// While something is selected, its objects are drawn in front of the rest: the selection's objects take the near half
// of the depth range and the rest the far half, each keeping its own order, so a faded block nearer the camera never
// covers the selection. \`p\`: the final clip-space position.
vec4 inFront(vec4 p, float s) {
  if (selActive() > 0.5) p.z = 0.5 * p.z + (s > 0.5 ? -0.5 : 0.5) * p.w;
  return p;
}
// The halo pass (see halo): the selected object again, wider by HALO_PX px, behind it.
#ifdef HALO
const float HALO_PX = 6.0;
#else
const float HALO_PX = 0.0;
#endif
float pop(float t) { return exp(-max(uClock - t, 0.0) * 6.0); } // 1 when an object appears, then decays in ~0.3 s
// 1 until the layer retires in a replay, then down to 0 over 0.6 s (always 1 outside a replay).
float remaining() { return uClock > 1e29 ? 1.0 : clamp(1.0 - (uClock - uRetire) / 0.6, 0.0, 1.0); }
// Replay: how far the layer has faded towards the background (uFade: from, to, amount; none outside a replay).
float faded() { return uClock > 1e29 ? 0.0 : uFade.z * smoothstep(uFade.x, uFade.y, uClock); }`;

/** The first lines of a vertex shader's main(): an instance that is cut away, not yet there in a replay, retired, or
 *  hidden with the rest (`gone`) is moved outside the clip volume, so it draws nothing. Instances uPin0 <= id < uPin1
 *  are the pinned (selected) object's, drawn whatever the cut. `id`: the instance's number (markers: the vertex's). */
export const CULL = (id = "gl_InstanceID") => `
  #ifdef HALO
  float pinned = 1.0; // the halo pass holds only the pinned object's instances
  #else
  float pinned = float(${id}) >= uPin0 && float(${id}) < uPin1 ? 1.0 : 0.0;
  #endif
  gPin = pinned;
  if ((icut < uCut && pinned < 0.5) || iT > uClock || remaining() <= 0.0 || gone(selected(ipsel, isel))) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }`;

/** Fragment shader of lines that may be truth: simulation truth (uniform uDash) is dashed, 4 cm on and 3 cm off along
 *  the line (varying vS, in cm), and dimmer than reconstructed tracks, so it never looks like one. */
export const DASHED_LINE_FRAGMENT = `uniform float uDash; uniform vec3 uBg; varying vec3 vCol; varying float vS;
      void main() {
        if (uDash > 0.5 && mod(vS, 7.0) > 4.0) discard;
        gl_FragColor = vec4(uDash > 0.5 ? mix(vCol, uBg, 0.35) : vCol, 1.0);
      }`;

/** A colour as the shaders take it: raw sRGB values, like the per-object colours (no conversion to linear). */
export const rawColour = (c: number | string) =>
  typeof c === "number"
    ? new THREE.Color().setHex(c, THREE.LinearSRGBColorSpace)
    : new THREE.Color().setStyle(c, THREE.LinearSRGBColorSpace);

/** The uniforms of SHADER_COMMON, in their resting state: nothing selected or pinned, no cut, no replay. `context`: a
 *  context layer, which keeps the dim level whatever the rest's (restUniform). */
export const baseUniforms = (pal: Pal, context = false) => ({
  uRest: context ? { value: REST_FADE.dim } : restUniform,
  uProj: { value: 0 },
  uPin0: { value: -1 },
  uPin1: { value: -1 },
  uAct0: { value: 0 },
  uAct1: { value: 0 },
  uMix: { value: 1 },
  uCut: { value: -1e30 },
  uClock: { value: REPLAY_OFF },
  uRetire: { value: REPLAY_OFF },
  uFade: { value: new THREE.Vector3(0, 1, 0) },
  uFlash: { value: pal.flash },
  uBg: { value: rawColour(pal.background) },
  uRim: { value: new THREE.Color(...pal.rim) },
  uGrey: { value: rawColour(pal.unassigned) },
});

/** Cut bookkeeping: `values` per object (none: everything passes) against the current minimum; the pinned object
 *  passes whatever the cut. `onChange` gets each new minimum. */
export function cutter(n: number, values: Float32Array | undefined, onChange: (min: number) => void) {
  let min = -Infinity,
    pinned = -1;
  const passes = (i: number) => !values || i === pinned || values[i] >= min;
  return {
    values: values ?? new Float32Array(n),
    passes,
    pin(row: number) {
      pinned = row;
    },
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

/** The per-object attributes of a shader-drawn layer and the Layer setters that change them. Per object the shaders
 *  get `attributes` (one float each), `vec3` (three floats each), the cut value `icut`, the colour `icol`, the
 *  selection as two byte masks (`ipsel` previous, `isel` current, cross-faded by uMix) and the replay times `iT`, `iL`.
 *
 *  Rows hidden for good (cut value HIDDEN: filtered out, or not the selection's in a layer drawn for it) get no
 *  instance: every instance runs the vertex shader on every frame, even when cut away (100k truth helices of 48
 *  points are 5M runs), and a layer rebuilt on every click then uploads only the selection's rows.
 *
 *  `pieces` (instanced only): instances per row, for a row drawn in several pieces (a looping helix, a path through
 *  many points); each gets its piece number in `ipiece` and its row's count in `ipieces`. `toInstances` turns a
 *  per-row array into the per-instance array the geometry holds. */
export function shaderLayer(
  input: LayerInput,
  g: THREE.BufferGeometry,
  material: THREE.ShaderMaterial,
  instanced: boolean,
  attributes: Record<string, Float32Array>,
  vec3: Record<string, Float32Array> = {},
  pieces?: Uint16Array,
) {
  const n = input.t.n,
    u = material.uniforms,
    Attr = instanced ? THREE.InstancedBufferAttribute : THREE.BufferAttribute;
  const cut = cutter(n, input.cut, (m) => (u.uCut.value = Math.max(m, -1e30)));

  // The row of each instance, unless there is one instance per row (`rows` null); `slot`: each row's first
  // instance, -1 for a row without any.
  let rows: Uint32Array | null = null,
    slot: Int32Array | null = null,
    piece: Float32Array | null = null;
  const kept: number[] = [];
  if (input.cut) for (let i = 0; i < n; i++) if (input.cut[i] > HIDDEN) kept.push(i);
  if ((input.cut && kept.length < n) || pieces?.some((c) => c > 1)) {
    const use = input.cut ? kept : Array.from({ length: n }, (_, i) => i),
      count = (r: number) => (pieces ? pieces[r] : 1);
    rows = new Uint32Array(use.reduce((s, r) => s + count(r), 0));
    slot = new Int32Array(n).fill(-1);
    if (pieces) piece = new Float32Array(rows.length);
    let k = 0;
    for (const r of use) {
      slot[r] = k;
      for (let j = 0; j < count(r); j++, k++) {
        rows[k] = r;
        if (piece) piece[k] = j;
      }
    }
  }
  const m = rows ? rows.length : n; // instances
  const toInstances = <T extends Float32Array | Uint8Array>(a: T, size = 1): T => {
    if (!rows) return a;
    const out = new (a.constructor as new (n: number) => T)(size * rows.length);
    for (let k = 0; k < rows.length; k++) for (let c = 0; c < size; c++) out[size * k + c] = a[size * rows[k] + c];
    return out;
  };

  const now = new Uint8Array(m),
    before = new Uint8Array(m),
    appear = new Float32Array(m),
    link = new Float32Array(m);
  for (const [name, a] of Object.entries({
    ...attributes,
    icut: cut.values,
    ...(pieces ? { ipieces: Float32Array.from(pieces) } : {}),
  }))
    g.setAttribute(name, new Attr(toInstances(a), 1));
  if (pieces) g.setAttribute("ipiece", new Attr(piece ?? new Float32Array(m), 1));
  for (const [name, a] of Object.entries({ iT: appear, iL: link })) g.setAttribute(name, new Attr(a, 1));
  for (const [name, a] of Object.entries(vec3)) g.setAttribute(name, new Attr(toInstances(a, 3), 3));
  g.setAttribute("icol", new Attr(toInstances(input.rgb, 3), 3));
  g.setAttribute("isel", new Attr(now, 1, true));
  g.setAttribute("ipsel", new Attr(before, 1, true));
  if (instanced) (g as THREE.InstancedBufferGeometry).instanceCount = m;
  const changed = (...names: string[]) => names.forEach((a) => (g.getAttribute(a).needsUpdate = true));

  return {
    toInstances,
    passes: cut.passes,
    setCut: cut.setCut,
    setPinned(row: number) {
      // its instances: from its slot, as long as they are its own
      cut.pin(row);
      let k = row < 0 ? -1 : slot ? slot[row] : row,
        end = k;
      if (k >= 0) while (end < m && (rows ? rows[end] === row : end === row)) end++;
      u.uPin0.value = k;
      u.uPin1.value = end;
    },
    setColours(rgb: Float32Array) {
      (g.getAttribute("icol").array as Float32Array).set(toInstances(rgb, 3));
      changed("icol");
    },
    setHighlight(sel: Set<number> | null) {
      before.set(now);
      now.fill(0);
      sel?.forEach((r) => {
        for (let k = slot ? slot[r] : r; k >= 0 && k < m && (rows ? rows[k] === r : k === r); k++) now[k] = 255;
      });
      changed("isel", "ipsel");
      u.uAct0.value = u.uAct1.value;
      u.uAct1.value = sel ? 1 : 0;
      u.uMix.value = 0;
    },
    setHighlightMix(k: number) {
      u.uMix.value = k;
    },
    setProjection(rz: boolean) {
      u.uProj.value = rz ? 1 : 0;
    },
    setTimeline(a: Float32Array, l: Float32Array) {
      // in place: a new attribute would orphan its GPU buffer
      appear.set(toInstances(a));
      link.set(toInstances(l));
      changed("iT", "iL");
    },
    setClock(t: number) {
      u.uClock.value = t;
    },
    setRetire(t: number) {
      u.uRetire.value = t;
    },
  };
}

/** The Layer fields every layer takes from its display hint. A background layer is picked over a smaller radius, so
 *  objects in front of it win. */
export const commonFields = ({ key, d }: LayerInput, pickRadius: number) => ({
  key,
  table: d.table,
  label: d.label,
  context: d.context,
  views: d.views,
  pickRadius: d.context ? (3 / 8) * pickRadius : pickRadius,
});

/** The layer's `position` columns as floats. */
export const positions = ({ d, t }: LayerInput) => columns3(t, d.position);

/** Three columns as one array of 3 floats per row, for a vec3 attribute (WebGL gives a shader at most 16 attributes,
 *  so three single floats would use up three of them). */
export const interleave = (a: readonly [Float32Array, Float32Array, Float32Array]) => {
  const out = new Float32Array(3 * a[0].length);
  for (let i = 0; i < a[0].length; i++) {
    out[3 * i] = a[0][i];
    out[3 * i + 1] = a[1][i];
    out[3 * i + 2] = a[2][i];
  }
  return out;
};

/** A background layer (display hint `context`): drawn first and without writing depth, so it never hides the
 *  event. */
export function drawBehind(object: THREE.Object3D, material: THREE.Material) {
  material.depthWrite = false;
  object.renderOrder = -1;
}

/** The two ends of a line one pixel wide (x: 0 at the start, 1 at the end), placed by the vertex shader. */
export function setLineEnds(g: THREE.BufferGeometry) {
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
}

/** The uniform `uPx`: drawing-buffer pixels per CSS pixel, one object shared by every layer's material. The engine
 *  sets it to the screen's devicePixelRatio, again when the window moves to a screen of another density, and to the
 *  scale of a picture while it draws one; lines and markers, sized in CSS pixels, follow at the next frame. */
export const pxUniform = { value: 1 };

/** Uniforms of lines `width` CSS pixels wide (uWidth * uPx drawing-buffer pixels), and the drawing buffer's size
 *  (followDrawingBuffer), which turns that into clip-space units. */
export const lineWidthUniforms = (width: number) => ({
  uWidth: { value: width },
  uPx: pxUniform,
  uRes: { value: new THREE.Vector2(1, 1) },
});

/** Corners of a quad along a line (x: 0 at the start, 1 at the end; y: -1 and +1 for its two sides) and its two
 *  triangles, for lines several pixels wide: the vertex shader moves each corner across the line on screen. */
export function setLineQuad(g: THREE.BufferGeometry) {
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], 3));
  g.setIndex([0, 2, 1, 2, 3, 1]);
}

/** The halo's colour per theme: the page's accent (styles/base.css --accent). */
const HALO_COLOUR = { light: "#0969da", dark: "#4493f8" };
const HALO_FRAGMENT = /* glsl */ `uniform vec3 uHalo;
  #if HALO_DASH
  uniform float uDash;
  varying float vS;
  #endif
  void main() {
    #if HALO_DASH
    if (uDash > 0.5 && mod(vS, 7.0) > 4.0) discard; // a truth line's halo is dashed with it (DASHED_LINE_FRAGMENT)
    #endif
    gl_FragColor = vec4(uHalo, 1.0);
  }`;

/** A halo around the selected line (a line layer's pinned instances): the same instances drawn again before it as a
 *  strip HALO_PX px wider in the accent colour, so even a 1 px line stands out. It shares the layer's uniforms and
 *  shader (with HALO and WIDE defined) and draws copies of the pinned instances' attributes only, so a frame costs a
 *  draw call of a few hundred vertices, not a second pass over the layer. `shape`: the strip's corners (setLineQuad,
 *  or a helix's strip), shared and never freed here; `order`: the layer's renderOrder. */
export function halo(
  source: THREE.InstancedBufferGeometry,
  material: THREE.ShaderMaterial,
  shape: THREE.BufferGeometry,
  order: number,
  pal: Pal,
) {
  const light = (pal.background & 0xff) + ((pal.background >> 8) & 0xff) + (pal.background >> 16) > 3 * 128;
  const haloMaterial = new THREE.ShaderMaterial({
    // the same uniform objects: projection, cut, replay clock follow the layer's
    uniforms: { ...material.uniforms, uHalo: { value: rawColour(HALO_COLOUR[light ? "light" : "dark"]) } },
    defines: { ...material.defines, WIDE: 1, HALO: 1, HALO_DASH: material.uniforms.uDash ? 1 : 0 },
    vertexShader: material.vertexShader,
    fragmentShader: HALO_FRAGMENT,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const empty = new THREE.InstancedBufferGeometry(),
    mesh = new THREE.Mesh(empty, haloMaterial);
  mesh.frustumCulled = false;
  mesh.renderOrder = order - 0.5;
  mesh.visible = false;
  followDrawingBuffer(mesh, haloMaterial);
  let k0 = -1,
    k1 = -1;
  // Free the copies, not the shared shape (disposing a geometry frees the GPU buffers of all its attributes).
  const drop = () => {
    const g = mesh.geometry;
    if (g === empty) return;
    g.deleteAttribute("position");
    g.setIndex(null);
    g.dispose();
    mesh.geometry = empty;
  };
  const copy = () => {
    drop();
    mesh.visible = k0 >= 0 && k1 > k0;
    if (!mesh.visible) return;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", shape.getAttribute("position"));
    if (shape.index) g.setIndex(shape.index);
    for (const [name, a] of Object.entries(source.attributes))
      if (a instanceof THREE.InstancedBufferAttribute)
        g.setAttribute(
          name,
          new THREE.InstancedBufferAttribute(
            (a.array as Float32Array).slice(k0 * a.itemSize, k1 * a.itemSize),
            a.itemSize,
            a.normalized,
          ),
        );
    g.instanceCount = k1 - k0;
    mesh.geometry = g;
  };
  /** Draw instances [a, b) of the layer (its pinned object; a < 0: none). */
  const pin = (a: number, b: number) => {
    if (a === k0 && b === k1) return; // every layer is pinned again at each rebuild
    k0 = a;
    k1 = b;
    copy();
  };
  const refresh = () => {
    if (mesh.visible) copy();
  };
  return {
    object: mesh,
    /** The layer's setters that change its pinned instances or their attributes, keeping the halo in step. */
    wrap(common: Pick<Layer, "setPinned" | "setHighlight" | "setTimeline">) {
      return {
        setPinned(row: number) {
          common.setPinned(row);
          pin(material.uniforms.uPin0.value, material.uniforms.uPin1.value);
        },
        setHighlight(rows: Set<number> | null) {
          common.setHighlight(rows);
          refresh(); // the halo's copy of the selection flags
        },
        setTimeline(appear: Float32Array, link: Float32Array) {
          common.setTimeline(appear, link);
          refresh(); // and of the replay's times
        },
      };
    },
    dispose() {
      drop();
      empty.dispose();
      haloMaterial.dispose();
    },
  };
}

/** Keep the material's `uRes` uniform at the drawing buffer's size (px), which wide lines need to turn their width in
 *  pixels into clip-space units; updated just before each draw of `object`. */
export function followDrawingBuffer(object: THREE.Object3D, material: THREE.ShaderMaterial) {
  const res = new THREE.Vector2();
  object.onBeforeRender = (r) => material.uniforms.uRes.value.copy(r.getDrawingBufferSize(res));
}
