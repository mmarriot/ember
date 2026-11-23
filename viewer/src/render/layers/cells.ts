// Calorimeter and muon cells (`cells`): hexagonal prisms by default, eta-phi towers (`cell.shape: "tower"`) or
// oriented boxes (`cell.shape: "box"`). One instanced draw per layer; the vertex shader places, lights and fades each
// cell.
import * as THREE from "three";
import { type DisplayLayer, type PerRow, toF32 } from "../../io/format";
import { perRow, towerPoint } from "../geometry";
import {
  baseUniforms,
  columns3,
  commonFields,
  CULL,
  drawBehind,
  interleave,
  type Layer,
  type LayerInput,
  newVec3s,
  positions,
  SHADER_COMMON,
  shaderLayer,
} from "./layer";

/** Cells: hexagonal prisms lying in their layer planes, or the shape the hint's `cell` names (towers, boxes). */
export function cells(input: LayerInput): Layer {
  const { d, t } = input;
  if (d.cell?.shape === "tower") return towers(input);
  if (d.cell?.shape === "box") return boxes(input);
  const [x, y, z] = positions(input);
  const size = toF32(d.size ? t.columns[d.size] : undefined, t.n, 0.6);
  const base = hexPrism(),
    g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute("position", base.getAttribute("position"));
  const material = new THREE.ShaderMaterial({
    // A background layer is thinner, so cells drawn at the same place by another layer enclose it and show.
    uniforms: { ...baseUniforms(input.pal, input.d.context), uThick: { value: d.context ? 0.1 : 0.3 } },
    vertexShader: /* glsl */ `
      attribute float ix, iy, iz, isize, isel, ipsel, icut, iT;
      attribute vec3 icol;
      uniform float uThick;
      varying vec3 vCol, vB, vW;
      varying float vA;
      ${SHADER_COMMON}
      void main() {
        ${CULL()}
        vec3 c = vec3(ix, iy, iz);
        float s = selected(ipsel, isel);
        if (uProj > 0.5) c = projectRZ(c, s * 2.0);
        float p = pop(iT), r = isize * (1.0 + 0.9 * p);
        vW = c + position * vec3(r, r, uThick);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(vW, 1.0);
        // Cells that overlap in one plane (e.g. partial cells at module edges) would z-fight: a tiny, fixed depth
        // offset per cell decides which is in front. 3 steps of 2e-7 in NDC stay below the depth gap between layers
        // 1 cm apart up to ~1000 cm away.
        gl_Position = inFront(gl_Position, s); // before the offset, which would otherwise be halved
        gl_Position.z -= gl_Position.w * 2e-7 * float(gl_InstanceID % 4);
        // The colour is A * light * icol + B: the light comes per face in the fragment shader (12 shared corners per
        // cell, no normals), the flash, selection fade and replay fade here: mix(fade(mix(icol * light, 1, f), s), bg, g).
        float f = uFlash * p, k = uRest * selActive() * (1.0 - s), g = faded();
        vCol = icol;
        vA = (1.0 - g) * (1.0 - k) * (1.0 - f) * (1.0 - PIN * gPin);
        vB = ((1.0 - g) * ((1.0 - k) * vec3(f) + k * uBg) + g * uBg) * (1.0 - PIN * gPin) + PIN * gPin * uRim; // the selected cell: as fade()
      }`,
    // The face's normal from the screen derivatives of the surface point: flat shading without per-face vertices.
    fragmentShader: /* glsl */ `
      uniform float uProj;
      varying vec3 vCol, vB, vW;
      varying float vA;
      void main() {
        float light = uProj > 0.5 ? 1.0 : 0.75 + 0.25 * abs(dot(normalize(cross(dFdx(vW), dFdy(vW))), normalize(vec3(0.4, 0.7, 0.6))));
        gl_FragColor = vec4(vA * light * vCol + vB, 1.0);
      }`,
  });
  const common = shaderLayer(input, g, material, true, { ix: x, iy: y, iz: z, isize: size });
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  if (d.context) drawBehind(mesh, material);
  return {
    ...commonFields(input, 8),
    object: mesh,
    x,
    y,
    z,
    ...common,
    setFade(from, to, amount) {
      material.uniforms.uFade.value.set(from, to, amount);
    },
    dispose() {
      g.dispose();
      base.dispose();
      material.dispose();
    },
  };
}

/** Unit hexagonal prism for cells: corners at radius 1 in the z plane (as CylinderGeometry(1, 1, 1, 6) rotated onto
 *  z, so cells tile as before), z = +-1/2; 12 shared corners and 20 outward triangles (the cylinder has 40 vertices),
 *  so the vertex shader runs ~12 times per cell, not ~40: the cost of 400k HGCal cells at PU200. No normals: the
 *  fragment shader lights each face from its derivatives. */
export function hexPrism() {
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 6).rotateX(Math.PI / 2),
    p = cyl.getAttribute("position"),
    corners: number[][] = [];
  for (let i = 0; i < p.count; i++) {
    const v = [p.getX(i), p.getY(i), p.getZ(i)];
    if (Math.hypot(v[0], v[1]) > 0.5 && !corners.some((c) => c.every((x, k) => Math.abs(x - v[k]) < 1e-6)))
      corners.push(v);
  }
  cyl.dispose();
  const angle = (v: number[]) => Math.atan2(v[1], v[0]);
  const top = corners.filter((v) => v[2] > 0).sort((a, b) => angle(a) - angle(b)),
    bottom = corners.filter((v) => v[2] < 0).sort((a, b) => angle(a) - angle(b));
  const pos = [...top, ...bottom],
    tris: number[][] = [];
  // The two caps, as fans, then the sides.
  for (let k = 1; k < 5; k++) {
    tris.push([0, k, k + 1]);
    tris.push([6, 6 + k, 6 + k + 1]);
  }
  for (let k = 0; k < 6; k++) {
    const n = (k + 1) % 6;
    tris.push([k, 6 + k, 6 + n], [k, 6 + n, n]);
  }
  // Each triangle outward (counter-clockwise seen from outside): flipped if it is not.
  const index = tris.flatMap(([a, b, c]) => {
    const u = [0, 1, 2].map((i) => pos[b][i] - pos[a][i]),
      w = [0, 1, 2].map((i) => pos[c][i] - pos[a][i]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const m = [0, 1, 2].map((i) => (pos[a][i] + pos[b][i] + pos[c][i]) / 3);
    return n[0] * m[0] + n[1] * m[1] + n[2] * m[2] >= 0 ? [a, b, c] : [a, c, b];
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos.flat(), 3));
  g.setIndex(index);
  return g;
}

/** A cells layer drawn as instanced solids of another shape (towers, boxes): `base` is a unit box whose corners the
 *  vertex shader `body` places (it sets `c`, the point, and `nrm`, the normal, from the instance's attributes; uniform
 *  `uDisc` from `disc`). Lighting, selection fade, replay pop and the background (context) mode are as for hexagons. */
function solidCells(
  input: LayerInput,
  declarations: string,
  body: string,
  attributes: Record<string, Float32Array>,
  vec3: Record<string, Float32Array>,
  disc = false,
) {
  const { d } = input,
    base = new THREE.BoxGeometry(1, 1, 1),
    g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute("position", base.getAttribute("position"));
  g.setAttribute("normal", base.getAttribute("normal"));
  const material = new THREE.ShaderMaterial({
    uniforms: { ...baseUniforms(input.pal, input.d.context), uDisc: { value: disc ? 1 : 0 } },
    vertexShader: /* glsl */ `
      attribute float isel, ipsel, icut, iT;
      attribute vec3 icol;
      ${declarations}
      uniform float uDisc;
      varying vec3 vCol;
      ${SHADER_COMMON}
      void main() {
        ${CULL()}
        float s = selected(ipsel, isel), p = pop(iT), k = 1.0 + 0.9 * p; // k: grows as it appears in a replay
        vec3 c, nrm;
        ${body}
        if (uProj > 0.5) c = projectRZ(c, s * 2.0, ipos.y >= 0.0 ? 1.0 : -1.0); // one side of the axis per object
        gl_Position = inFront(projectionMatrix * modelViewMatrix * vec4(c, 1.0), s);
        float light = uProj > 0.5 ? 1.0 : 0.7 + 0.3 * abs(dot(normalize(nrm), normalize(vec3(0.4, 0.7, 0.6))));
        vCol = mix(fade(mix(icol * light, vec3(1.0), uFlash * p), s), uBg, faded());
      }`,
    fragmentShader: `varying vec3 vCol; void main() { gl_FragColor = vec4(vCol, 1.0); }`,
  });
  const common = shaderLayer(input, g, material, true, attributes, vec3);
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  if (d.context) drawBehind(mesh, material);
  return {
    object: mesh,
    ...common,
    setFade(from: number, to: number, amount: number) {
      material.uniforms.uFade.value.set(from, to, amount);
    },
    dispose() {
      g.dispose();
      base.dispose();
      material.dispose();
    },
  };
}

/** Calorimeter cells as eta-phi towers seen from the origin (`cell.shape: "tower"`): the bin [eta +- dEta/2] x
 *  [phi +- dPhi/2] of the cell whose front-face centre is `position`, from that face (a cylinder rho = const, or a
 *  `disc` |z| = const) outwards by `depth` cm, e.g. a crystal's length or its energy. The vertex shader builds the
 *  corners (geometry.ts towerPoint is its CPU twin): 6 floats per cell besides the common ones, no geometry on the
 *  CPU. Picked along the axis, front to back. */
function towers(input: LayerInput): Layer {
  const { d, t } = input,
    n = t.n,
    cell = d.cell as Extract<NonNullable<DisplayLayer["cell"]>, { shape: "tower" }>,
    disc = cell.face === "disc";
  const [x, y, z] = positions(input);
  const dEta = perRow(t.columns, n, cell.dEta, 0.087),
    dPhi = perRow(t.columns, n, cell.dPhi, 0.087),
    depth = perRow(t.columns, n, cell.depth, 10);
  for (let i = 0; i < n; i++) depth[i] = Math.max(depth[i], MIN_DEPTH); // never flat: a cell seen edge-on stays visible
  const back = newVec3s(n);
  for (let i = 0; i < n; i++) {
    const b = towerPoint(x[i], y[i], z[i], dEta[i], dPhi[i], depth[i], disc, 0, 0, 1);
    back[0][i] = b[0];
    back[1][i] = b[1];
    back[2][i] = b[2];
  }
  const solid = solidCells(
    input,
    "attribute vec3 ipos, ibin; // ibin: dEta, dPhi, depth (cm)",
    /* glsl */ `
        float rho0 = length(ipos.xy), w = position.z + 0.5;
        float eta = asinh(ipos.z / rho0) + position.x * ibin.x * k, phi = atan(ipos.y, ipos.x) + position.y * ibin.y * k;
        vec3 er = vec3(cos(phi), sin(phi), 0.0), ep = vec3(-er.y, er.x, 0.0), ee, ed;
        if (uDisc < 0.5) { float r = rho0 + w * ibin.z; c = vec3(r * er.xy, r * sinh(eta)); ee = vec3(0.0, 0.0, 1.0); ed = er; }
        else { float zz = ipos.z + sign(ipos.z) * w * ibin.z; c = vec3(abs(zz) / sinh(abs(eta)) * er.xy, zz); ee = -sign(ipos.z) * er; ed = vec3(0.0, 0.0, sign(ipos.z)); }
        nrm = normal.x * ee + normal.y * ep + normal.z * ed;`,
    {},
    { ipos: interleave([x, y, z]), ibin: interleave([dEta, dPhi, depth]) },
    disc,
  );
  return { ...commonFields(input, 8), x, y, z, segment: { a: [x, y, z], b: back }, ...solid };
}
const MIN_DEPTH = 0.3; // cm, as the hexagons' thickness

/** Oriented boxes or trapezoids (`cell.shape: "box"`), e.g. muon chambers: centre `position`, unit axes `u` (width)
 *  and `v` (length) as columns, `size` [half width at -v, half width at +v, half length, half thickness] (geometry.ts
 *  boxPoint is the CPU twin). Picked at the centre. */
function boxes(input: LayerInput): Layer {
  const { d, t } = input,
    n = t.n,
    cell = d.cell as Extract<NonNullable<DisplayLayer["cell"]>, { shape: "box" }>;
  const [x, y, z] = positions(input);
  const size = cell.size.map((v: PerRow) => perRow(t.columns, n, v, 1));
  const solid = solidCells(
    input,
    "attribute vec3 ipos, iu, iv, isize; attribute float ithick; // isize: half widths at -v, +v, half length",
    /* glsl */ `
        vec3 nv = normalize(cross(iu, iv));
        float hw = mix(isize.x, isize.y, position.y + 0.5); // ("half" is reserved in GLSL)
        c = ipos + 2.0 * k * (position.x * hw * iu + position.y * isize.z * iv) + 2.0 * position.z * ithick * nv;
        nrm = normal.x * iu + normal.y * iv + normal.z * nv;`,
    { ithick: size[3] },
    {
      ipos: interleave([x, y, z]),
      iu: interleave(columns3(t, cell.u)),
      iv: interleave(columns3(t, cell.v)),
      isize: interleave([size[0], size[1], size[2]]),
    },
  );
  return { ...commonFields(input, 8), x, y, z, ...solid };
}
