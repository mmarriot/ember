import { describe, expect, it } from "vitest";
import type { EventData, Header } from "../io/format";
import { constituents, deltaPhi, memberships } from "./physics";

const csr = (rows: number[][], weights: Record<string, number[]> = {}) => ({
  offsets: Uint32Array.from(rows.reduce((o, r) => [...o, o[o.length - 1] + r.length], [0])),
  indices: Uint32Array.from(rows.flat()),
  weights: Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, Float32Array.from(v)])),
});
// two jets of two collections with the same PF candidates 0-2; a tau with 1-2; an electron and a photon with one
// supercluster; PV 0 holds tracks 0 and 1 (weights 0.9, 0.5), its inverse points back.
const ev = {
  id: [1, 1, 1],
  tables: {
    Jet: { n: 1, columns: {} },
    JetCHS: { n: 2, columns: {} },
    Tau: { n: 1, columns: {} },
    PF: { n: 3, columns: { pdgId: Int32Array.from([211, 22, 22]), w: Float32Array.from([1, 0, 0.5]) } },
    Ele: { n: 1, columns: {} },
    Pho: { n: 2, columns: {} },
    SC: { n: 2, columns: {} },
    PV: { n: 1, columns: {} },
    Trk: { n: 2, columns: {} },
  },
  relations: {
    jetPF: csr([[0, 1, 2]]),
    chsPF: csr([[2, 1, 0], [1]]),
    tauPF: csr([[1, 2]]),
    eleSC: csr([[1]]),
    phoSC: csr([[0], [1]]),
    pvTrk: csr([[0, 1]], { weight: [0.9, 0.5] }),
    trkPV: csr([[0], [0]], { weight: [0.9, 0.5] }),
  },
} as unknown as EventData;
const plain = (from: string, to: string, extra = {}) => ({ from, to, weights: [], ...extra });
const header = {
  relations: {
    jetPF: plain("Jet", "PF"),
    chsPF: plain("JetCHS", "PF"),
    tauPF: plain("Tau", "PF"),
    eleSC: plain("Ele", "SC"),
    phoSC: plain("Pho", "SC"),
    pvTrk: plain("PV", "Trk", { weights: ["weight"] }),
    trkPV: plain("Trk", "PV", { weights: ["weight"], inverseOf: "pvTrk" }),
  },
  display: [
    {
      table: "PF",
      filter: "w > 0",
      describe: { columns: ["pdgId"], names: { pdgId: { "211": "π⁺", "22": "γ" } } },
    },
  ],
  tables: {},
} as unknown as Header;

describe("physics", () => {
  it("names the objects holding it through a weighted relation, with the weight", () => {
    expect(memberships(ev, header, "Trk", 1)).toEqual([{ table: "PV", row: 0, weight: 0.5, weightName: "weight" }]);
  });
  it("counts its constituents by type, and how many their layer's filter keeps", () => {
    expect(constituents(ev, header, "Jet", 0)).toEqual([
      {
        table: "PF",
        n: 3,
        types: [
          ["γ", 2],
          ["π⁺", 1],
        ],
        kept: 2,
        filter: "w > 0",
      },
    ]);
  });
  it("measures an angle in φ the short way round", () => {
    expect(deltaPhi(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(deltaPhi(0.5, 0.2)).toBeCloseTo(0.3);
  });
});
