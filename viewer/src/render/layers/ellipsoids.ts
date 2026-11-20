// Showers (`ellipsoids`): translucent ellipsoids along each shower's principal axes, the reconstruction stages told
// apart by their surface. Unlike the other representations these are updated on the CPU (a few thousand objects at
// most): each instance's matrix and colour are rewritten when the cut, the selection or the replay clock changes.
import * as THREE from "three";
import { toF32 } from "../../io/format";
import { REPLAY_OFF } from "../replay";
import { commonFields, cutter, type Layer, type LayerInput, positions } from "./layer";

const SHOWER_STYLES = { solid: 0, shell: 1, cage: 2, core: 3 } as const;
// Instanced unit spheres scaled and rotated per shower; normals use the inverse transpose, so the shading and the
// rim follow the ellipsoid's real surface.
const SHOWER_VERTEX = /* glsl */ `
  attribute float ipair;
  varying vec3 vN, vV, vP, vCol;
  varying float vPair;
  void main() {
    vPair = ipair;
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
  varying float vPair;
  void main() {
    float style = uStyle;
    vec3 n = normalize(vN), v = normalize(vV);
    if (!gl_FrontFacing) n = -n;
    float facing = abs(dot(n, v)), rim = 1.0 - facing;
    vec3 l = normalize(vec3(0.35, 0.65, 0.7));
    float diffuse = 0.55 + 0.45 * max(dot(n, l), 0.0);
    vec3 col; float a;
    if (style < 0.5) { col = vCol * diffuse + 0.18 * pow(rim, 2.0); a = 0.22 + 0.5 * pow(rim, 2.5); }
    else if (style < 1.5) { col = mix(vCol, vec3(1.0), 0.15); a = 0.03 + 0.85 * pow(rim, 4.0); }
    else if (style < 2.5) {
      vec3 w = 1.5 * fwidth(vP); // rings about 1.5 pixels wide on screen, whatever the ellipsoid's size
      vec3 r = 1.0 - smoothstep(0.5 * w, w, abs(vP));
      float ring = max(max(r.x, r.y), r.z);
      col = mix(vCol, vec3(1.0), 0.1 * ring); a = 0.04 + 0.8 * ring + 0.15 * pow(rim, 3.0);
    } else {
      float spec = pow(max(dot(reflect(-l, n), v), 0.0), 28.0);
      col = vCol * (0.35 + 0.75 * diffuse) + 0.45 * spec + 0.12 * pow(rim, 3.0); a = 1.0;
    }
    // The pair view (setPairStyle): a split-off shower is a faint thin rim; the match is brighter and more opaque.
    if (vPair > 1.5) { col = mix(col, vec3(1.0), 0.15); a = min(1.0, 1.8 * a + 0.15); }
    else if (vPair > 0.5) { col = vCol; a = 0.6 * pow(rim, 8.0); }
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
  const shape = d.shape ?? "solid",
    style = SHOWER_STYLES[shape];
  const geometry = new THREE.SphereGeometry(1, 40, 24);
  const material = new THREE.ShaderMaterial({
    vertexShader: SHOWER_VERTEX,
    fragmentShader: SHOWER_FRAGMENT,
    uniforms: { uStyle: { value: style } },
    transparent: shape !== "core",
    depthWrite: shape === "core",
    side: shape === "shell" || shape === "cage" ? THREE.DoubleSide : THREE.FrontSide,
  });
  let core = shape === "core" ? 0.55 : 1; // a candidate is a compact core inside the shower it stands for
  let pinned = -1; // the selected row
  const pair = new Float32Array(Math.max(t.n, 1)); // per shower: its pair-view style (setPairStyle)
  let paired = false; // some shower has one
  geometry.setAttribute("ipair", new THREE.InstancedBufferAttribute(pair, 1));
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(t.n, 1));
  mesh.count = t.n;
  mesh.frustumCulled = false;
  const seg = new Float32Array(6 * t.n),
    segCol = new Float32Array(6 * t.n); // axis lines, written in place by update()
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.BufferAttribute(seg, 3));
  lineGeometry.setAttribute("color", new THREE.BufferAttribute(segCol, 3));
  const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ vertexColors: true }));
  lines.frustumCulled = false;
  const group = new THREE.Group().add(mesh, lines);
  const drawAxis = shape === "solid" || shape === "core"; // shells and cages stay uncluttered
  const pickA = [new Float32Array(t.n), new Float32Array(t.n), new Float32Array(t.n)] as const;
  const pickB = [new Float32Array(t.n), new Float32Array(t.n), new Float32Array(t.n)] as const;
  let rz = false,
    highlighted: Set<number> | null = null,
    previous: Set<number> | null = null,
    hlMix = 1,
    enveloped = false;
  const shown = (set: Set<number> | null, i: number) => (set === null || set.has(i) ? 1 : 0);
  let appear: Float32Array | null = null,
    clock = REPLAY_OFF,
    settled = Infinity; // replay: all grown once clock >= settled
  let retire = REPLAY_OFF; // replay: shrink away from this time
  const GROW = 0.6,
    RETIRE = 0.6;
  const smooth = (a: number) => (a >= 1 ? 1 : a <= 0 ? 0 : a * a * (3 - 2 * a));
  const remaining = () => (clock >= REPLAY_OFF ? 1 : smooth(1 - (clock - retire) / RETIRE));
  const growth = (i: number) => smooth((clock - (appear?.[i] ?? 0)) / GROW) * remaining();
  const sigma = (k: number, i: number) =>
    Math.min(k === 0 ? 30 : 8, Math.max(1, Math.sqrt(Math.max(extent[k]?.[i] ?? 0, 0)))); // cm

  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    s = new THREE.Vector3(),
    p = new THREE.Vector3();
  const a = new THREE.Vector3(),
    zAxis = new THREE.Vector3(0, 0, 1),
    c = new THREE.Color();
  const project = (v: THREE.Vector3) => (rz ? v.set(v.z, Math.hypot(v.x, v.y) * (v.y >= 0 ? 1 : -1), 3) : v);
  const update = () => {
    seg.fill(0);
    for (let i = 0; i < t.n; i++) {
      a.set(axis[0]?.[i] ?? 0, axis[1]?.[i] ?? 0, axis[2]?.[i] ?? 0);
      const hasAxis = a.lengthSq() > 1e-6;
      if (hasAxis) a.normalize();
      const vis = shown(previous, i) + (shown(highlighted, i) - shown(previous, i)) * hlMix;
      const g = growth(i) * vis,
        hidden = !cut.passes(i) || g === 0,
        half = 2 * g * sigma(0, i);
      for (let e = 0; e < 2; e++) {
        // the axis' ends: picked along it, and drawn
        const end = e ? pickB : pickA;
        p.set(x[i], y[i], z[i]).addScaledVector(a, e ? -half : half);
        end[0][i] = p.x;
        end[1][i] = p.y;
        end[2][i] = p.z;
        if (!hasAxis || hidden || !drawAxis || pair[i] === 1) continue;
        project(p);
        const o = 6 * i + 3 * e;
        seg[o] = p.x;
        seg[o + 1] = p.y;
        seg[o + 2] = p.z;
        segCol[o] = rgb[3 * i];
        segCol[o + 1] = rgb[3 * i + 1];
        segCol[o + 2] = rgb[3 * i + 2];
      }
      q.setFromUnitVectors(zAxis, hasAxis && !rz ? a : zAxis);
      if (hidden) s.set(0, 0, 0);
      else if (hasAxis && !rz) s.set(sigma(1, i), sigma(2, i), sigma(0, i));
      else s.set(1, 1, 1);
      mesh.setMatrixAt(i, m.compose(project(p.set(x[i], y[i], z[i])), q, s.multiplyScalar(2 * g * core)));
      const pin = i === pinned ? 0.55 : 0,
        rim = input.pal.rim; // the selected one: halfway to the rim colour, as the shader layers
      mesh.setColorAt(
        i,
        c.setRGB(
          rgb[3 * i] + pin * (rim[0] - rgb[3 * i]),
          rgb[3 * i + 1] + pin * (rim[1] - rgb[3 * i + 1]),
          rgb[3 * i + 2] + pin * (rim[2] - rgb[3 * i + 2]),
        ),
      );
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
    ...commonFields(input, 14),
    object: group,
    x,
    y,
    z,
    segment: { a: pickA, b: pickB },
    pickBias: shape === "core" ? 0.3 : 0.45,
    passes: (i) => cut.passes(i) && shown(highlighted, i) === 1, // showers hidden by a selection cannot be picked
    setCut: cut.setCut,
    setColours(c) {
      rgb = c;
      update();
    },
    setPinned(row) {
      pinned = row;
      cut.pin(row);
      update();
    },
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
    setPairStyle(rows) {
      if (!rows && !paired) return; // the usual case: nothing to undo, no pass over the showers
      pair.fill(0);
      if (rows) pair.set(rows.subarray(0, t.n));
      paired = !!rows;
      geometry.getAttribute("ipair").needsUpdate = true;
      update();
    },
    setHighlight(rows) {
      previous = highlighted;
      highlighted = rows;
      hlMix = 0;
      update();
    },
    setHighlightMix(k) {
      if (k !== hlMix) {
        hlMix = k;
        update();
      }
    },
    setProjection(v) {
      rz = v;
      update();
    },
    setTimeline(t) {
      appear = t;
      settled = Math.max(t.reduce((m, v) => Math.max(m, v), 0) + GROW, retire < REPLAY_OFF ? retire + RETIRE : 0);
    },
    setClock(t) {
      const was = clock;
      clock = t;
      if (appear && !(was >= settled && t >= settled)) update();
    },
    setRetire(t) {
      retire = t;
      if (appear) settled = Math.max(settled, t < REPLAY_OFF ? t + RETIRE : 0);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
    },
  };
}
