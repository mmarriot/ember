import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { DisplayLayer, Table } from "../io/bundle";
import { PALETTES } from "./colour";
import { builders, type Layer, segmentEnds, unitCone } from "./layers";

const col = (...v: number[]) => Float32Array.from(v);
const table = (columns: Record<string, Float32Array>): Table => ({ n: Object.values(columns)[0].length, columns });
const hint = (extra: Partial<DisplayLayer>) => ({ table: "T", group: "G", label: "L", position: ["x", "y", "z"], visible: true, ...extra }) as DisplayLayer;
const build = (d: DisplayLayer, t: Table): Layer =>
  builders[d.repr]({ key: "k", d, t, pal: PALETTES.dark, rgb: new Float32Array(3 * t.n).fill(0.5) });
/** The mesh (first child of a group) and its geometry and material. */
const parts = (l: Layer) => {
  const o = (l.object instanceof THREE.Group ? l.object.children[0] : l.object) as THREE.Mesh;
  return { o, g: o.geometry, m: o.material as THREE.ShaderMaterial };
};
/** Vertex attributes the shader reads: WebGL allows 16, and some drivers count gl_InstanceID as one. */
const attributesRead = (l: Layer) => {
  const { g, m } = parts(l);
  return Object.keys(g.attributes).filter((a) => new RegExp(`\\b${a}\\b`).test(m.vertexShader.replace(/\/\/.*$/gm, ""))).length;
};

// Two ECAL-barrel-like cells at rho 129 cm.
const crystals = () => table({ x: col(129, 0), y: col(0, 129), z: col(0, 50), energy: col(2, 400) });

describe("cells as towers", () => {
  it("extend from the front face by the depth hint and are picked along their axis", () => {
    const l = build(hint({ repr: "cells", cell: { shape: "tower", face: "cylinder", dEta: 0.0174, dPhi: 0.0174, depth: { column: "energy", scale: 4, max: 45 } } }), crystals());
    const b = l.segment!.b;
    expect(Math.hypot(b[0][0], b[1][0])).toBeCloseTo(129 + 8, 3); // 2 GeV x 4 cm/GeV
    expect(Math.hypot(b[0][1], b[1][1])).toBeCloseTo(129 + 45, 3); // capped
    expect(b[2][1] / Math.hypot(b[0][1], b[1][1])).toBeCloseTo(50 / 129, 5); // same eta
    expect([l.x[1], l.y[1], l.z[1]]).toEqual([0, 129, 50]); // the position, for tooltips and framing
    expect(attributesRead(l)).toBeLessThanOrEqual(15);
  });
  it("never have zero depth", () => {
    const l = build(hint({ repr: "cells", cell: { shape: "tower", depth: 0 } }), crystals());
    expect(Math.hypot(l.segment!.b[0][0], l.segment!.b[1][0])).toBeCloseTo(129.3, 3);
  });
  it("keep hexagons without the hint", () => {
    const l = build(hint({ repr: "cells" }), crystals());
    expect(l.segment).toBeUndefined();
    expect(parts(l).g.attributes.ibin).toBeUndefined();
  });
});

describe("cells as boxes", () => {
  it("read their axes and sizes within the attribute limit", () => {
    const t = table({ x: col(0), y: col(450), z: col(0), ux: col(1), uy: col(0), uz: col(0), vx: col(0), vy: col(0), vz: col(1), w0: col(100), w1: col(120), len: col(125), th: col(15) });
    const l = build(hint({ repr: "cells", cell: { shape: "box", u: ["ux", "uy", "uz"], v: ["vx", "vy", "vz"], size: ["w0", "w1", "len", "th"] } }), t);
    expect([...(parts(l).g.attributes.isize.array as Float32Array)]).toEqual([100, 120, 125]);
    expect(attributesRead(l)).toBeLessThanOrEqual(15);
  });
});

describe("cones", () => {
  const jets = () => table({ vx: col(0, 0), vy: col(0, 0), vz: col(1, 1), eta: col(0, 2.5), phi: col(0.5, -1), pt: col(50, 200) });
  const d = (length: DisplayLayer["length"]) => hint({ repr: "cones", position: ["vx", "vy", "vz"], direction: ["eta", "phi"], radius: 0.4, length });
  it("end on a cylinder's surface with `length.to`", () => {
    const l = build(d({ to: { r: 129, z: 320 } }), jets());
    expect(Math.hypot(l.x[0], l.y[0])).toBeCloseTo(129, 2); // central: the barrel
    expect(l.z[1]).toBeCloseTo(320, 2); // forward: the end cap
    expect(Math.atan2(l.y[0], l.x[0])).toBeCloseTo(0.5, 5);
    expect(l.segment!.a[2][0]).toBe(1); // from the vertex
    expect(attributesRead(l)).toBeLessThanOrEqual(15);
  });
  it("take a scaled length, and outline on request", () => {
    const l = build(d({ column: "pt", scale: 1, max: 150 }), jets());
    expect(Math.hypot(l.x[0], l.y[0], l.z[0] - 1)).toBeCloseTo(50, 3);
    expect(Math.hypot(l.x[1], l.y[1], l.z[1] - 1)).toBeCloseTo(150, 3);
    const u = parts(l).m.uniforms.uOutline;
    l.setOutline!(true);
    expect(u.value).toBe(1);
    l.setOutline!(false);
    expect(u.value).toBe(0);
  });
  it("are made of side and cap triangles", () => {
    const g = unitCone(8);
    expect(g.getAttribute("position").count).toBe(8 * 6);
    expect([...(g.getAttribute("cap").array as Float32Array)].filter((c) => c === 1).length).toBe(8 * 3);
  });
});

describe("segments along a direction", () => {
  const t = table({ x: col(0), y: col(400), z: col(100), dx: col(0), dy: col(3), dz: col(4), l: col(30) });
  it("run `length` along it, or centred on the position", () => {
    const [a, b] = segmentEnds(hint({ repr: "segments", direction: ["dx", "dy", "dz"], length: "l" }), t, [t.columns.x, t.columns.y, t.columns.z] as never);
    expect([a[0][0], a[1][0], a[2][0]]).toEqual([0, 400, 100]);
    expect(b[1][0]).toBeCloseTo(418, 4); expect(b[2][0]).toBeCloseTo(124, 4);
    const [c, e] = segmentEnds(hint({ repr: "segments", direction: ["dx", "dy", "dz"], length: 10, centred: true }), t, [t.columns.x, t.columns.y, t.columns.z] as never);
    expect(c[1][0]).toBeCloseTo(397, 4); expect(e[1][0]).toBeCloseTo(403, 4);
  });
  it("keep `end` without a direction", () => {
    const u = table({ x: col(1), y: col(2), z: col(3), ex: col(4), ey: col(5), ez: col(6) });
    const [, b] = segmentEnds(hint({ repr: "segments", end: ["ex", "ey", "ez"] }), u, [u.columns.x, u.columns.y, u.columns.z] as never);
    expect([b[0][0], b[1][0], b[2][0]]).toEqual([4, 5, 6]);
  });
  it("draw wide lines with arrow heads that follow the cut", () => {
    const met = table({ x: col(0), y: col(0), z: col(0), px: col(30), py: col(40), pz: col(0), pt: col(50) });
    const l = build(hint({ repr: "segments", direction: ["px", "py", "pz"], length: { column: "pt", scale: 2 }, arrow: true, width: 4, cut: { group: "MET", column: "pt" } }), met);
    expect(l.x[0]).toBeCloseTo(60, 4); expect(l.y[0]).toBeCloseTo(80, 4);
    const group = l.object as THREE.Group, head = group.children[1] as THREE.InstancedMesh, m = new THREE.Matrix4(), s = new THREE.Vector3();
    head.getMatrixAt(0, m); m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    expect(s.y).toBeCloseTo(10, 4); // a tenth of the 100 cm line
    expect(attributesRead(l)).toBeLessThanOrEqual(15);
  });
});

describe("helix end fallback", () => {
  it("stops a path without a finite end at the cylinder of `length.to`", () => {
    const t = table({ x: col(0), y: col(0), z: col(0), px: col(0), py: col(0), pz: col(10), q: col(0), ex: col(NaN), ey: col(NaN), ez: col(NaN) });
    const d = hint({ repr: "helix", momentum: ["px", "py", "pz"], charge: "q", end: ["ex", "ey", "ez"], length: { to: { r: 129, z: 320 } } });
    const l = builders.helix({ key: "k", d, t, pal: PALETTES.dark, rgb: new Float32Array(3), field: { bz: 3.8, rMax: 295, zMax: 320 } });
    expect(l.z[0]).toBeCloseTo(320, 3);
  });
});

describe("views", () => {
  it("come from the display hint", () => {
    expect(build(hint({ repr: "cells", views: ["3d", "rz"] }), crystals()).views).toEqual(["3d", "rz"]);
    expect(build(hint({ repr: "cells" }), crystals()).views).toBeUndefined();
  });
});
