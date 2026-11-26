import { describe, expect, it } from "vitest";
import type { EventData, Header } from "../../io/format";
import { endsAtBoundary, withTruthEnds } from "./ends";

// Electron 0 reached the calorimeter at t 4 and its last vertex (1) is at t 12: a vertex of its shower. Photon 1
// reached it too, but converted before (vertex 0, t 2). Electron 2 never reached it. Muon 3 reached it, and its last
// vertex (1) is later: where it stopped, in the muon system.
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
      n: 4,
      columns: {
        pdgId: Int32Array.from([11, 22, -11, 13]),
        decayVertexIdx: Int32Array.from([1, 0, -1, 1]),
        hasBoundary: Uint8Array.from([1, 1, 0, 1]),
        boundaryX: f([10, 20, 30, 40]),
        boundaryY: f([11, 21, 31, 41]),
        boundaryZ: f([12, 22, 32, 42]),
        boundaryT: f([4, 4, NaN, 4]),
        endX: f([1, 2, 3, 4]),
        endY: f([1, 2, 3, 4]),
        endZ: f([1, 2, 3, 4]),
      },
    },
    V: { n: 2, columns: { t: f([2, 12]) } },
  },
  relations: {
    decay: { offsets: Uint32Array.from([0, 1, 2, 2, 3]), indices: Uint32Array.from([1, 0, 1]), weights: {} },
  },
} as unknown as EventData;

describe("truth particle ends", () => {
  it("ends an e± or γ at the calorimeter when its last vertex is no earlier than that", () => {
    expect(endsAtBoundary(11, 1, 4, 12)).toBe(true);
    expect(endsAtBoundary(22, 1, 4, NaN)).toBe(true); // no vertex: where it entered
    expect(endsAtBoundary(22, 1, 4, 2)).toBe(false); // it converted in the tracker
    expect(endsAtBoundary(-11, 0, NaN, 12)).toBe(false);
    expect(endsAtBoundary(13, 1, 4, 30)).toBe(false); // a muon goes on
    expect(endsAtBoundary(211, 1, 4, 12)).toBe(false); // a pion's shower is in the HCAL, on its way
  });
  it("moves those ends to the boundary checkpoint, on a copy of the end columns", () => {
    const out = withTruthEnds(ev, header),
      c = out.tables.P.columns;
    expect([...c.endX]).toEqual([10, 2, 3, 4]);
    expect([...c.endY, ...c.endZ]).toEqual([11, 2, 3, 4, 12, 2, 3, 4]);
    expect([...ev.tables.P.columns.endX]).toEqual([1, 2, 3, 4]); // the file's event is left as read
  });
  it("leaves an event without the checkpoint's columns as it is", () => {
    const bare = { ...ev, tables: { ...ev.tables, P: { n: 4, columns: { endX: f([1, 2, 3, 4]) } } } } as EventData;
    expect(withTruthEnds(bare, header)).toBe(bare);
  });
});
