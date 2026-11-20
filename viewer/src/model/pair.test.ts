import { describe, expect, it } from "vitest";
import type { DisplayLayer, EventData, Header } from "../io/format";
import { delegatedPart, PAIR, pairFor, pairShows } from "./pair";

// HGCal: tracksters K hold layer clusters: K0 -> LC0, LC1; K1 -> LC2; K2 -> LC0 (a fragment); K3 -> LC3 (unmatched).
// LC -> hits: LC0 -> H0, H1; LC1 -> H2; LC2 -> H3; LC3 -> H4. H5 is in no cluster.
// Truth: P4 (e.g. a pion that interacted in the tracker, no hits of its own) -> P0, P2, its products that entered the
// calorimeter; P1 -> P3 (inside P1's shower: no hits of its own). Hits: P0 left H0, H1, H4; P2 left H3; P1 left H2, H5. HF: hit F0 from P0, in an HF cluster without truth.
// Tracker: track T0 is P2's (a daughter's track); its hits TH0, TH1. A candidate C holds K0 (no association). A
// vertex V points at T0 and back (it is no part of anything). P3, inside P1's shower, has its own best: K2.
const csr = (rows: number[][], weights: Record<string, number[]> = {}) => ({
  offsets: Uint32Array.from(rows.reduce((o, r) => [...o, o[o.length - 1] + r.length], [0])),
  indices: Uint32Array.from(rows.flat()),
  weights: Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, Float32Array.from(v)])),
});
const ev = {
  id: [1, 1, 1],
  tables: {
    C: { n: 1, columns: {} },
    K: { n: 4, columns: { e: Float32Array.from([4, 1, 1, 1]) } },
    LC: { n: 4, columns: {} },
    Hit: { n: 6, columns: { energy: Float32Array.from([1, 1, 1, 1, 1, 1]) } },
    HFC: { n: 1, columns: {} },
    F: { n: 2, columns: { energy: Float32Array.from([1, 1]) } },
    T: { n: 1, columns: { nhits: Float32Array.from([2]) } },
    V: { n: 1, columns: {} },
    TH: { n: 2, columns: {} },
    P: { n: 5, columns: { energy: Float32Array.from([50, 20, 10, 5, 60]) } },
  },
  relations: {
    cK: csr([[0]]),
    kLC: csr([[0, 1], [2], [0], [3]]),
    lcHits: csr([[0, 1], [2], [3], [4]]),
    hfHits: csr([[0]]),
    tHits: csr([[0, 1]]),
    vTracks: csr([[0]]),
    trackV: csr([[0]]),
    kids: csr([[], [3], [], [], [0, 2]]),
    truthHits: csr([[0, 1, 4], [2, 5], [3], [], []], { simEnergy: [1, 1, 1, 1, 1, 1] }),
    truthF: csr([[0], [], [], [], []], { simEnergy: [2] }),
    kTruth: csr([[0], [2], [0], []], { score: [0, 0, 0.5], shared: [2, 1, 1] }),
    truthK: csr([[0, 2], [0], [1], [2], []], { f: [0.6, 0.1, 0.3, 0.9, 0.2] }), // P3's own best: K2
    tTruth: csr([[2]], { score: [0], nShared: [2] }),
    truthT: csr([[], [], [0], [], []], { nShared: [2] }),
  },
} as unknown as EventData;
const rel = (from: string, to: string, extra = {}) => ({ from, to, weights: [], ...extra });
const fact = (from: string, to: string, where: string) =>
  rel(from, to, {
    weights: ["simEnergy"],
    association: true,
    fact: { in: where },
    best: { weight: "simEnergy", order: "max" },
  });
const header = {
  relations: {
    cK: rel("C", "K"),
    kLC: rel("K", "LC"),
    lcHits: rel("LC", "Hit"),
    hfHits: rel("HFC", "F"),
    tHits: rel("T", "TH"),
    vTracks: rel("V", "T"),
    trackV: rel("T", "V", { inverseOf: "vTracks" }),
    kids: rel("P", "P"),
    truthHits: fact("P", "Hit", "HGCal"),
    truthF: fact("P", "F", "HF"),
    kTruth: rel("K", "P", {
      weights: ["score", "shared"],
      association: true,
      best: { weight: "score", order: "min" },
      match: { measure: "energy", in: "HGCal", shared: "shared", over: ["e"], good: 0.5 },
    }),
    truthK: rel("P", "K", { weights: ["f"], association: true, best: { weight: "f", order: "max" } }),
    tTruth: rel("T", "P", {
      weights: ["score", "nShared"],
      association: true,
      best: { weight: "score", order: "min" },
      match: { measure: "hits", in: "tracker", shared: "nShared", over: ["nhits"], good: 0.75 },
    }),
    truthT: rel("P", "T", { weights: ["nShared"], association: true, best: { weight: "nShared", order: "max" } }),
  },
  display: [
    { table: "Hit", repr: "cells" },
    { table: "F", repr: "cells" },
    { table: "HFC", repr: "markers", truthGap: { reason: "no HF cluster associator", gap: 15 } },
    { table: "LC", repr: "markers", truthGap: { reason: "no layer-cluster associator", gap: 1 } },
    { table: "K", repr: "ellipsoids", stage: 0 },
    { table: "C", repr: "ellipsoids", stage: 1, truthGap: { reason: "no candidate associator" } },
    { table: "T", repr: "helix" },
    { table: "TH", repr: "markers" },
    { table: "V", repr: "markers" },
    { table: "P", repr: "segments", truth: true, colour: "energy" },
  ] as DisplayLayer[],
} as unknown as Header;
const pair = (table: string, row: number) => pairFor(ev, header, { table, row }, "P")!;
const cls = (p: ReturnType<typeof pair>, t: string) => [...p.classes.get(t)!];
const det = (p: ReturnType<typeof pair>, where: string) => p.detectors.find((d) => d.in === where)!;
const { other, matched, contamination, split, missed, reco, branch, uncompared } = PAIR;

describe("truth <-> reco pair", () => {
  it("stands for the selected particle's branch, compared per detector with the kind matched there", () => {
    const p = pair("P", 4);
    expect([p.particle, p.hitsOf, p.owners]).toEqual([4, 4, [0, 2]]);
    const hg = det(p, "HGCal");
    expect([hg.kind, hg.matches.sort()]).toEqual(["K", [0, 1]]); // the best of each product that left hits
    expect(cls(p, "Hit")).toEqual([matched, matched, contamination, matched, split, other]); // H4: in unmatched K3
    expect(cls(p, "K")).toEqual([matched, matched, split, split]); // K2: matched to P0, not its best; K3 holds H4
    expect(cls(p, "LC")).toEqual([reco, reco, reco, other]); // no truth of their own: part of the match
    expect(cls(p, "P")).toEqual([branch, other, branch, other, matched]);
  });
  it("says which energy each number is: simulated in one detector, own or descendants', and the match's rechits", () => {
    const hg = det(pair("P", 4), "HGCal");
    expect(hg.sim).toEqual({ own: 0, descendants: 4, inMatch: 3, inOthers: 1, inNone: 0 }); // it entered no calorimeter
    expect(hg.reco).toEqual({ branch: 3, other: 1, noTruth: 0 });
    expect(det(pair("P", 0), "HGCal").sim).toEqual({ own: 3, descendants: 0, inMatch: 2, inOthers: 1, inNone: 0 });
  });
  it("shows a detector without an association as not compared, with why", () => {
    const p = pair("P", 4),
      hf = det(p, "HF");
    expect([hf.kind, hf.matches, hf.sim?.descendants]).toEqual([undefined, [], 2]); // never added to HGCal's
    expect(hf.gaps).toEqual([{ table: "HFC", reason: "no HF cluster associator", gap: 15 }]);
    expect(cls(p, "F")).toEqual([uncompared, other]);
    expect(p.classes.get("HFC")?.some((c) => c !== other) ?? false).toBe(false);
  });
  it("matches the tracks of the branch's particles in the tracker, their hits as part of the match", () => {
    const p = pair("P", 4);
    expect(det(p, "tracker").matches).toEqual([0]);
    expect([cls(p, "T"), cls(p, "TH")]).toEqual([[matched], [reco, reco]]);
  });
  it("never shows siblings or ancestors: a daughter's pair is its own branch", () => {
    const p = pair("P", 2);
    expect([p.particle, p.hitsOf, p.owners]).toEqual([2, 2, []]);
    expect(cls(p, "Hit")).toEqual([other, other, other, matched, other, other]);
    expect(det(p, "HGCal").matches).toEqual([1]);
    expect(p.detectors.some((d) => d.in === "HF")).toBe(false); // its sibling P0's HF hit is not its own
    expect(cls(p, "P")).toEqual([other, other, matched, other, other]); // neither its parent nor its sibling
  });
  it("for a particle inside another's shower, shows that shower's hits, and its own match first", () => {
    const p = pair("P", 3);
    expect([p.particle, p.hitsOf]).toEqual([3, 1]);
    expect(cls(p, "P")).toEqual([other, branch, other, matched, other]);
    expect(cls(p, "Hit")).toEqual([contamination, contamination, matched, other, other, missed]);
    expect(det(p, "HGCal").matches.sort()).toEqual([0, 2]); // its own best (K2) and its shower's (K0)
    expect(cls(p, "K")).toEqual([matched, other, matched, other]); // K1 is not the branch's: never split
  });
  it("keeps a matched object's pair when its particle left no hits in the file", () => {
    const oev = {
      ...ev,
      tables: { ...ev.tables, P: { n: 6, columns: { energy: Float32Array.from([50, 20, 10, 5, 60, 1]) } } },
      relations: {
        ...ev.relations,
        kids: csr([[], [3], [], [], [0, 2], []]),
        truthHits: csr([[0, 1, 4], [2, 5], [3], [], [], []], { simEnergy: [1, 1, 1, 1, 1, 1] }),
        truthF: csr([[0], [], [], [], [], []], { simEnergy: [2] }),
        kTruth: csr([[0], [2], [0], [5]], { score: [0, 0, 0.5, 0.1], shared: [2, 1, 1, 1] }),
        truthK: csr([[0, 2], [0], [1], [2], [], [3]], { f: [0.6, 0.1, 0.3, 0.9, 0.2, 0.4] }),
        truthT: csr([[], [], [0], [], [], []], { nShared: [2] }),
      },
    } as unknown as EventData;
    const p = pairFor(oev, header, { table: "K", row: 3 }, "P")!;
    expect([p.particle, p.hitsOf, pairShows(p)]).toEqual([5, -1, true]);
    const hg = p.detectors.find((d) => d.in === "HGCal")!;
    expect([hg.matches, hg.sim?.own, hg.sim?.descendants]).toEqual([[3], 0, 0]);
    expect([...p.classes.get("K")!]).toEqual([other, other, other, matched]);
  });
  it("opens no pair for a vertex (it only points at its tracks) and survives an event without an association", () => {
    expect(pairFor(ev, header, { table: "V", row: 0 }, "P")).toBeNull();
    const { truthK: _, ...rels } = ev.relations;
    const p = pairFor({ ...ev, relations: rels } as unknown as EventData, header, { table: "P", row: 4 }, "P")!;
    expect(det(p, "HGCal").matches).toEqual([]);
    expect(
      pairFor({ ...ev, relations: rels } as unknown as EventData, header, { table: "K", row: 0 }, "P")?.particle,
    ).toBe(0);
  });
  it("gives a reco object its best match's pair, and a fragment shows as split", () => {
    const p = pair("K", 2);
    expect([p.particle, p.from]).toEqual([0, { table: "K", row: 2 }]);
    expect(cls(p, "K")).toEqual([matched, other, split, split]); // K1 is its sibling P2's
    expect(pair("TH", 1).from).toEqual({ table: "T", row: 0 }); // a track's hit: the track's pair
    expect(pair("Hit", 2).particle).toBe(1); // a hit: the particle with the most simulated energy in it
  });
  it("shows an unmatched object alone, nothing confirmed, and opens no pair for a kind without an association", () => {
    const p = pair("K", 3);
    expect([p.particle, cls(p, "K"), cls(p, "LC"), cls(p, "Hit")]).toEqual([
      -1,
      [other, other, other, reco],
      [other, other, other, reco],
      [other, other, other, other, reco, other],
    ]);
    expect(pairShows(p)).toBe(true);
    expect(pairFor(ev, header, { table: "C", row: 0 }, "P")).toBeNull();
    expect(pairFor(ev, header, { table: "LC", row: 0 }, "P")).toBeNull();
  });
  it("has nothing to show for a particle without hits or matches", () => {
    const lone = {
      ...ev,
      tables: { ...ev.tables, P: { n: 6, columns: { energy: Float32Array.from([50, 20, 10, 5, 60, 1]) } } },
      relations: {
        ...ev.relations,
        kids: csr([[], [3], [], [], [0, 2], []]),
        truthHits: csr([[0, 1, 4], [2, 5], [3], [], [], []], { simEnergy: [1, 1, 1, 1, 1, 1] }),
        truthF: csr([[0], [], [], [], [], []], { simEnergy: [2] }),
        truthK: csr([[0, 2], [0], [1], [2], [], []], { f: [0.6, 0.1, 0.3, 0.9, 0.2] }),
        truthT: csr([[], [], [0], [], [], []], { nShared: [2] }),
      },
    } as unknown as EventData;
    expect(pairShows(pairFor(lone, header, { table: "P", row: 5 }, "P")!)).toBe(false);
  });
});

describe("a part's pair for an object with no truth of its own (D4, a trial)", () => {
  it("takes the one matched part of an earlier reconstruction step (a candidate's trackster)", () => {
    expect(delegatedPart(ev, header, { table: "C", row: 0 }, "P")).toEqual({ table: "K", row: 0 });
  });
  it("never when its matched parts disagree (its trackster on one particle, its track on another)", () => {
    // C also points at track T0, matched to P2 while its trackster K0 is matched to P0
    const ev2 = {
      ...ev,
      relations: {
        ...ev.relations,
        cT: { offsets: Uint32Array.from([0, 1]), indices: Uint32Array.from([0]), weights: {} },
      },
    } as EventData;
    const h2 = { ...header, relations: { ...header.relations, cT: rel("C", "T") } } as Header;
    expect(delegatedPart(ev2, h2, { table: "C", row: 0 }, "P")).toBeNull();
  });
  it("never for an object with truth of its own, nor for one that is no reconstruction step", () => {
    expect(delegatedPart(ev, header, { table: "K", row: 0 }, "P")).toBeNull();
    expect(delegatedPart(ev, header, { table: "V", row: 0 }, "P")).toBeNull();
  });
});
