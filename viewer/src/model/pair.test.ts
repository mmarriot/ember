import { describe, expect, it } from "vitest";
import type { DisplayLayer, EventData, Header } from "../io/bundle";
import { modeColouring, modeRoots } from "./modes";
import { PAIR, pairFor, pairShows } from "./pair";

// Candidates: 0 holds clusters 0, 1; 1 holds cluster 2. Clusters -> hits: 0 -> 0, 1; 1 -> 2; 2 -> 3; 3 -> 4 (in no
// candidate). Hit 5 is in no cluster. Particles: 0 left hits 0, 1, 3, 4; 1 left hits 2, 5. Matches: candidate 0 <->
// particle 0, candidate 1 <-> particle 1.
const csr = (rows: number[][], weights: Record<string, number[]> = {}) => ({
  offsets: Uint32Array.from(rows.reduce((o, r) => [...o, o[o.length - 1] + r.length], [0])),
  indices: Uint32Array.from(rows.flat()),
  weights: Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, Float32Array.from(v)])),
});
const ev = {
  id: [1, 1, 1],
  tables: {
    Cand: { n: 2, columns: {} },
    LC: { n: 4, columns: {} },
    P: { n: 2, columns: { energy: Float32Array.from([50, 20]) } },
    Hit: { n: 6, columns: { energy: Float32Array.from([1, 1, 1, 1, 1, 1]) } },
  },
  relations: {
    candLCs: csr([[0, 1], [2]]),
    lcHits: csr([[0, 1], [2], [3], [4]]),
    truthHits: csr(
      [
        [0, 1, 3, 4],
        [2, 5],
      ],
      { simEnergy: [1, 1, 1, 1, 1, 1] },
    ),
    candTruth: csr([[0], [1]], { score: [0, 0] }),
    truthCand: csr([[0, 1], [1]], { sharedFraction: [0.5, 0.25, 0.9] }),
  },
} as unknown as EventData;
const rel = (from: string, to: string, extra = {}) => ({ from, to, weights: [], ...extra });
const header = {
  relations: {
    candLCs: rel("Cand", "LC"),
    lcHits: rel("LC", "Hit"),
    truthHits: rel("P", "Hit", {
      weights: ["simEnergy"],
      association: true,
      best: { weight: "simEnergy", order: "max" },
    }),
    candTruth: rel("Cand", "P", { weights: ["score"], association: true, best: { weight: "score", order: "min" } }),
    truthCand: rel("P", "Cand", {
      weights: ["sharedFraction"],
      association: true,
      best: { weight: "sharedFraction", order: "max" },
    }),
  },
  display: [
    { table: "Hit", repr: "cells" },
    { table: "LC", repr: "markers" },
    { table: "Cand", repr: "ellipsoids", stage: 0 },
    { table: "P", repr: "segments", truth: true, colour: "energy" },
  ] as DisplayLayer[],
} as unknown as Header;
const roots = modeRoots(header) as { truth: string; reco: string };
const colourings = { truth: modeColouring(header, roots.truth), reco: modeColouring(header, roots.reco) };
const pair = (table: string, row: number) => pairFor(ev, header, { table, row }, roots, colourings, header.display[3]);
const cls = (p: ReturnType<typeof pair>, t: string) => [...p.classes.get(t)!];
const { other, matched, contamination, split, missed, reco } = PAIR;

describe("truth <-> reco pair", () => {
  it("is the same pair from the candidate, its particle, or a hit inside them", () => {
    for (const [t, r] of [
      ["Cand", 0],
      ["P", 0],
      ["Hit", 0],
      ["LC", 0],
    ] as const) {
      const p = pair(t, r);
      expect([p.particle, p.candidate]).toEqual([0, 0]);
    }
  });
  it("says where every object ended up", () => {
    const p = pair("Cand", 0);
    expect(cls(p, "Hit")).toEqual([matched, matched, contamination, split, missed, other]);
    expect(cls(p, "LC")).toEqual([matched, contamination, split, missed]);
    expect(cls(p, "Cand")).toEqual([matched, split]); // candidate 1 holds one of the particle's hits
    expect(cls(p, "P")).toEqual([matched, other]);
  });
  it("measures the particle's energy by where it went, and the candidate's purity", () => {
    const p = pair("P", 0);
    expect(p.efficiency).toEqual({ candidate: 2, others: 1, missed: 1 });
    expect(p.purity).toEqual({ particle: 2, other: 1 });
  });
  it("starts from the particle's best candidate when a particle is selected", () => {
    const p = pair("P", 1);
    expect([p.particle, p.candidate]).toEqual([1, 1]);
    expect(cls(p, "Hit")).toEqual([other, other, split, contamination, other, missed]);
  });
  it("gives a fragment candidate its particle's pair, and shows it as split", () => {
    // candidate 2 holds cluster 0 too (shared with candidate 0) and is matched to particle 0, whose best is candidate 0
    const fev = {
      ...ev,
      tables: { ...ev.tables, Cand: { n: 3, columns: {} } },
      relations: {
        ...ev.relations,
        candLCs: csr([[0, 1], [2], [0]]),
        candTruth: csr([[0], [1], [0]], { score: [0, 0, 0.5] }),
      },
    } as unknown as EventData;
    const p = pairFor(fev, header, { table: "Cand", row: 2 }, roots, colourings, header.display[3]);
    expect([p.particle, p.candidate]).toEqual([0, 0]);
    expect([...p.classes.get("Cand")!]).toEqual([matched, split, split]);
  });
  it("counts what a candidate shares with a lower-row candidate as in it", () => {
    // candidate 2 is a duplicate of candidate 1 (cluster 2) and particle 1's best candidate
    const dev = {
      ...ev,
      tables: { ...ev.tables, Cand: { n: 3, columns: {} } },
      relations: {
        ...ev.relations,
        candLCs: csr([[0, 1], [2], [2]]),
        candTruth: csr([[0], [1], [1]], { score: [0, 0, 0] }),
        truthCand: csr(
          [
            [0, 1],
            [1, 2],
          ],
          { sharedFraction: [0.5, 0.25, 0.9, 0.95] },
        ),
      },
    } as unknown as EventData;
    const p = pairFor(dev, header, { table: "Cand", row: 2 }, roots, colourings, header.display[3]);
    expect([p.particle, p.candidate]).toEqual([1, 2]);
    expect(cls(p, "Hit")).toEqual([other, other, split, contamination, other, missed]); // hit 3: in candidate 2, from particle 0
  });
  it("without truth, shows the candidate's own objects as in it, not as matched", () => {
    const h = { ...header, display: header.display.slice(0, 3) } as unknown as Header;
    const p = pairFor(ev, h, { table: "Cand", row: 0 }, { reco: "Cand" }, { reco: modeColouring(h, "Cand") });
    expect([p.particle, p.candidate]).toEqual([-1, 0]);
    expect(cls(p, "Hit")).toEqual([reco, reco, reco, other, other, other]);
    expect(cls(p, "Cand")).toEqual([reco, other]);
    expect(p.purity).toBeUndefined();
  });
  it("for a particle above the level, stands for the generator particles below it", () => {
    // particle 2 (a π⁰, not in the level) decays to 0 and 1 (photons, in the level); candidate 0 is matched to the π⁰
    const lev = {
      ...ev,
      tables: {
        ...ev.tables,
        P: { n: 3, columns: { energy: Float32Array.from([50, 20, 70]), flags: Uint32Array.from([4, 4, 0]) } },
      },
      relations: {
        ...ev.relations,
        kids: csr([[], [], [0, 1]]),
        truthHits: csr([[0, 1, 3, 4], [2, 5], []], { simEnergy: [1, 1, 1, 1, 1, 1] }),
        candTruth: csr([[2], [1]], { score: [0, 0] }),
        truthCand: csr([[0], [1], [0]], { sharedFraction: [0.5, 0.9, 0.7] }),
      },
    } as unknown as EventData;
    const lh = {
      ...header,
      relations: { ...header.relations, kids: rel("P", "P") },
      display: [...header.display.slice(0, 3), { ...header.display[3], particle: { flags: "flags", bit: 2 } }],
    } as unknown as Header;
    const p = pairFor(
      lev,
      lh,
      { table: "Cand", row: 0 },
      roots,
      { truth: modeColouring(lh, "P"), reco: modeColouring(lh, "Cand") },
      lh.display[3],
    );
    expect([p.particle, p.candidate, p.merged.sort()]).toEqual([2, 0, [0, 1]]);
    expect(cls(p, "Hit")).toEqual([matched, matched, matched, split, missed, missed]); // hit 2 is photon 1's: in the pair too
    // selecting the π⁰ itself gives the same pair: its generator particles, not the π⁰ and its intermediates
    const q = pairFor(
      lev,
      lh,
      { table: "P", row: 2 },
      roots,
      { truth: modeColouring(lh, "P"), reco: modeColouring(lh, "Cand") },
      lh.display[3],
    );
    expect([q.particle, q.merged.sort()]).toEqual([2, [0, 1]]);
  });
  it("has nothing to show for a particle without hits or candidate (e.g. one that never reached the calorimeter)", () => {
    const tev = {
      ...ev,
      tables: { ...ev.tables, P: { n: 3, columns: { energy: Float32Array.from([50, 20, 5]) } } },
      relations: {
        ...ev.relations,
        truthHits: csr([[0, 1, 3, 4], [2, 5], []], { simEnergy: [1, 1, 1, 1, 1, 1] }),
        truthCand: csr([[0, 1], [1], []], { sharedFraction: [0.5, 0.25, 0.9] }),
      },
    } as unknown as EventData;
    expect(pairShows(pairFor(tev, header, { table: "P", row: 2 }, roots, colourings, header.display[3]))).toBe(false);
    expect(pairShows(pairFor(tev, header, { table: "P", row: 1 }, roots, colourings, header.display[3]))).toBe(true);
  });
  it("counts only the hits of the candidates' detector: never sums simulated energy across detectors", () => {
    // particle 0 also left 100 (simulated) in two ECAL hits; the candidates are HGCal objects
    const eev = {
      ...ev,
      tables: { ...ev.tables, EB: { n: 2, columns: { energy: Float32Array.from([5, 5]) } } },
      relations: { ...ev.relations, truthEB: csr([[0, 1], []], { simEnergy: [60, 40] }) },
    } as unknown as EventData;
    const facts = (h: Header) =>
      ({
        ...h,
        relations: {
          ...h.relations,
          truthHits: { ...h.relations.truthHits, fact: { in: "HGCal" } },
          truthEB: rel("P", "EB", {
            weights: ["simEnergy"],
            association: true,
            best: { weight: "simEnergy", order: "max" },
            fact: { in: "ECAL" },
          }),
          candTruth: { ...h.relations.candTruth, match: { measure: "energy", in: "HGCal", shared: "x" } },
        },
        display: [...h.display, { table: "EB", repr: "cells" }],
      }) as unknown as Header;
    const eh = facts(header),
      c = { truth: modeColouring(eh, "P", true), reco: modeColouring(eh, "Cand") };
    const p = pairFor(eev, eh, { table: "P", row: 0 }, roots, c, eh.display[3]);
    expect(p.efficiency).toEqual({ candidate: 2, others: 1, missed: 1 }); // as without the ECAL hits
    expect(p.purity).toEqual({ particle: 2, other: 1 });
  });
});
