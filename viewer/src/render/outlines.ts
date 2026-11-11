// Faint outlines of the parts of the detector (header `outlines`): each part a cylinder (radii r[0]..r[1], |z| from
// z[0] to z[1] at both ends, one piece through z = 0 when z[0] is 0), drawn as rings on its end faces, lines along z
// and spokes across the end faces. In rho-z the rings collapse to points and the lines and spokes draw the part's
// section, the familiar quarter view; end-on they are circles. Not pickable, never framed, drawn behind everything.
import * as THREE from "three";
import type { Outline } from "../io/bundle";

const RING = 64, LINES = 4; // segments per ring; lines along z and spokes per face, evenly in phi (between the axes)

/** The outlines' line segments: 6 floats per segment (its two ends), and per vertex the side of the beam axis it is
 *  drawn on in rho-z (the segment's middle's: a ring segment crossing y = 0 must not jump across the axis). */
export function outlineSegments(outlines: readonly Outline[]): { position: Float32Array; side: Float32Array } {
  const pos: number[] = [], side: number[] = [];
  const add = (a: number[], b: number[]) => {
    pos.push(...a, ...b);
    const s = a[1] + b[1] >= 0 ? 1 : -1;
    side.push(s, s);
  };
  const at = (r: number, phi: number, z: number) => [r * Math.cos(phi), r * Math.sin(phi), z];
  for (const { r, z } of outlines) {
    const [z0, z1] = [Math.min(...z), Math.max(...z)], faces = z0 > 0 ? [z0, z1, -z0, -z1] : [z1, -z1];
    const radii = r[0] > 0 ? r : [r[1]];
    for (const zf of faces)
      for (const rr of radii)
        for (let i = 0; i < RING; i++) add(at(rr, (2 * Math.PI * i) / RING, zf), at(rr, (2 * Math.PI * (i + 1)) / RING, zf));
    for (let i = 0; i < LINES; i++) {
      const phi = (2 * Math.PI * (i + 0.5)) / LINES; // off the axes, so no line lies on y = 0 (rho-z sides)
      for (const rr of radii) {
        if (z0 > 0) { add(at(rr, phi, z0), at(rr, phi, z1)); add(at(rr, phi, -z0), at(rr, phi, -z1)); }
        else add(at(rr, phi, -z1), at(rr, phi, z1));
      }
      for (const zf of faces) add(at(r[0], phi, zf), at(r[1], phi, zf));
    }
  }
  return { position: Float32Array.from(pos), side: Float32Array.from(side) };
}

/** The outlines as one LineSegments in a colour between `colour` and `background` (raw sRGB, as the layers). */
export function outlineObject(outlines: readonly Outline[], colour: THREE.Color, background: THREE.Color) {
  const { position, side } = outlineSegments(outlines), g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(position, 3));
  g.setAttribute("side", new THREE.BufferAttribute(side, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uProj: { value: 0 }, uCol: { value: colour.clone().lerp(background, 0.55) } },
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float side;
      uniform float uProj;
      void main() {
        vec3 c = uProj > 0.5 ? vec3(position.z, length(position.xy) * side, -10.0) : position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(c, 1.0);
      }`,
    fragmentShader: `uniform vec3 uCol; void main() { gl_FragColor = vec4(uCol, 1.0); }`,
  });
  const lines = new THREE.LineSegments(g, material);
  lines.frustumCulled = false;
  lines.renderOrder = -2; // first, and without depth: never in front of the event
  return {
    object: lines,
    setProjection(rz: boolean) { material.uniforms.uProj.value = rz ? 1 : 0; },
    dispose() { g.dispose(); material.dispose(); },
  };
}
