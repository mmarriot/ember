import { describe, expect, it } from "vitest";
import { LINE_KIND, outlineSegments, RING_KIND } from "./outlines";

/** The segments as pairs of points [x, y, z]. */
const pairs = (p: Float32Array) => Array.from({ length: p.length / 6 }, (_, i) => [[...p.subarray(6 * i, 6 * i + 3)], [...p.subarray(6 * i + 3, 6 * i + 6)]]);

describe("outlineSegments", () => {
  it("draws a barrel part through z = 0 and an endcap part at both ends", () => {
    const barrel = pairs(outlineSegments([{ name: "EB", r: [129, 152], z: [0, 291] }]).position);
    // Lines along z run from -291 to 291 in one piece; no face at z = 0.
    expect(barrel.some(([a, b]) => a[2] === -291 && b[2] === 291)).toBe(true);
    expect(barrel.every(([a, b]) => Math.abs(a[2]) === 291 || Math.abs(b[2]) === 291)).toBe(true);
    const endcap = pairs(outlineSegments([{ name: "HF", r: [12.5, 130], z: [1115, 1280] }]).position);
    for (const z of [1115, 1280, -1115, -1280]) expect(endcap.some(([a, b]) => a[2] === z && b[2] === z)).toBe(true);
    expect(endcap.some(([a, b]) => Math.sign(a[2]) !== Math.sign(b[2]))).toBe(false); // nothing through z = 0
  });
  it("keeps each segment on one side of the beam axis in rho-z, with spokes and lines off y = 0", () => {
    const { position, side } = outlineSegments([{ name: "EB", r: [129, 152], z: [0, 291] }]);
    for (let i = 0; i < side.length; i += 2) {
      expect(side[i]).toBe(side[i + 1]);
      const ymid = position[3 * i + 1] + position[3 * i + 4];
      if (Math.abs(ymid) > 1e-3) expect(Math.sign(ymid)).toBe(side[i]);
    }
    // Spokes (constant z, radius from 129 to 152) are vertical lines in rho-z.
    const spokes = pairs(position).filter(([a, b]) => a[2] === b[2] && Math.abs(Math.hypot(a[0], a[1]) - 129) < 1e-3 && Math.abs(Math.hypot(b[0], b[1]) - 152) < 1e-3);
    expect(spokes.length).toBe(2 * 4);
  });
  it("marks rings apart from lines and spokes, which only the side and rho-z views draw", () => {
    const { kind, position } = outlineSegments([{ name: "EB", r: [129, 152], z: [0, 291] }]);
    const rings = [...kind].filter((k) => k === RING_KIND).length, lines = [...kind].filter((k) => k === LINE_KIND).length;
    expect(rings).toBe(2 * 2 * 64 * 2); // 2 faces x 2 radii x 64 segments, 2 vertices each
    expect(lines).toBe(2 * (4 * 2 + 4 * 2)); // per angle: 2 lines along z, 2 spokes
    expect(kind.length).toBe(position.length / 3);
  });
});
