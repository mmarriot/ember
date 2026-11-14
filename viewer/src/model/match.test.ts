import { describe, expect, it } from "vitest";
import type { EventData, Header } from "../io/format";
import { bestPurities, completeness, NO_EXPORT, opensPair, quality, simEnergyByParticle, truthStatus } from "./match";
import cms from "./fixtures/cms_header.json";
import { factUnit, facts } from "./facts";

const csr = (rows: number[][], weights: Record<string, number[]> = {}) => ({
  offsets: Uint32Array.from(rows.reduce((o, r) => [...o, o[o.length - 1] + r.length], [0])),
  indices: Uint32Array.from(rows.flat()),
  weights: Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, Float32Array.from(v)])),
});
// Tracks 0 (20 hits: 18 from particle 0, 2 from 1) and 1 (no match); a trackster of 10 GeV, 4 GeV of it from particle 1.
const ev = {
  id: [1, 1, 1],
  tables: {
    Track: { n: 2, columns: { nPix: Uint8Array.from([5, 4]), nOT: Uint8Array.from([15, 8]) } },
    Trackster: { n: 1, columns: { rawEnergy: Float32Array.from([10]) } },
    P: { n: 2, columns: {} },
  },
  relations: {
    trackTruth: csr([[0, 1], []], { sharedEnergy: [18, 2], score: [0.1, 0.9] }),
    truthTracks: csr([[0], [0]], { sharedFraction: [18, 2], score: [0.4, 0.95] }),
    tsTruth: csr([[1]], { sharedEnergy: [4], score: [0.5] }),
    truthTs: csr([[], [0]], { sharedFraction: [0.8], score: [0.3] }),
  },
} as unknown as EventData;
const best = { weight: "score", order: "min" } as const;
const header = {
  relations: {
    trackTruth: {
      from: "Track",
      to: "P",
      weights: ["sharedEnergy", "score"],
      association: true,
      best,
      match: {
        measure: "hits",
        in: "tracker",
        target: "trackerHits",
        shared: "sharedEnergy",
        over: ["nPix + nOT"],
        good: 0.75,
      },
    },
    truthTracks: {
      from: "P",
      to: "Track",
      weights: ["sharedFraction", "score"],
      association: true,
      match: { measure: "hits", in: "tracker", completeness: { weight: "score", complement: true } },
    },
    tsTruth: {
      from: "Trackster",
      to: "P",
      weights: ["sharedEnergy", "score"],
      association: true,
      best,
      match: { measure: "energy", in: "HGCal", shared: "sharedEnergy", over: ["raw_energy", "rawEnergy"], good: 0.5 },
    },
    truthTs: {
      from: "P",
      to: "Trackster",
      weights: ["sharedFraction", "score"],
      association: true,
      match: { measure: "energy", in: "HGCal", completeness: { weight: "sharedFraction" } },
    },
  },
} as unknown as Header;

describe("match quality", () => {
  it("gives purity as shared over the object's own amount, from the first expression that can be computed", () => {
    expect(quality(ev, header, "trackTruth", 0, 0)).toMatchObject({
      shared: 18,
      over: 20,
      purity: 0.9,
      score: expect.closeTo(0.1),
      clean: true,
    });
    expect(quality(ev, header, "tsTruth", 0, 0)).toMatchObject({ shared: 4, over: 10, purity: 0.4, clean: false });
  });
  it("gives the purity of each object's best match, NaN without one", () => {
    const p = bestPurities(ev, header, "trackTruth")!;
    expect(p[0]).toBeCloseTo(0.9);
    expect(Number.isNaN(p[1])).toBe(true);
  });
  it("gives completeness from the truth -> reco weight, or its complement", () => {
    expect(completeness(ev, header, "P", 0, "Track", 0)?.value).toBeCloseTo(0.6);
    expect(completeness(ev, header, "P", 1, "Trackster", 0)?.value).toBeCloseTo(0.8);
    expect(completeness(ev, header, "P", 0, "Trackster", 0)).toBeUndefined();
  });
});

// Where truth stops (docs/truth.md): each drawn kind's status, from the header alone.
const rel = (from: string, to: string, extra = {}) => ({ from, to, weights: [], ...extra });
const kinds = {
  relations: {
    jetCands: rel("Jet", "PFCand"),
    candTrack: rel("PFCand", "Track"),
    trackHits: rel("Track", "THit"),
    lcHits: rel("LC", "Hit"),
    trackTruth: rel("Track", "P", {
      weights: ["sharedEnergy", "score"],
      association: true,
      best,
      match: { measure: "hits", in: "tracker", shared: "sharedEnergy", good: 0.75 },
    }),
    vtxTruth: rel("Vtx", "TV", {
      weights: ["fraction", "score"],
      association: true,
      best,
      match: { measure: "pt2", in: "tracker", target: "interaction", purity: "fraction", good: 0.5 },
    }),
    truthHits: rel("P", "Hit", {
      weights: ["simEnergy"],
      association: true,
      best: { weight: "simEnergy", order: "max" },
      fact: { in: "HGCal" },
    }),
    truthMHits: rel("P", "MHit", {
      weights: ["simEnergy"],
      association: true,
      best: { weight: "simEnergy", order: "max" },
      fact: { in: "Muons" },
    }),
  },
  display: [
    { table: "Jet", repr: "segments", truthGap: { reason: "no jet associator in CMSSW", gap: 21 } },
    { table: "PFCand", repr: "helix" },
    { table: "Track", repr: "helix" },
    { table: "THit", repr: "markers" },
    { table: "Hit", repr: "cells" },
    { table: "MHit", repr: "markers" },
    {
      table: "LC",
      repr: "markers",
      truthGap: { reason: "no layer-cluster associator in CMSSW", gap: 1, derived: "content" },
    },
    { table: "Vtx", repr: "markers" },
    { table: "P", repr: "helix", truth: true },
    { table: "TV", repr: "markers", truth: true },
  ],
} as unknown as Header;

describe("truth status", () => {
  it("says for each kind whether CMSSW matches it, the simulation gives facts, Ember derives it, or truth stops", () => {
    const kind = (t: string) => truthStatus(kinds, t)?.kind;
    expect(truthStatus(kinds, "Track")).toMatchObject({ kind: "match", relation: "trackTruth" });
    expect(truthStatus(kinds, "Vtx")).toMatchObject({ kind: "match", relation: "vtxTruth" }); // to the truth vertices
    expect(truthStatus(kinds, "MHit")).toEqual({ kind: "fact", in: "Muons" }); // from the hint, not from the layer's repr
    expect(truthStatus(kinds, "LC")).toMatchObject({ kind: "derived", gap: 1 });
    expect(truthStatus(kinds, "Jet")).toEqual({ kind: "none", reason: "no jet associator in CMSSW", gap: 21 });
    expect(truthStatus(kinds, "PFCand")).toEqual({ kind: "none", reason: NO_EXPORT });
    expect(truthStatus(kinds, "THit")).toEqual({ kind: "container", relation: "trackHits" });
    expect([kind("P"), kind("TV")]).toEqual([undefined, undefined]);
  });
  it("ignores a truthGap once the kind has its own match", () => {
    const h = {
      ...kinds,
      relations: {
        ...kinds.relations,
        jetTruth: rel("Jet", "P", { association: true, match: { measure: "energy", in: "all", shared: "e" } }),
      },
    } as unknown as Header;
    expect(truthStatus(h, "Jet")?.kind).toBe("match");
  });
  it("reads today's cms bundle as before: facts from cells layers, layer clusters derived, vertices without truth", () => {
    const h = cms as unknown as Header,
      kind = (t: string) => truthStatus(h, t)?.kind;
    expect(truthStatus(h, "HGCalSoARecHitsEE")).toEqual({ kind: "fact", in: "HGCal" });
    expect(["TICLCandidates", "Tracks", "TICLSoATracksters"].map(kind)).toEqual(["match", "match", "match"]);
    expect([kind("HGCalSoALayerClusters"), kind("TrackHits"), kind("Vertices")]).toEqual([
      "derived",
      "container",
      "none",
    ]);
  });
  it("never opens a pair for a kind with no truth of its own; bundles without truth keep theirs", () => {
    expect(opensPair(kinds, "Jet")).toBe(false);
    expect(opensPair(kinds, "Track")).toBe(true);
    expect(opensPair(kinds, "THit")).toBe(true);
    const noTruth = { ...kinds, display: kinds.display.filter((d) => !d.truth) } as unknown as Header;
    expect(opensPair(noTruth, "Jet")).toBe(true);
    // the pair is the candidates': a matched kind outside their chain (an ECAL cluster) does not open it
    const h = {
      ...kinds,
      relations: {
        ...kinds.relations,
        candTrack: rel("Cand", "Track"),
        candPF: rel("PFCand", "Cl"),
        clTruth: rel("Cl", "P", { association: true, match: { measure: "energy", in: "ECAL", shared: "e" } }),
      },
      display: [...kinds.display, { table: "Cl", repr: "markers" }],
    } as unknown as Header;
    const reco = { Cand: "identity", Track: { relation: "candTrack" }, Cl: { relation: "candPF" } } as const; // Cl's step leads nowhere
    expect(opensPair(h, "Track", undefined, reco)).toBe(true);
    expect(opensPair(h, "Cl", undefined, reco)).toBe(false);
    expect(opensPair(h, "Vtx", undefined, reco)).toBe(false);
  });
  it("takes a vertex's purity from its weight", () => {
    const vev = {
      ...ev,
      tables: { Vtx: { n: 1, columns: {} } },
      relations: { vtxTruth: csr([[0, 1]], { fraction: [0.8, 0.2], score: [0.2, 0.8] }) },
    } as unknown as EventData;
    expect(quality(vev, kinds, "vtxTruth", 0, 0)).toMatchObject({
      purity: expect.closeTo(0.8),
      score: expect.closeTo(0.2),
      clean: true,
    });
    expect(quality(vev, kinds, "vtxTruth", 1, 0)).toMatchObject({ purity: expect.closeTo(0.2), clean: false });
  });
  it("sums simulated energy per detector, never across detectors", () => {
    const sev = {
      ...ev,
      tables: { P: { n: 2, columns: {} }, Hit: { n: 2, columns: {} }, MHit: { n: 1, columns: {} } },
      relations: {
        truthHits: csr([[0], [1]], { simEnergy: [3, 1] }),
        truthMHits: csr([[0], []], { simEnergy: [0.002] }),
      },
    } as unknown as EventData;
    const groups = simEnergyByParticle(
      sev,
      kinds,
      new Map([
        ["Hit", new Set([0, 1])],
        ["MHit", new Set([0])],
      ]),
      () => true,
    );
    expect(groups.map((g) => [g.in, g.total, g.particles])).toEqual([
      [
        "HGCal",
        4,
        [
          [0, 3],
          [1, 1],
        ],
      ],
      ["Muons", expect.closeTo(0.002), [[0, expect.closeTo(0.002)]]],
    ]);
  });
  it("names the simulation's unit of a hit where it is coarser than the hit", () => {
    const h = {
      ...kinds,
      relations: {
        ...kinds.relations,
        truthMHits: {
          ...kinds.relations.truthMHits,
          fact: { in: "Muon", unit: { column: "subdet", names: { "1": "DT wire", "2": "CSC layer" } } },
        },
      },
    } as unknown as Header;
    const f = facts(h).find((x) => x.to === "MHit")!;
    expect(factUnit(f, { subdet: Uint8Array.from([1, 2]) }, 1)).toBe("CSC layer");
    expect(truthStatus(h, "MHit")).toMatchObject({ kind: "fact", in: "Muon", unit: { column: "subdet" } });
    expect(factUnit(facts(kinds).find((x) => x.to === "Hit")!, {}, 0)).toBeUndefined(); // the hit itself
  });
});
