import { describe, expect, it } from "vitest";
import type { EventData, Header } from "../../io/format";
import { endsAtBoundary, withTruthEnds } from "./ends";

// Particle 0 reached the calorimeter at t 4 and its last vertex (1) is at t 12: a vertex of its shower. Particle 1
// reached it too, but decayed before (vertex 0, t 2). Particle 2 never reached it.
const header = {
  display: [
    { table: "P", truth: true, particle: { flags: "f", bit: 2 }, end: ["endX", "endY", "endZ"] },
    { table: "V", truth: true },
  ],
  relations: { decay: { from: "P", to: "V", weights: [] } },
} as unknown as Header;
const f = (xs: number[]) => Float32Array.from(xs);
const ev = {
  tables: {
    P: {
      n: 3,
      columns: {
        decayVertexIdx: Int32Array.from([1, 0, -1]),
        hasBoundary: Uint8Array.from([1, 1, 0]),
        boundaryX: f([10, 20, 30]),
        boundaryY: f([11, 21, 31]),
        boundaryZ: f([12, 22, 32]),
        boundaryT: f([4, 4, NaN]),
        endX: f([1, 2, 3]),
        endY: f([1, 2, 3]),
        endZ: f([1, 2, 3]),
      },
    },
    V: { n: 2, columns: { t: f([2, 12]) } },
  },
  relations: { decay: { offsets: Uint32Array.from([0, 1, 2, 2]), indices: Uint32Array.from([1, 0]), weights: {} } },
} as unknown as EventData;

describe("truth particle ends", () => {
  it("ends a particle at the calorimeter when its last vertex is no earlier than that", () => {
    expect(endsAtBoundary(1, 4, 12)).toBe(true);
    expect(endsAtBoundary(1, 4, NaN)).toBe(true); // no vertex: where it entered
    expect(endsAtBoundary(1, 4, 2)).toBe(false); // it decayed in the tracker
    expect(endsAtBoundary(0, NaN, 12)).toBe(false);
  });
  it("moves those ends to the boundary checkpoint, on a copy of the end columns", () => {
    const out = withTruthEnds(ev, header),
      c = out.tables.P.columns;
    expect([...c.endX]).toEqual([10, 2, 3]);
    expect([...c.endY, ...c.endZ]).toEqual([11, 2, 3, 12, 2, 3]);
    expect([...ev.tables.P.columns.endX]).toEqual([1, 2, 3]); // the file's event is left as read
  });
  it("leaves an event without the checkpoint's columns as it is", () => {
    const bare = { ...ev, tables: { ...ev.tables, P: { n: 3, columns: { endX: f([1, 2, 3]) } } } } as EventData;
    expect(withTruthEnds(bare, header)).toBe(bare);
  });
});
