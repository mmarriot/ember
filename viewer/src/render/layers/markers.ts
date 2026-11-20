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
  SHADER_COMMON,
  shaderLayer,
} from "./layer";

/** Objects as discs of constant pixel size with a dark rim, drawn on top of cells. Objects without emphasis
 *  (e.g. layer clusters in no trackster) are small, rimless and faded, so they stay in the background. With a `size`
 *  column, larger values give larger discs (5 to 14 px over the bulk of the values, as the colour scale), e.g. the
 *  primary vertex (largest sum of pT^2) stands out among the pile-up vertices. Truth markers (truth vertices) are hollow
 *  dashed rings: the simulation's look (docs/truth.md "One look for truth"), never a filled reco vertex. `behind`:
 *  drawn first, under the hits, e.g. layer clusters by truth (control/scene.ts underHits). */
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
      ...baseUniforms(input.pal),
      uPx: { value: window.devicePixelRatio },
      uSized: { value: sizeCol ? 1 : 0 },
      uHollow: { value: d.truth ? 1 : 0 },
    },
    depthTest: false,
    vertexShader: /* glsl */ `
      attribute float ix, iy, iz, isel, ipsel, iemph, icut, iT, iL, isize;
      attribute vec3 icol;
      uniform float uPx, uSized;
      varying vec3 vCol;
      varying float vRim;
      ${SHADER_COMMON}
      void main() {
        ${CULL("gl_VertexID")}
        vec3 c = vec3(ix, iy, iz);
        if (uProj > 0.5) c = projectRZ(c, 4.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(c, 1.0);
        bool linked = iL <= uClock; // replay: grey and small until linked
        float s = selected(ipsel, isel), chosen = selActive() * s; // 0..1 while a selection fades in or out
        float emph = linked ? iemph : 0.0, p = max(pop(iT), linked ? pop(iL) : 0.0);
        float big = uSized > 0.5 ? mix(5.0, 14.0, isize) : 7.0;
        gl_PointSize = mix(emph > 0.5 ? big : 4.0, max(10.0, big), chosen) * (1.0 + 1.2 * p) * (1.0 + 0.6 * gPin) * uPx * remaining();
        vec3 col = linked ? icol : uGrey;
        col = mix(col, uBg, 0.45 * (1.0 - chosen) * (1.0 - emph)); // objects in no group are background
        vCol = fade(mix(col, vec3(1.0), uFlash * p), s);
        vRim = max(chosen, (1.0 - selActive()) * emph);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uRim;
      uniform float uHollow;
      varying vec3 vCol;
      varying float vRim;
      void main() {
        vec2 d = gl_PointCoord * 2.0 - 1.0; float r = dot(d, d);
        if (r > 1.0) discard;
        // truth: a ring of 8 dashes
        if (uHollow > 0.5 && (r < 0.4 || fract(4.0 * atan(d.y, d.x) / 3.14159265) > 0.6)) discard;
        gl_FragColor = vec4(r > 0.5 ? mix(vCol, uRim, 0.55 * vRim) : vCol, 1.0);
      }`,
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
