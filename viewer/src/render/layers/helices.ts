// Charged particles' paths in the solenoid field (`helix`, the maths in render/helix.ts). The GPU gets a few numbers
// per path and the vertex shader puts each point of a line strip on it; picking and framing use a coarser polyline
// computed on the CPU, per path, when first needed.
import * as THREE from "three";
import { type Table, toF32 } from "../../io/format";
import { HIDDEN } from "../../model/custom/cuts";
import { endsOrCylinder, isToCylinder } from "../geometry";
import { helixPaths, type Paths, polylines } from "../helix";
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
  shaderLayer,
} from "./layer";

/** Points per drawn piece of helix (a line strip): HELIX_POINTS - 1 along the arc, then the end point. A path of many
 *  turns (a looper) is drawn in several pieces, each at most TURNS_PER_PIECE turns (about 11 degrees per segment), so
 *  it stays round. Each point costs one vertex-shader run per frame (a few sin and cos), nothing on the CPU. */
const HELIX_POINTS = 48,
  TURNS_PER_PIECE = 1.5,
  MAX_PIECES = 256;
const PICK_POINTS = 17; // points per path of the CPU polyline used for picking and framing
/** Paths per table and display hint, kept as long as the event's table lives (a WeakMap entry goes with its key): a
 *  layer that shows only the selection's objects is rebuilt on every click, and its paths do not change. */
const pathCache = new WeakMap<
  Table,
  Map<string, { paths: Paths; pieces: Uint16Array; ends: Float32Array[]; pick: NonNullable<Layer["path"]> }>
>();

/** Charged particles' paths, drawn and picked like segments (cuts, selection, replay, truth dashes). Per object the
 *  GPU gets the start, the unit direction, the curvature, two lengths and the end point, and the vertex shader puts
 *  each point of the strip on the path: 48 bytes per path, not a polyline. */
export function helices(input: LayerInput): Layer {
  const { d, t, field } = input;
  const start = positions(input),
    cols = (names?: readonly string[]) =>
      (names ?? []).map((c) => toF32(t.columns[c], t.n)) as [Float32Array, Float32Array, Float32Array];
  const key = JSON.stringify([d.position, d.momentum, d.charge, d.end, d.length, field]);
  let byHint = pathCache.get(t);
  if (!byHint) pathCache.set(t, (byHint = new Map()));
  let cached = byHint.get(key);
  // A layer with nothing to draw (e.g. truth particles shown for a selection, none yet) skips the paths: computing them
  // for every row (100k truth particles at PU200) costs ~50 ms per event; the first selection computes them.
  if (!cached && input.cut && !input.cut.some((v) => v > HIDDEN)) {
    const zeros = () =>
      [new Float32Array(t.n), new Float32Array(t.n), new Float32Array(t.n)] as [
        Float32Array,
        Float32Array,
        Float32Array,
      ];
    const paths: Paths = { n: t.n, dir: new Float32Array(3 * t.n), path: new Float32Array(3 * t.n), end: zeros() };
    const none = new Float32Array(2 * t.n).fill(NaN); // picking: never reached (nothing passes the cut)
    cached = {
      paths,
      pieces: new Uint16Array(t.n).fill(1),
      ends: [new Float32Array(3 * t.n), new Float32Array(3 * t.n)],
      pick: { points: 2, x: none, y: none, z: none, fill() {} },
    };
  } else if (!cached) {
    const momentum = d.momentum ? cols(d.momentum) : cols(["", "", ""]),
      charge = toF32(d.charge ? t.columns[d.charge] : undefined, t.n);
    let end = cols(d.end ?? d.position);
    if (isToCylinder(d.length)) end = endsOrCylinder(start, momentum, end, t.n, d.length.to); // where `end` is not finite
    const paths = helixPaths(start, momentum, charge, end, t.n, field),
      pieces = new Uint16Array(t.n);
    for (let i = 0; i < t.n; i++) {
      // turns in the field: |k| (rad/cm) times the arc's length there
      const turns =
        (Math.abs(paths.path[3 * i]) * Math.min(paths.path[3 * i + 1], paths.path[3 * i + 2])) / (2 * Math.PI);
      pieces[i] = Math.min(MAX_PIECES, Math.max(1, Math.ceil(turns / TURNS_PER_PIECE)));
    }
    byHint.set(
      key,
      (cached = {
        paths,
        pieces,
        ends: [interleave(start), interleave(paths.end)],
        pick: polylines(paths, start, PICK_POINTS),
      }),
    );
  }
  const {
      paths,
      pieces,
      ends: [istart, iend],
      pick,
    } = cached,
    [x, y, z] = paths.end;
  const g = new THREE.InstancedBufferGeometry(),
    wide = (d.width ?? 1) > 1;
  // x: 0 to 1 along the arc of the piece; 2 for the last point, the end point (on the last piece). Wide paths: each
  // point twice, y = -1 and +1 for the two sides of a strip of quads.
  const along = (k: number) => (k === HELIX_POINTS - 1 ? 2 : k / (HELIX_POINTS - 2));
  const strip = new THREE.BufferGeometry(); // also the halo's shape (thin paths too)
  strip.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      Array.from({ length: HELIX_POINTS }, (_, k) => [along(k), -1, 0, along(k), 1, 0]).flat(),
      3,
    ),
  );
  strip.setIndex(
    Array.from({ length: HELIX_POINTS - 1 }, (_, k) => [
      2 * k,
      2 * k + 2,
      2 * k + 1,
      2 * k + 2,
      2 * k + 3,
      2 * k + 1,
    ]).flat(),
  );
  if (!wide)
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(Array.from({ length: HELIX_POINTS }, (_, k) => [along(k), 0, 0]).flat(), 3),
    );
  else {
    g.setAttribute("position", strip.getAttribute("position"));
    g.setIndex(strip.index);
  }
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...baseUniforms(input.pal, input.d.context),
      uDash: { value: d.truth ? 1 : 0 },
      uWidth: { value: (d.width ?? 1) * (globalThis.devicePixelRatio ?? 1) },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    defines: wide ? { WIDE: 1 } : {},
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float isel, ipsel, icut, iT, iL, ipiece, ipieces;
      attribute vec3 istart, iend, icol, idir, ipath; // ipath: curvature (rad/cm), length in the field, length of the arc (cm)
      varying vec3 vCol;
      varying float vS;
      ${SHADER_COMMON}
      // The point at path length l: helix in the field, then straight along its last direction (render/helix.ts).
      vec3 pathAt(float l) {
        float lh = min(l, ipath.y), h = 0.5 * ipath.x * lh;
        float s = abs(h) < 1e-4 ? 1.0 - h * h / 6.0 : sin(h) / h, a = s * cos(h), b = s * sin(h);
        float c = cos(2.0 * h), sn = sin(2.0 * h), rest = max(l - lh, 0.0);
        return istart + vec3(lh * (idir.x * a - idir.y * b) + rest * (idir.x * c - idir.y * sn),
                             lh * (idir.y * a + idir.x * b) + rest * (idir.x * sn + idir.y * c),
                             l * idir.z);
      }
      uniform float uWidth;
      uniform vec2 uRes; // drawing buffer size (px)
      // The drawn point at px along the piece (0..1 on the arc, 2: the end point), on screen (clip space); its path
      // length in len. Replay: the path grows from its start over 0.5 s once it appears, or until iL if later (a path
      // being built). The last point of the last piece, once grown, is the end point, joined to the arc straight.
      vec4 placed(float px, float grow, float depth, out float len) {
        float full = grow * ipath.z, l0 = full * ipiece / ipieces, l1 = full * (ipiece + 1.0) / ipieces;
        len = px > 1.5 ? l1 : mix(l0, l1, px);
        vec3 c = pathAt(len);
        if (px > 1.5 && ipiece + 1.0 >= ipieces && grow >= 1.0) { len += length(iend - c); c = iend; }
        if (uProj > 0.5) c = projectRZ(c, depth, iend.y >= 0.0 ? 1.0 : -1.0);
        return projectionMatrix * modelViewMatrix * vec4(c, 1.0);
      }
      void main() {
        ${CULL()}
        float grow = uClock > 1e29 ? 1.0 : clamp((uClock - iT) / (iL > iT ? iL - iT : 0.5), 0.0, 1.0);
        float s = selected(ipsel, isel);
        gl_Position = placed(position.x, grow, s * 2.0, vS);
        #ifdef WIDE
        // A strip of quads: each point moved across the line on screen by half the width, the line's direction from
        // the next point along the piece (from the previous one at its end).
        float step = 1.0 / ${HELIX_POINTS - 2}.0, back = position.x > 1.0 - 0.5 * step ? 1.0 : 0.0, ignored;
        vec4 nb = placed(back > 0.5 ? min(position.x, 1.0) - step : position.x + step, grow, s * 2.0, ignored);
        vec2 dir = (nb.xy / nb.w - gl_Position.xy / gl_Position.w) * uRes * (back > 0.5 ? -1.0 : 1.0);
        vec2 across = length(dir) > 1e-6 ? normalize(vec2(-dir.y, dir.x)) : vec2(0.0, 1.0);
        gl_Position.xy += across * position.y * (uWidth * (1.0 + 0.5 * s * selActive() + 2.0 * gPin) + HALO_PX) / uRes * gl_Position.w;
        #endif
        gl_Position = inFront(gl_Position, s);
        // A selected line is lifted towards white: a thin line in a dark colour (a low-pT track) would be hard to see.
        // It flashes as it appears and, when built, as it is complete.
        float p = max(pop(iT), iL > iT && grow >= 1.0 ? pop(iL) : 0.0);
        vCol = fade(mix(mix(icol, vec3(1.0), 0.3 * s * selActive()), vec3(1.0), uFlash * p), s) * remaining() + uBg * (1.0 - remaining());
      }`,
    fragmentShader: DASHED_LINE_FRAGMENT,
  });
  const common = shaderLayer(
    input,
    g,
    material,
    true,
    {},
    { istart, iend, idir: paths.dir, ipath: paths.path },
    pieces,
  );
  const lines = wide ? new THREE.Mesh(g, material) : new THREE.Line(g, material);
  lines.frustumCulled = false;
  lines.renderOrder = 1;
  if (wide) followDrawingBuffer(lines, material);
  const ring = halo(g, material, strip, lines.renderOrder, input.pal);
  return {
    ...commonFields(input, 8),
    object: new THREE.Group().add(lines, ring.object),
    x,
    y,
    z,
    path: pick,
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
      strip.dispose();
      material.dispose();
      ring.dispose();
    },
  };
}
