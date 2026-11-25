// Markers: objects drawn as discs of constant size on screen (vertices, layer clusters, hits seen as points). One
// point per object, so the vertex shader runs once per object.
import * as THREE from "three";
import { toF32 } from "../../io/format";
import { position, valueRange } from "../colour";
import {
  baseUniforms,
  commonFields,
  CULL,
  drawBehind,
  type Layer,
  type LayerInput,
  positions,
  pxUniform,
  SHADER_COMMON,
  shaderLayer,
} from "./layer";

/** Discs of constant pixel size with a rim, drawn over cells. Objects without emphasis (layer clusters in no
 *  trackster) are small, rimless and faded. With a `size` column, larger values give larger discs (5 to 14 px over
 *  the bulk of the values), so the primary vertex stands out among pile-up vertices. Truth markers are hollow rings
 *  with edges of the background's colour (docs/truth.md "One look for truth"), larger for the selection's: they read
 *  over the lines that meet at them, and rings that overlap stay apart. `behind`: drawn first, under the hits (control/sceneColours.ts
 *  underHits). */
export function markers(input: LayerInput): Layer {
  const { d, t } = input;
  const [x, y, z] = positions(input);
  const sizeCol = d.size ? t.columns[d.size] : undefined,
    sized = new Float32Array(t.n);
  if (sizeCol) {
    const v = toF32(sizeCol, t.n),
      r = valueRange(v);
    for (let i = 0; i < t.n; i++) {
      const p = position(r, v[i]);
      sized[i] = p > 0 ? (p < 1 ? p : 1) : 0; // NaN -> 0
    }
  }
  const g = new THREE.BufferGeometry();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...baseUniforms(input.pal, input.d.context),
      uPx: pxUniform,
      uSized: { value: sizeCol ? 1 : 0 },
      uHollow: { value: d.truth ? (input.picks ? 2 : 1) : 0 },
    },
    vertexShader: /* glsl */ `
      attribute float ix, iy, iz, isel, ipsel, iemph, icut, iT, iL, isize;
      attribute vec3 icol;
      uniform float uPx, uSized, uHollow;
      varying vec3 vCol;
      varying float vRim, vSize;
      ${SHADER_COMMON}
      void main() {
        ${CULL("gl_VertexID")}
        vec3 c = vec3(ix, iy, iz);
        if (uProj > 0.5) c = projectRZ(c, 4.0);
        vec4 v = modelViewMatrix * vec4(c, 1.0);
        gl_Position = projectionMatrix * v;
        bool linked = iL <= uClock; // replay: grey and small until linked
        float s = selected(ipsel, isel), chosen = selActive() * s; // 0..1 while a selection fades in or out
        float emph = linked ? iemph : 0.0, p = max(pop(iT), linked ? pop(iL) : 0.0);
        // Markers are drawn over everything, in a slice of the depth range of their own: its first fifth. While
        // something is selected, the rest's slice starts at the middle instead: behind the selection's objects (the
        // near half, inFront), over the rest's. In the slice, markers in no group (small and faded) are behind the
        // others, and each half orders its markers by their distance from the camera, so of two discs that overlap on
        // screen the nearer is on top, seen from any side. The slices and the distance's scale (5000 to 25000 cm) fit
        // the cameras of render/engine.ts (perspective far 20000; orthographic -5000..5000 around FLAT_DISTANCE).
        bool rest = selActive() > 0.5 && s < 0.5, mine = selActive() > 0.5 && !rest;
        float slice = (rest ? 0.5 : 0.0) + (emph > 0.5 || mine ? 0.0 : 0.1), dist = clamp((5000.0 - v.z) / 25000.0, 1e-4, 1.0);
        // The division by w is done here (a point needs no perspective-correct interpolation): the GPU's own division
        // rounds differently as w changes with the camera, so markers tied at one depth would swap places from frame
        // to frame, as they did when all of them were at the near plane. Divided here, equal depths stay equal.
        if (gl_Position.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } // behind the camera
        gl_Position = vec4(gl_Position.xy / gl_Position.w, 2.0 * (slice + 0.1 * dist) - 1.0, 1.0);
        float big = uSized > 0.5 ? mix(5.0, 14.0, isize) : 7.0;
        float size = mix(emph > 0.5 ? big : 4.0, max(uHollow > 0.5 ? 12.0 : 10.0, big), chosen) * (1.0 + 1.2 * p) * (1.0 + 0.6 * gPin) * uPx * remaining();
        gl_PointSize = size + 1.0; // a pixel more: the edge's smoothing reaches half a pixel beyond the disc
        // The picks' vertices: one neutral colour between the background and the rim (light grey on the dark theme,
        // dark grey on the light one), so a colour always means a particle and a ring a vertex; the card names the
        // vertex's process.
        vec3 col = linked ? (uHollow > 1.5 ? mix(uRim, uBg, 0.3) : icol) : uGrey;
        col = mix(col, uBg, 0.45 * (1.0 - chosen) * (1.0 - emph)); // objects in no group are background
        vCol = fade(mix(col, vec3(1.0), uFlash * p), s);
        vRim = max(chosen, (1.0 - selActive()) * emph);
        vSize = size;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uRim, uBg;
      uniform float uHollow;
      varying vec3 vCol;
      varying float vRim, vSize;
      // How much of the pixel at distance r from the centre lies inside the circle of radius "edge" (both in units of
      // the disc's radius): 0 to 1 over one pixel across the edge.
      float inside(float r, float edge) { return clamp((edge - r) * 0.5 * vSize + 0.5, 0.0, 1.0); }
      void main() {
        vec2 d = (gl_PointCoord * 2.0 - 1.0) * (vSize + 1.0) / vSize; float r = length(d); // in units of its radius
        // The disc's edges are smoothed over one pixel: the alpha is the share of the pixel covered, which the
        // multisampled drawing buffer turns into that share of its samples (alphaToCoverage). A hard edge would take
        // or leave whole pixels, and a small disc moving by a fraction of a pixel would change shape: the dots shimmer.
        float a = inside(r, 1.0);
        if (uHollow > 0.5) {
          // truth: a ring (0.5 to 0.8 of the radius) between edges of the background's colour, hollow inside 0.36
          a *= 1.0 - inside(r, 0.36);
          if (!(a > 0.0)) discard;
          gl_FragColor = vec4(mix(uBg, vCol, inside(r, 0.8) * (1.0 - inside(r, 0.5))), a);
          return;
        }
        if (!(a > 0.0)) discard;
        gl_FragColor = vec4(mix(vCol, uRim, 0.55 * vRim * (1.0 - inside(r, 0.71))), a);
      }`,
    alphaToCoverage: true,
  });
  const { toInstances, ...common } = shaderLayer(input, g, material, false, { ix: x, iy: y, iz: z, isize: sized });
  // three draws as many points as `position` has entries; the shader does not read it, so it shares ix's buffer.
  g.setAttribute("position", g.getAttribute("ix"));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity); // not computed from it (three's depth sort asks)
  const emph = new THREE.BufferAttribute(toInstances(input.emphasis ?? new Uint8Array(t.n).fill(1)), 1); // 0 or 1, not normalised
  g.setAttribute("iemph", emph);
  const points = new THREE.Points(g, material);
  points.frustumCulled = false;
  points.renderOrder = 2;
  // The edges' alpha is the share of a pixel's samples covered, not a transparency: it must not reach the drawing
  // buffer's alpha channel (three's canvas always has one), which the page composites, or a saved picture would have
  // see-through edges. three restores its own colour mask only when a material asks for another, so it is put back.
  // (So no material may set colorWrite false: three's cache would then undo this mask before the markers' draw.)
  points.onBeforeRender = (r) => r.getContext().colorMask(true, true, true, false);
  points.onAfterRender = (r) => r.getContext().colorMask(true, true, true, true);
  if (input.behind) drawBehind(points, material);
  return {
    ...commonFields(input, 9),
    object: points,
    x,
    y,
    z,
    ...common,
    dispose() {
      g.dispose();
      material.dispose();
    },
  };
}
