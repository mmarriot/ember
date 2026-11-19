import { describe, expect, it } from "vitest";
import type { DisplayLayer, EventData, Header } from "../io/format";
import { matchClass, matchTally, recoLadder, recoOfTruth, type Ladder } from "./chain";
import { truthStatus, type TruthStatus } from "./match";
import { relatedParts } from "./relations";

// jet 0 -> PF candidates 0, 1; PF 0 -> track 0 and candidate 0; PF 1 -> track 1; candidate 0 -> track 0,
// interpretation 0 -> layer clusters 0, 2 -> hits 0, 1, 3; trackster 1 holds clusters 0, 2 (named by no relation of the
// candidate), trackster 0 cluster 1; a secondary vertex is made of tracks 0 and 1. Truth: particle 0 is matched by
// track 0 (8 of its 10 hits), particle 1 by nothing; both left energy in hits.
const csr = (rows: number[][], weights: Record<string, number[]> = {}) => ({
  offsets: Uint32Array.from(rows.reduce((o, r) => [...o, o[o.length - 1] + r.length], [0])),
  indices: Uint32Array.from(rows.flat()),
  weights: Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, Float32Array.from(v)])),
});
const table = (n: number, columns: Record<string, number[]> = {}) => ({
  n,
  columns: Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, Float32Array.from(v)])),
});
const ev = {
  id: [1, 1, 1],
  tables: {
    Jet: table(1),
    PF: table(2),
    Trk: table(2, { nhits: [10, 5] }),
    Cand: table(1),
    Inter: table(1),
    T: table(2),
    LC: table(3),
    Hit: table(4),
    P: table(2),
    SV: table(1),
  },
  relations: {
    jetPF: csr([[0, 1]]),
    pfTrk: csr([[0], [1]]),
    pfCand: csr([[0], []]),
    candTrk: csr([[0]]),
    candInter: csr([[0]]),
    interLCs: csr([[0, 2]]),
    tLCs: csr([[1], [0, 2]]),
    candLCs: csr([[0, 2]]),
    lcHits: csr([[0, 1], [2], [3]]),
    svTrk: csr([[0, 1]]),
    trkTruth: csr([[0], []], { shared: [8], score: [0.2] }),
    truthTrk: csr([[0], []], { frac: [0.6] }),
    truthHits: csr(
      [
        [0, 1],
        [1, 3],
      ],
      { simEnergy: [3, 1, 1, 2] },
    ),
  },
} as unknown as EventData;
const plain = (from: string, to: string) => ({ from, to, weights: [] });
const layer = (table: string, group: string, extra: Partial<DisplayLayer> = {}) =>
  ({
    table,
    group,
    label: group,
    kind: group,
    repr: "markers",
    visible: true,
    position: ["x", "y", "z"],
    ...extra,
  }) as DisplayLayer;
const header = {
  relations: {
    jetPF: plain("Jet", "PF"),
    pfTrk: plain("PF", "Trk"),
    pfCand: plain("PF", "Cand"),
    candTrk: plain("Cand", "Trk"),
    candInter: plain("Cand", "Inter"),
    interLCs: plain("Inter", "LC"),
    tLCs: plain("T", "LC"),
    candLCs: plain("Cand", "LC"),
    lcHits: plain("LC", "Hit"),
    svTrk: plain("SV", "Trk"),
    trkTruth: {
      from: "Trk",
      to: "P",
      weights: ["shared", "score"],
      association: true,
      best: { weight: "score", order: "min" },
      match: { measure: "hits", in: "tracker", shared: "shared", over: ["nhits"], good: 0.75 },
    },
    truthTrk: {
      from: "P",
      to: "Trk",
      weights: ["frac"],
      association: true,
      best: { weight: "frac", order: "max" },
      match: { measure: "hits", in: "tracker", completeness: { weight: "frac" } },
    },
    truthHits: {
      from: "P",
      to: "Hit",
      weights: ["simEnergy"],
      association: true,
      best: { weight: "simEnergy", order: "max" },
      fact: { in: "HGCal" },
    },
  },
  display: [
    layer("Hit", "Hits", { repr: "cells" }),
    layer("LC", "Layer clusters", { truthGap: { reason: "no associator", gap: 1 } }),
    layer("T", "Tracksters", { stage: 0 }),
    layer("Inter", "Interpretations", { stage: 2 }),
    layer("Cand", "Candidates", { stage: 3 }),
    layer("Trk", "Tracks", { repr: "helix" }),
    layer("P", "Particles", { truth: true }),
    layer("PF", "PF candidates", { truthGap: { reason: "no PF associator", gap: 20 } }),
    layer("Jet", "Jets", { truthGap: { reason: "no jet associator", gap: 21 } }),
    layer("SV", "Secondary vertices"),
  ],
} as unknown as Header;
const statuses = new Map(
  header.display.flatMap((d) => {
    const s = truthStatus(header, d.table);
    return s ? [[d.table, s] as [string, TruthStatus]] : [];
  }),
);
const ladder = (table: string, row: number) =>
  recoLadder(ev, header, { table, row }, relatedParts(ev, header, { table, row }), statuses);
const kinds = (l: Ladder) => ({
  above: l.above.map((r) => r.kind),
  below: l.below.map((r) => `${r.kind} ${r.count}`),
  beside: l.beside.map((r) => r.kind),
});

describe("recoLadder", () => {
  it("reads down the chain: what holds the object above it, what it is made of below, holders first", () => {
    expect(kinds(ladder("Cand", 0))).toEqual({
      above: ["Jets", "PF candidates"],
      below: ["Interpretations 1", "Tracks 1", "Tracksters 1", "Layer clusters 2", "Hits 3"],
      beside: [],
    });
  });
  it("never lists what contains the object as one of its parts (a PF candidate made of the candidate and its track)", () => {
    expect(ladder("Cand", 0).below.some((r) => r.kind === "PF candidates")).toBe(false);
  });
  it("puts beside the object what is only built from its parts, not named by its relations (a jet's secondary vertex)", () => {
    const l = kinds(ladder("Jet", 0));
    expect(l.beside).toEqual(["Secondary vertices"]);
    expect(l.below[0]).toBe("PF candidates 2");
    expect(l.below).toContain("Tracks 2");
  });
  it("finds the later steps holding an object that no relation names, and says how many of its parts they hold", () => {
    const up = ladder("T", 1).above;
    expect(up.map((r) => [r.kind, r.groups[0].rows, r.groups[0].held])).toEqual([
      ["Candidates", [0], [2, 2]],
      ["Interpretations", [0], [2, 2]],
    ]);
  });
  it("does not call a later step that holds less than half of an object's parts its holder", () => {
    // trackster 0 is made of cluster 1 alone, which no candidate or interpretation holds
    expect(ladder("T", 0).above).toEqual([]);
  });
  it("under a kind with no truth of its own, counts its parts' own matches but ranks no particle through them", () => {
    const l = ladder("Jet", 0),
      link = (kind: string) => l.below.find((r) => r.kind === kind)!.links;
    expect(link("Tracks")).toEqual([
      {
        kind: "match",
        truth: "P",
        measure: "hits",
        good: 0.75,
        of: 2,
        matched: 1,
        clean: 1,
        partners: [],
        purity: undefined,
      },
    ]);
    expect(link("Hits")).toEqual([{ kind: "fact", in: "HGCal", truth: "P", total: 0, particles: [], unranked: true }]);
    expect(link("PF candidates")).toEqual([{ kind: "none", reason: "no PF associator", gap: 20 }]);
    expect(l.self.links).toEqual([{ kind: "none", reason: "no jet associator", gap: 21 }]);
  });
  it("gives a kind with truth of its own its statement: a hit's particles by their share, a track's match and purity", () => {
    const [fact] = ladder("Hit", 1).self.links;
    expect(fact).toMatchObject({ kind: "fact", in: "HGCal", truth: "P", total: 2 });
    expect(fact.kind === "fact" && fact.particles).toEqual([
      [0, 0.5],
      [1, 0.5],
    ]);
    expect(ladder("Trk", 0).self.links).toEqual([
      {
        kind: "match",
        truth: "P",
        measure: "hits",
        good: 0.75,
        of: 1,
        matched: 1,
        clean: 1,
        partners: [[0, 1]],
        purity: expect.closeTo(0.8),
      },
    ]);
    // one part alone speaks for itself, also under a kind with no truth (a candidate's track)
    expect(ladder("Cand", 0).below.find((r) => r.kind === "Tracks")!.links[0]).toMatchObject({
      kind: "match",
      matched: 1,
      partners: [[0, 1]],
    });
  });
  it("says so where a hit has no simulated energy from an exported particle", () => {
    expect(ladder("Hit", 2).self.links).toEqual([{ kind: "fact", in: "HGCal", truth: "P", total: 0, particles: [] }]);
  });
});

describe("recoLadder without display layers", () => {
  it("lists a related table the bundle does not draw apart, under its table's name (a hit's digi)", () => {
    const dev = {
      id: [1, 1, 1],
      tables: { Hit: table(2), Digi: table(2) },
      relations: { hitDigi: csr([[1], [0]]) },
    } as unknown as EventData;
    const dh = {
      relations: { hitDigi: plain("Hit", "Digi") },
      display: [layer("Hit", "Hits", { repr: "cells" })],
    } as unknown as Header;
    const l = recoLadder(dev, dh, { table: "Hit", row: 0 }, relatedParts(dev, dh, { table: "Hit", row: 0 }), new Map());
    expect([l.below, l.other.map((r) => [r.kind, r.groups])]).toEqual([[], [["Digi", [{ table: "Digi", rows: [1] }]]]]);
    const up = recoLadder(
      dev,
      dh,
      { table: "Digi", row: 1 },
      relatedParts(dev, dh, { table: "Digi", row: 1 }),
      new Map(),
    );
    expect([up.self.kind, up.above.map((r) => r.kind)]).toEqual(["Digi", ["Hits"]]);
  });

  it("does not list a table read only as a polyline's points (a muon track's hits): it is the track's shape", () => {
    const tev = {
      id: [1, 1, 1],
      tables: { Track: table(1), Points: table(3) },
      relations: { trackPoints: csr([[0, 1, 2]]) },
    } as unknown as EventData;
    const th = {
      relations: { trackPoints: plain("Track", "Points") },
      display: [layer("Track", "Muon tracks", { repr: "polyline", points: { relation: "trackPoints" } })],
    } as unknown as Header;
    const sel = { table: "Track", row: 0 };
    expect(recoLadder(tev, th, sel, relatedParts(tev, th, sel), new Map()).other).toEqual([]);
  });
});

describe("recoOfTruth", () => {
  it("lists what was reconstructed from a particle with its completeness, and the hits it left per detector", () => {
    expect(recoOfTruth(ev, header, { table: "P", row: 0 })).toEqual({
      reco: [
        {
          table: "Trk",
          measure: "hits",
          in: "tracker",
          partners: [{ row: 0, completeness: expect.closeTo(0.6), best: true, unmatched: false }],
        },
      ],
      hits: [{ in: "HGCal", hits: 2, energy: 4, weight: "simEnergy" }],
    });
  });
  it("keeps an empty entry where nothing of a matched kind was reconstructed", () => {
    expect(recoOfTruth(ev, header, { table: "P", row: 1 }).reco).toEqual([
      { table: "Trk", measure: "hits", in: "tracker", partners: [] },
    ]);
  });
});

describe("matchTally", () => {
  // tracks 0 (8 of 10 hits from its match), 1 (no match), 2 (3 of 6 hits: below the 75% of a clean track)
  const tev = {
    ...ev,
    tables: { ...ev.tables, Trk: table(3, { nhits: [10, 5, 6] }) },
    relations: { ...ev.relations, trkTruth: csr([[0], [], [1]], { shared: [8, 3], score: [0.2, 0.5] }) },
  } as unknown as EventData;
  it("sorts a kind's objects into clean, impure and unmatched by the associator's best match", () => {
    expect(matchTally(tev, header, "trkTruth", () => true)).toEqual({
      clean: [0],
      impure: [2],
      unmatched: [1],
      good: 0.75,
    });
  });
  it("counts only the objects that pass the layer's cut and filter", () => {
    expect(matchTally(tev, header, "trkTruth", (r) => r !== 1)).toMatchObject({
      clean: [0],
      impure: [2],
      unmatched: [],
    });
  });
  it("says the same of one object, and only that it is matched for a kind without a clean threshold", () => {
    expect([0, 1, 2].map((r) => matchClass(tev, header, "trkTruth", r))).toEqual(["clean", "unmatched", "impure"]);
    const loose = {
      ...header,
      relations: {
        ...header.relations,
        trkTruth: {
          ...header.relations.trkTruth,
          match: { measure: "hits", in: "tracker", shared: "shared", over: ["nhits"] },
        },
      },
    } as unknown as Header;
    expect([0, 1, 2].map((r) => matchClass(tev, loose, "trkTruth", r))).toEqual(["matched", "unmatched", "matched"]);
  });
  it("has nothing to say without the association in the event, or without a match contract", () => {
    expect(matchTally({ ...tev, relations: {} } as unknown as EventData, header, "trkTruth", () => true)).toBeNull();
    expect(matchTally(tev, header, "truthHits", () => true)).toBeNull();
  });
});
