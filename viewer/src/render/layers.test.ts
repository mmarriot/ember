import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { DisplayLayer, Table } from "../io/bundle";
import { PALETTES } from "./colour";
import { builders, type Layer } from "./layers";
import { hexPrism } from "./layers/cells";
import { unitCone } from "./layers/cones";
import { polylinePoints } from "./layers/polylines";
import { segmentEnds } from "./layers/segments";

const col = (...v: number[]) => Float32Array.from(v);
const table = (columns: Record<string, Float32Array>): Table => ({ n: Object.values(columns)[0].length, columns });
const hint = (extra: Partial<DisplayLayer>) =>
  ({ table: "T", group: "G", label: "L", position: ["x", "y", "z"], visible: true, ...extra }) as DisplayLayer;
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
  return Object.keys(g.attributes).filter((a) => new RegExp(`\\b${a}\\b`).test(m.vertexShader.replace(/\/\/.*$/gm, "")))
    .length;
};

// Two ECAL-barrel-like cells at rho 129 cm.
const crystals = () => table({ x: col(129, 0), y: col(0, 129), z: col(0, 50), energy: col(2, 400) });

describe("cells as towers", () => {
  it("extend from the front face by the depth hint and are picked along their axis", () => {
    const l = build(
      hint({
        repr: "cells",
        cell: {
          shape: "tower",
          face: "cylinder",
          dEta: 0.0174,
          dPhi: 0.0174,
          depth: { column: "energy", scale: 4, max: 45 },
        },
      }),
      crystals(),
    );
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
    const t = table({
      x: col(0),
      y: col(450),
      z: col(0),
      ux: col(1),
      uy: col(0),
      uz: col(0),
      vx: col(0),
      vy: col(0),
      vz: col(1),
      w0: col(100),
      w1: col(120),
      len: col(125),
      th: col(15),
    });
    const l = build(
      hint({
        repr: "cells",
        cell: { shape: "box", u: ["ux", "uy", "uz"], v: ["vx", "vy", "vz"], size: ["w0", "w1", "len", "th"] },
      }),
      t,
    );
    expect([...(parts(l).g.attributes.isize.array as Float32Array)]).toEqual([100, 120, 125]);
    expect(attributesRead(l)).toBeLessThanOrEqual(15);
  });
});

describe("cones", () => {
  const jets = () =>
    table({ vx: col(0, 0), vy: col(0, 0), vz: col(1, 1), eta: col(0, 2.5), phi: col(0.5, -1), pt: col(50, 200) });
  const d = (length: DisplayLayer["length"]) =>
    hint({ repr: "cones", position: ["vx", "vy", "vz"], direction: ["eta", "phi"], radius: 0.4, length });
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
  it("in the 2D views, outline as wedges: two edges from the apex and the base between them", () => {
    const l = build(d({ to: { r: 129, z: 320 } }), jets()),
      [mesh, wedge] = (l.object as THREE.Group).children as [THREE.Mesh, THREE.LineSegments];
    l.setProjection(true);
    l.setView!("rz");
    expect(wedge.visible).toBe(false); // filled cones as usual
    l.setOutline!(true);
    expect([mesh.visible, wedge.visible]).toEqual([false, true]);
    let p = wedge.geometry.getAttribute("position");
    expect(p.count).toBe(2 * 2 * (2 + 32)); // rho-z: two cones, two edges and the base's arc each
    expect([p.getX(0), p.getY(0)]).toEqual([1, 0]); // the first line starts at the first cone's apex: (z, rho)
    // its edges open by the cone's radius around the axis (the central jet at eta 0: 0.4 in eta is ~0.39 rad in theta)
    const edge = (k: number) => Math.atan2(p.getY(2 * k + 1) - p.getY(2 * k), p.getX(2 * k + 1) - p.getX(2 * k));
    expect(Math.abs(edge(0) - edge(1))).toBeCloseTo(2 * Math.atan(Math.sinh(0.4)), 1);
    // Front: two edges and the chord each (the central jet's edges 0.8 rad apart in phi).
    l.setProjection(false);
    l.setView!("front");
    p = wedge.geometry.getAttribute("position");
    expect(p.count).toBe(2 * 2 * 3);
    expect([p.getX(0), p.getY(0), p.getZ(0)]).toEqual([0, 0, 1]); // drawn in 3D: the orthographic camera flattens it
    const a = Math.atan2(p.getY(1), p.getX(1)),
      b = Math.atan2(p.getY(3), p.getX(3));
    expect(Math.abs(a - b)).toBeCloseTo(0.8, 1);
    // A cone seen along its axis (from the side, a jet along x) has no wedge: its base circle.
    const along = build(d(100), table({ vx: col(0), vy: col(0), vz: col(0), eta: col(0), phi: col(0), pt: col(50) }));
    along.setView!("side");
    along.setOutline!(true);
    expect(
      ((along.object as THREE.Group).children[1] as THREE.LineSegments).geometry.getAttribute("position").count,
    ).toBe(2 * 32);
    l.setView!("3d");
    expect([mesh.visible, wedge.visible]).toEqual([true, false]);
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
    const [a, b] = segmentEnds(hint({ repr: "segments", direction: ["dx", "dy", "dz"], length: "l" }), t, [
      t.columns.x,
      t.columns.y,
      t.columns.z,
    ] as never);
    expect([a[0][0], a[1][0], a[2][0]]).toEqual([0, 400, 100]);
    expect(b[1][0]).toBeCloseTo(418, 4);
    expect(b[2][0]).toBeCloseTo(124, 4);
    const [c, e] = segmentEnds(
      hint({ repr: "segments", direction: ["dx", "dy", "dz"], length: 10, centred: true }),
      t,
      [t.columns.x, t.columns.y, t.columns.z] as never,
    );
    expect(c[1][0]).toBeCloseTo(397, 4);
    expect(e[1][0]).toBeCloseTo(403, 4);
  });
  it("keep `end` without a direction", () => {
    const u = table({ x: col(1), y: col(2), z: col(3), ex: col(4), ey: col(5), ez: col(6) });
    const [, b] = segmentEnds(hint({ repr: "segments", end: ["ex", "ey", "ez"] }), u, [
      u.columns.x,
      u.columns.y,
      u.columns.z,
    ] as never);
    expect([b[0][0], b[1][0], b[2][0]]).toEqual([4, 5, 6]);
  });
  it("draw wide lines with arrow heads that follow the cut", () => {
    const met = table({ x: col(0), y: col(0), z: col(0), px: col(30), py: col(40), pz: col(0), pt: col(50) });
    const l = build(
      hint({
        repr: "segments",
        direction: ["px", "py", "pz"],
        length: { column: "pt", scale: 2 },
        arrow: true,
        width: 4,
        cut: { group: "MET", column: "pt" },
      }),
      met,
    );
    expect(l.x[0]).toBeCloseTo(60, 4);
    expect(l.y[0]).toBeCloseTo(80, 4);
    const group = l.object as THREE.Group,
      head = group.children[1] as THREE.InstancedMesh,
      m = new THREE.Matrix4(),
      s = new THREE.Vector3();
    head.getMatrixAt(0, m);
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    expect(s.y).toBeCloseTo(10, 4); // a tenth of the 100 cm line
    expect(attributesRead(l)).toBeLessThanOrEqual(15);
  });
});

describe("helix end fallback", () => {
  it("stops a path without a finite end at the cylinder of `length.to`", () => {
    const t = table({
      x: col(0),
      y: col(0),
      z: col(0),
      px: col(0),
      py: col(0),
      pz: col(10),
      q: col(0),
      ex: col(NaN),
      ey: col(NaN),
      ez: col(NaN),
    });
    const d = hint({
      repr: "helix",
      momentum: ["px", "py", "pz"],
      charge: "q",
      end: ["ex", "ey", "ez"],
      length: { to: { r: 129, z: 320 } },
    });
    const l = builders.helix({
      key: "k",
      d,
      t,
      pal: PALETTES.dark,
      rgb: new Float32Array(3),
      field: { bz: 3.8, rMax: 295, zMax: 320 },
    });
    expect(l.z[0]).toBeCloseTo(320, 3);
  });
});

describe("views", () => {
  it("come from the display hint", () => {
    expect(build(hint({ repr: "cells", views: ["3d", "rz"] }), crystals()).views).toEqual(["3d", "rz"]);
    expect(build(hint({ repr: "cells" }), crystals()).views).toBeUndefined();
  });
});

describe("wide helices", () => {
  it("draw each path as a strip of quads: two vertices per point, two triangles per step", () => {
    const t = table({
      x: col(0),
      y: col(0),
      z: col(0),
      px: col(3),
      py: col(4),
      pz: col(1),
      q: col(1),
      ex: col(NaN),
      ey: col(NaN),
      ez: col(NaN),
    });
    const d = hint({
      repr: "helix",
      momentum: ["px", "py", "pz"],
      charge: "q",
      end: ["ex", "ey", "ez"],
      length: { to: { r: 129, z: 320 } },
      width: 3,
    });
    const l = builders.helix({
      key: "k",
      d,
      t,
      pal: PALETTES.dark,
      rgb: new Float32Array(3),
      field: { bz: 3.8, rMax: 295, zMax: 320 },
    });
    const { o, g, m } = parts(l);
    expect(o).toBeInstanceOf(THREE.Mesh);
    expect(g.getAttribute("position").count).toBe(2 * 48);
    expect(g.index!.count).toBe(6 * 47);
    expect(m.defines.WIDE).toBe(1);
    expect(attributesRead(l)).toBeLessThanOrEqual(15);
    const thin = builders.helix({
      key: "k",
      d: { ...d, width: undefined },
      t,
      pal: PALETTES.dark,
      rgb: new Float32Array(3),
      field: { bz: 3.8, rMax: 295, zMax: 320 },
    });
    expect(parts(thin).o).toBeInstanceOf(THREE.Line);
  });
});

describe("polylines", () => {
  // Two tracks: #0 through hits 2, 0, 1 (in that order), #1 through hit 3 only (nothing to draw).
  const hits = table({ x: col(10, 20, 0, 99), y: col(0, 0, 0, 99), z: col(1, 2, 0, 99) });
  const relation = (name: string) =>
    name === "trackHits"
      ? { offsets: Uint32Array.from([0, 3, 4]), indices: Uint32Array.from([2, 0, 1, 3]), to: hits }
      : undefined;
  const tracks = () => table({ pt: col(5, 7) });
  const d = (width?: number) =>
    hint({ repr: "polyline", points: { relation: "trackHits" }, position: ["pt", "pt", "pt"], width });
  it("join each row's points in the relation's order, one piece per pair", () => {
    const { offsets, xyz, pieces } = polylinePoints(d(), 2, relation);
    expect([...offsets]).toEqual([0, 3, 4]);
    expect([...xyz.subarray(0, 9)]).toEqual([0, 0, 0, 10, 0, 1, 20, 0, 2]);
    expect([...pieces]).toEqual([2, 1]);
  });
  it("give each instance its piece's ends, and pick along the points", () => {
    for (const width of [undefined, 3]) {
      const l = builders.polyline({
        key: "k",
        d: d(width),
        t: tracks(),
        pal: PALETTES.dark,
        rgb: new Float32Array(6),
        relation,
      });
      const g = parts(l).g,
        a = g.getAttribute("ia").array,
        b = g.getAttribute("ib").array;
      expect([...a]).toEqual([0, 0, 0, 10, 0, 1, 99, 99, 99]); // track 0: two pieces; track 1: one empty piece
      expect([...b]).toEqual([10, 0, 1, 20, 0, 2, 99, 99, 99]);
      expect([l.x[0], l.y[0], l.z[0]]).toEqual([20, 0, 2]); // ends at its last point
      expect(l.path!.points).toBe(3);
      expect([...l.path!.x.subarray(0, 3)]).toEqual([0, 10, 20]);
      expect(attributesRead(l)).toBeLessThanOrEqual(15);
    }
  });
  it("draw nothing without the relation", () => {
    const l = builders.polyline({ key: "k", d: d(), t: tracks(), pal: PALETTES.dark, rgb: new Float32Array(6) });
    expect(Number.isNaN(l.x[0])).toBe(true);
  });
});

describe("helices with nothing to draw", () => {
  it("skip the paths, and compute them once a row is kept", () => {
    const t = table({
      x: col(0, 0),
      y: col(0, 0),
      z: col(0, 0),
      px: col(3, 1),
      py: col(4, 1),
      pz: col(1, 1),
      q: col(1, -1),
      ex: col(50, 10),
      ey: col(60, 10),
      ez: col(10, 10),
    });
    const d = hint({
      repr: "helix",
      momentum: ["px", "py", "pz"],
      charge: "q",
      end: ["ex", "ey", "ez"],
      onSelection: true,
    });
    const input = {
      key: "k",
      d,
      t,
      pal: PALETTES.dark,
      rgb: new Float32Array(6),
      field: { bz: 3.8, rMax: 295, zMax: 320 },
    };
    const none = builders.helix({ ...input, cut: col(-Infinity, -Infinity) });
    expect((parts(none).g as THREE.InstancedBufferGeometry).instanceCount).toBe(0);
    const one = builders.helix({ ...input, cut: col(1, -Infinity) });
    expect((parts(one).g as THREE.InstancedBufferGeometry).instanceCount).toBe(1);
    expect(one.x[0]).toBeCloseTo(50, 3);
  });
});

describe("hexagonal prism", () => {
  it("has the cylinder's 12 corners, shared by 20 outward triangles", () => {
    const g = hexPrism(),
      p = g.getAttribute("position"),
      idx = g.index!.array;
    expect(p.count).toBe(12);
    expect(idx.length).toBe(60);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 6).rotateX(Math.PI / 2),
      c = cyl.getAttribute("position");
    for (let i = 0; i < c.count; i++) {
      // every rim point of the old cell is a corner of the new one
      if (Math.hypot(c.getX(i), c.getY(i)) < 0.5) continue;
      let found = false;
      for (let j = 0; j < 12; j++)
        found ||=
          Math.abs(p.getX(j) - c.getX(i)) + Math.abs(p.getY(j) - c.getY(i)) + Math.abs(p.getZ(j) - c.getZ(i)) < 1e-6;
      expect(found).toBe(true);
    }
    const v = (k: number) => new THREE.Vector3(p.getX(k), p.getY(k), p.getZ(k));
    for (let t = 0; t < 60; t += 3) {
      const [a, b, d] = [v(idx[t]), v(idx[t + 1]), v(idx[t + 2])],
        n = b.clone().sub(a).cross(d.clone().sub(a));
      expect(n.dot(a.clone().add(b).add(d))).toBeGreaterThan(0); // facing away from the centre
    }
  });
});
