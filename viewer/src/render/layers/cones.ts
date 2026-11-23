// Cones (`cones`): objects with an eta-phi extent seen from a point, e.g. jets. Translucent cones in 3D; in the 2D
// views, with outlines on, each is drawn as its wedge in the view's plane (lines computed on the CPU).
import * as THREE from "three";
import { toF32, type ViewName } from "../../io/format";
import { etaPhiDirection, isToCylinder, perRow, toCylinder } from "../geometry";
import {
  baseUniforms,
  commonFields,
  CULL,
  interleave,
  type Layer,
  type LayerInput,
  positions,
  SHADER_COMMON,
  shaderLayer,
} from "./layer";

/** Unit cone for `cones`, not indexed: per side triangle the apex (z = 0, xy the middle angle of the triangle) and
 *  two base points (z = 1, xy cos and sin of their angle); per cap triangle the base centre (xy = 0, z = 1) and two
 *  base points, marked by `cap` = 1. */
export function unitCone(segments = 32) {
  const pos: number[] = [],
    cap: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (2 * Math.PI * i) / segments,
      a1 = (2 * Math.PI * (i + 1)) / segments,
      am = (a0 + a1) / 2;
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
  const { d, t } = input,
    n = t.n;
  const start = positions(input);
  const [eta, phi] = (d.direction ?? ["eta", "phi"]).map((c) => toF32(t.columns[c], n));
  const radius = perRow(t.columns, n, d.radius, 0.4);
  const length = isToCylinder(d.length) ? new Float32Array(n) : perRow(t.columns, n, d.length, 100);
  const ends = [new Float32Array(n), new Float32Array(n), new Float32Array(n)] as [
    Float32Array,
    Float32Array,
    Float32Array,
  ];
  for (let i = 0; i < n; i++) {
    const [dx, dy, dz] = etaPhiDirection(eta[i], phi[i]),
      x0 = start[0][i],
      y0 = start[1][i],
      z0 = start[2][i];
    if (isToCylinder(d.length)) length[i] = toCylinder(x0, y0, z0, dx, dy, dz, d.length.to.r, d.length.to.z);
    ends[0][i] = x0 + length[i] * dx;
    ends[1][i] = y0 + length[i] * dy;
    ends[2][i] = z0 + length[i] * dz;
  }
  const base = unitCone(),
    g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", base.getAttribute("position"));
  g.setAttribute("cap", base.getAttribute("cap"));
  const material = new THREE.ShaderMaterial({
    uniforms: { ...baseUniforms(input.pal, input.d.context), uOutline: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float ilen, isel, ipsel, icut, iT, cap;
      attribute vec3 icol, istart, icone; // icone: eta, phi, radius
      varying vec3 vCol, vN, vV, vA;
      varying float vEdge;
      ${SHADER_COMMON}
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
        gl_Position = inFront(projectionMatrix * mv, s);
        vN = uProj > 0.5 ? vec3(0.0) : normalMatrix * nrm; vV = -mv.xyz; vA = normalMatrix * axis;
        vEdge = cap > 0.5 ? dot(position.xy, position.xy) : position.z; // 1 on the base's circle
        vCol = fade(mix(icol, vec3(1.0), 0.3 * s * selActive()), s) * remaining() + uBg * (1.0 - remaining());
      }`,
    // Translucent, more opaque towards the rim; in rho-z (no normal) evenly. Outline: the base's circle (about 1.5 px)
    // and the sides' silhouette, which fades as the cone is seen along its axis (then the circle is the outline).
    // On a light background a translucent pale colour washes out: denser and a little darker there.
    fragmentShader: /* glsl */ `
      uniform float uOutline;
      uniform vec3 uBg;
      varying vec3 vCol, vN, vV, vA;
      varying float vEdge;
      void main() {
        bool flat2d = dot(vN, vN) < 1e-6, light = dot(uBg, vec3(0.299, 0.587, 0.114)) > 0.5;
        float rim = flat2d ? 0.55 : 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float ring = smoothstep(1.0 - 1.5 * fwidth(vEdge), 1.0, vEdge);
        float side = flat2d ? 0.0 : pow(rim, 6.0) * (1.0 - abs(dot(normalize(vA), normalize(vV))));
        float a = uOutline > 0.5 ? max(0.9 * ring, 0.8 * side) : 0.12 + 0.55 * pow(rim, 2.0);
        vec3 col = vCol * (0.8 + 0.4 * rim);
        gl_FragColor = light ? vec4(col * 0.8, min(1.0, 1.6 * a)) : vec4(col, a);
      }`,
  });
  const common = shaderLayer(
    input,
    g,
    material,
    true,
    { ilen: length },
    { istart: interleave(start), icone: interleave([eta, phi, radius]) },
  );
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3; // after the opaque objects, so they show through
  // Outline in the 2D views: the base circle alone would be stray arcs (rho-z) or big overlapping circles (front, side),
  // so each cone is drawn as its wedge in the view's plane: the two lines from the apex to the outermost points of its
  // base, and between them the base (rho-z: its projected arc, as before) or its chord (front, side). A cone seen along
  // its axis has no wedge: then its base circle. CPU lines, for tens of jets; they follow the cut and the colours, and
  // the cone's own mesh is hidden meanwhile. They share the cones' uniforms, so they fade with a selection as the cones
  // do (per vertex: its row selected before and now, and pinned).
  let rgb = input.rgb,
    rz = false,
    outlined = false,
    view: ViewName = "3d",
    now: Set<number> | null = null,
    before: Set<number> | null = null,
    pinned = -1;
  const wedge = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.ShaderMaterial({
      uniforms: material.uniforms,
      // raw colours, as the layers
      vertexShader: /* glsl */ `
        attribute vec3 color;
        attribute float isel, ipsel, ipin;
        varying vec3 vCol;
        ${SHADER_COMMON}
        void main() {
          gPin = ipin;
          float s = selected(ipsel, isel);
          if (gone(s)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vCol = fade(color, s);
          gl_Position = inFront(projectionMatrix * modelViewMatrix * vec4(position, 1.0), s);
        }`,
      fragmentShader: `varying vec3 vCol; void main() { gl_FragColor = vec4(vCol, 1.0); }`,
    }),
  );
  wedge.frustumCulled = false;
  wedge.renderOrder = 3;
  const updateWedges = () => {
    const show = view !== "3d" && outlined;
    mesh.visible = !show;
    wedge.visible = show;
    if (!show) return;
    const pos: number[] = [],
      col: number[] = [],
      sel: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!common.passes(i)) continue;
      const flags = [now?.has(i) ? 1 : 0, before?.has(i) ? 1 : 0, i === pinned ? 1 : 0];
      const side = ends[1][i] >= 0 ? 1 : -1,
        x0 = start[0][i],
        y0 = start[1][i],
        z0 = start[2][i];
      // A point in the view's plane (2D, for the silhouette) and as drawn (rho-z: in its plane; front, side: the point
      // itself, the orthographic camera flattens it).
      const flat = (x: number, y: number, z: number): [number, number] =>
        rz ? [z, Math.hypot(x, y) * side] : view === "side" ? [z, y] : [x, y];
      const drawn = (p: number[]): number[] => (rz ? [...flat(p[0], p[1], p[2]), 3] : p);
      const apex3 = [x0, y0, z0],
        apex = flat(x0, y0, z0),
        axis = flat(ends[0][i], ends[1][i], ends[2][i]),
        ax = [axis[0] - apex[0], axis[1] - apex[1]];
      const rim3: number[][] = [];
      for (let k = 0; k <= 32; k++) {
        const a = (2 * Math.PI * k) / 32,
          [dx, dy, dz] = etaPhiDirection(eta[i] + radius[i] * Math.cos(a), phi[i] + radius[i] * Math.sin(a));
        rim3.push([x0 + length[i] * dx, y0 + length[i] * dy, z0 + length[i] * dz]);
      }
      const rim = rim3.map((p) => flat(p[0], p[1], p[2]));
      const line = (a: number[], b: number[]) => {
        pos.push(...drawn(a), ...drawn(b));
        col.push(...rgb.subarray(3 * i, 3 * i + 3), ...rgb.subarray(3 * i, 3 * i + 3));
        sel.push(...flags, ...flags);
      };
      // Seen along its axis (the axis shorter on screen than the base is wide): the base circle is its outline.
      const spread = Math.max(...rim.map((p) => Math.hypot(p[0] - axis[0], p[1] - axis[1])));
      if (Math.hypot(ax[0], ax[1]) < spread) {
        for (let k = 0; k < 32; k++) line(rim3[k], rim3[k + 1]);
        continue;
      }
      // The outermost base points on either side of the axis, by their angle from it seen from the apex.
      const turn = (p: [number, number]) =>
        Math.atan2(
          ax[0] * (p[1] - apex[1]) - ax[1] * (p[0] - apex[0]),
          ax[0] * (p[0] - apex[0]) + ax[1] * (p[1] - apex[1]),
        );
      let lo = 0,
        hi = 0;
      rim.forEach((p, k) => {
        if (turn(p) < turn(rim[lo])) lo = k;
        if (turn(p) > turn(rim[hi])) hi = k;
      });
      line(apex3, rim3[lo]);
      line(apex3, rim3[hi]);
      if (rz) for (let k = 0; k < 32; k++) line(rim3[k], rim3[k + 1]);
      else line(rim3[lo], rim3[hi]);
    }
    // A new geometry each time: disposing the old one frees its attributes' GPU buffers (replacing an attribute would
    // leave the old buffer behind until the layer is freed).
    wedge.geometry.dispose();
    wedge.geometry = new THREE.BufferGeometry();
    wedge.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    wedge.geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const flags = new THREE.InterleavedBuffer(Float32Array.from(sel), 3); // one buffer, three attributes
    ["isel", "ipsel", "ipin"].forEach((name, k) =>
      wedge.geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(flags, 1, k)),
    );
  };
  return {
    ...commonFields(input, 14),
    object: new THREE.Group().add(mesh, wedge),
    x: ends[0],
    y: ends[1],
    z: ends[2],
    segment: { a: start, b: ends },
    pickBias: 0.6,
    line: true,
    ...common,
    setCut(min) {
      const shown = common.setCut(min);
      updateWedges();
      return shown;
    },
    setPinned(row) {
      pinned = row;
      common.setPinned(row);
      updateWedges();
    },
    setHighlight(rows) {
      before = now;
      now = rows;
      common.setHighlight(rows);
      updateWedges();
    },
    setColours(c) {
      rgb = c;
      common.setColours(c);
      updateWedges();
    },
    setProjection(v) {
      rz = v;
      common.setProjection(v);
      updateWedges();
    },
    setView(v) {
      view = v;
      updateWedges();
    },
    setOutline(on: boolean, envelope = false) {
      outlined = on || envelope;
      material.uniforms.uOutline.value = outlined ? 1 : 0;
      updateWedges();
    },
    dispose() {
      g.dispose();
      base.dispose();
      material.dispose();
      wedge.geometry.dispose();
      (wedge.material as THREE.Material).dispose();
    },
  };
}
