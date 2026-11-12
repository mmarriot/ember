// Faint outlines of the parts of the detector (header `outlines`): each part a cylinder (radii r[0]..r[1], |z| from
// z[0] to z[1] at both ends, one piece through z = 0 when z[0] is 0), drawn as rings on its end faces, lines along z
// and spokes across the end faces. Each view draws what reads in it: the rho-z and side views all of them (the lines
// and spokes draw each part's section, the familiar quarter view), the front view and 3D only the rings (circles
// end-on); in 3D the rings also fade where they come near the camera, so parts around the camera (the camera is
// often inside the muon system) do not criss-cross the view. Not pickable, never framed, drawn behind everything.
import * as THREE from "three";
import type { Outline, ViewName } from "../io/bundle";

const RING = 64, LINES = 4; // segments per ring; lines along z and spokes per face, evenly in phi (between the axes)
export const RING_KIND = 0, LINE_KIND = 1; // `kind` per vertex: a ring's segment, or a line along z or a spoke

/** The outlines' line segments: 6 floats per segment (its two ends); per vertex the side of the beam axis it is drawn
 *  on in rho-z (the segment's middle's: a ring segment crossing y = 0 must not jump across the axis) and its kind. */
export function outlineSegments(outlines: readonly Outline[]): { position: Float32Array; side: Float32Array; kind: Float32Array } {
  const pos: number[] = [], side: number[] = [], kind: number[] = [];
  const add = (a: number[], b: number[], k: number) => {
    pos.push(...a, ...b);
    const s = a[1] + b[1] >= 0 ? 1 : -1;
    side.push(s, s);
    kind.push(k, k);
  };
  const at = (r: number, phi: number, z: number) => [r * Math.cos(phi), r * Math.sin(phi), z];
  for (const { r, z } of outlines) {
    const [z0, z1] = [Math.min(...z), Math.max(...z)], faces = z0 > 0 ? [z0, z1, -z0, -z1] : [z1, -z1];
    const radii = r[0] > 0 ? r : [r[1]];
    for (const zf of faces)
      for (const rr of radii)
        for (let i = 0; i < RING; i++) add(at(rr, (2 * Math.PI * i) / RING, zf), at(rr, (2 * Math.PI * (i + 1)) / RING, zf), RING_KIND);
    for (let i = 0; i < LINES; i++) {
      const phi = (2 * Math.PI * (i + 0.5)) / LINES; // off the axes, so no line lies on y = 0 (rho-z sides)
      for (const rr of radii) {
        if (z0 > 0) { add(at(rr, phi, z0), at(rr, phi, z1), LINE_KIND); add(at(rr, phi, -z0), at(rr, phi, -z1), LINE_KIND); }
        else add(at(rr, phi, -z1), at(rr, phi, z1), LINE_KIND);
      }
      for (const zf of faces) add(at(r[0], phi, zf), at(r[1], phi, zf), LINE_KIND);
    }
  }
  return { position: Float32Array.from(pos), side: Float32Array.from(side), kind: Float32Array.from(kind) };
}

/** The outlines as one LineSegments in a colour between `colour` and `background` (raw sRGB, as the layers); faded
 *  parts are mixed further towards the background (no blending, so no sorting). */
export function outlineObject(outlines: readonly Outline[], colour: THREE.Color, background: THREE.Color) {
  const { position, side, kind } = outlineSegments(outlines), g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(position, 3));
  g.setAttribute("side", new THREE.BufferAttribute(side, 1));
  g.setAttribute("kind", new THREE.BufferAttribute(kind, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uProj: { value: 0 }, uLines: { value: 0 }, uFade: { value: 0 }, uReach: { value: 1000 }, uTarget: { value: new THREE.Vector3() },
      // fainter on a dark background; a light one needs more contrast for the same impression
      uCol: { value: colour.clone().lerp(background, background.getHSL({ h: 0, s: 0, l: 0 }).l > 0.5 ? 0.15 : 0.55) }, uBg: { value: background.clone() },
    },
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float side, kind;
      uniform float uProj, uLines, uFade, uReach;
      uniform vec3 uTarget;
      varying float vKeep, vNear;
      void main() {
        vec3 c = uProj > 0.5 ? vec3(position.z, length(position.xy) * side, -10.0) : position;
        vec4 mv = modelViewMatrix * vec4(c, 1.0);
        gl_Position = projectionMatrix * mv;
        vKeep = kind < 0.5 || uLines > 0.5 ? 1.0 : 0.0;
        // 3D: 0 at the camera, 1 from 60% of the way to what is looked at (uReach: the camera's distance to it), and
        // down to a quarter far from it (parts much larger than what is framed).
        float away = 1.0 - 0.75 * smoothstep(0.3 * uReach, 0.8 * uReach, distance(position, uTarget));
        vNear = uFade > 0.5 ? smoothstep(0.15 * uReach, 0.6 * uReach, -mv.z) * away : 1.0;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol, uBg;
      varying float vKeep, vNear;
      void main() {
        if (vKeep < 0.5) discard;
        gl_FragColor = vec4(mix(uBg, uCol, vNear), 1.0);
      }`,
  });
  const lines = new THREE.LineSegments(g, material);
  lines.frustumCulled = false;
  lines.renderOrder = -2; // first, and without depth: never in front of the event
  const u = material.uniforms;
  return {
    object: lines,
    /** What the view draws: everything in rho-z and from the side, rings only end-on and in 3D, faded near the camera
     *  in 3D. */
    setView(view: ViewName) {
      u.uProj.value = view === "rz" ? 1 : 0;
      u.uLines.value = view === "rz" || view === "side" ? 1 : 0;
      u.uFade.value = view === "3d" ? 1 : 0;
    },
    /** 3D: what the camera looks at and its distance to it (cm), the scale of the fading. */
    setReach(target: THREE.Vector3, d: number) { u.uTarget.value.copy(target); u.uReach.value = d; },
    dispose() { g.dispose(); material.dispose(); },
  };
}
