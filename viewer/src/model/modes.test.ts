import { describe, expect, it } from "vitest";
import type { Header } from "../io/bundle";
import { modeColouring, modeRoots, reachesRoot, recoColourOf } from "./modes";
import all from "./fixtures/all_header.json";
import { truthStatus } from "./match";
import cms from "./fixtures/cms_header.json";
import cmsColourings from "./fixtures/cms_colourings.json";

// The shape of the hgcal profile: candidates -> interpretations, layer clusters, tracks; tracksters -> layer clusters;
// layer clusters -> hits; truth particles -> hits, children; associations reco <-> truth both ways.
const rel = (from: string, to: string, extra = {}) => ({ from, to, weights: [], ...extra });
const assoc = (from: string, to: string, weight: string, order: "min" | "max") =>
  rel(from, to, { association: true, best: { weight, order } });
const header = {
  relations: {
    candInterp: rel("Cand", "Interp"),
    candLCs: rel("Cand", "LC"),
    candTrack: rel("Cand", "Track"),
    interpLCs: rel("Interp", "LC"),
    tLCs: rel("T", "LC"),
    lcHits: rel("LC", "Hit"),
    kids: rel("P", "P"),
    decay: rel("P", "V"),
    tTruth: assoc("T", "P", "score", "min"),
    truthT: assoc("P", "T", "sharedFraction", "max"),
    candTruth: assoc("Cand", "P", "score", "min"),
    truthCand: assoc("P", "Cand", "sharedFraction", "max"),
    truthHits: assoc("P", "Hit", "simEnergy", "max"),
  },
  display: [
    { table: "Hit", repr: "cells" },
    { table: "LC", repr: "markers" },
    { table: "T", repr: "ellipsoids", stage: 0 },
    { table: "Interp", repr: "ellipsoids", stage: 1 },
    { table: "Cand", repr: "ellipsoids", stage: 2 },
    { table: "Track", repr: "segments", stage: 2 },
    { table: "P", repr: "segments", truth: true },
    { table: "V", repr: "markers", truth: true },
  ],
} as unknown as Header;

describe("colour modes", () => {
  it("builds truth mode on the particles and reco mode on the candidates (not the tracks of the same stage)", () => {
    expect(modeRoots(header)).toEqual({ truth: "P", reco: "Cand" });
    expect(modeRoots({ ...header, display: header.display.filter((d) => !d.truth) })).toEqual({ reco: "Cand" });
  });
  it("truth mode: reco objects by their own best match, hits by particle, layer clusters from their hits", () => {
    expect(modeColouring(header, "P", true)).toEqual({
      P: "identity",
      Hit: { relation: "truthHits" },
      LC: { content: "P" },
      T: { relation: "tTruth" },
      Cand: { relation: "candTruth" },
      Interp: { relation: "candInterp" },
      Track: { relation: "candTrack" },
      V: { relation: "decay" },
    });
  });
  it("reco mode: follows what the candidate is made of; truth particles by the candidate that reconstructs them", () => {
    expect(modeColouring(header, "Cand")).toEqual({
      Cand: "identity",
      Interp: { relation: "candInterp" },
      LC: { relation: "candLCs" },
      Track: { relation: "candTrack" },
      Hit: { relation: "lcHits" },
      T: { content: "Cand" },
      P: { relation: "truthCand" },
      V: { relation: "decay" }, // T: by vote
    });
  });
  it("does not colour a container outside the reconstruction chain (a vertex) by what its parts belong to", () => {
    const h = {
      ...header,
      relations: {
        ...header.relations,
        vtxTracks: rel("Vtx", "Track"),
        trackVtx: rel("Track", "Vtx"),
        trackHits: rel("Track", "THit"),
      },
      display: [...header.display, { table: "Vtx", repr: "markers" }, { table: "THit", repr: "markers" }],
    } as unknown as Header;
    const reco = modeColouring(h, "Cand");
    expect(reco.Vtx).toBeUndefined();
    expect(reco.THit).toEqual({ relation: "trackHits" }); // a track's hits take its candidate's colour
    expect(modeColouring(h, "P").Vtx).toBeUndefined();
  });

  // docs/truth.md "Constituents": by truth, an object is coloured only by its own match or its container's.
  const physics = {
    relations: {
      jetCands: rel("Jet", "PFCand"),
      candTrack: rel("PFCand", "Track"),
      trackHits: rel("Track", "THit"),
      muonTrack: rel("Muon", "Track"),
      muonSegs: rel("Muon", "Seg"),
      segHits: rel("Seg", "MHit"),
      clHits: rel("MTDCl", "MTDHit"),
      trackTruth: assoc("Track", "P", "score", "min"),
      truthTrack: assoc("P", "Track", "sharedFraction", "max"),
      truthMHits: { ...assoc("P", "MHit", "simEnergy", "max"), fact: { in: "Muons" } },
      truthMTD: { ...assoc("P", "MTDHit", "simEnergy", "max"), fact: { in: "MTD" } },
    },
    display: [
      { table: "Jet", repr: "segments", stage: 4, truthGap: { reason: "no jet associator in CMSSW", gap: 21 } },
      {
        table: "PFCand",
        repr: "helix",
        stage: 3,
        truthGap: { reason: "no PF-candidate associator in CMSSW", gap: 20 },
      },
      { table: "Muon", repr: "helix", stage: 3, truthGap: { reason: "no muon associator in CMSSW", gap: 18 } },
      {
        table: "Seg",
        repr: "segments",
        stage: 2,
        truthGap: { reason: "no muon-segment associator in CMSSW", gap: 17 },
      },
      {
        table: "MTDCl",
        repr: "markers",
        stage: 2,
        truthGap: { reason: "no MTD-cluster associator in CMSSW", gap: 19 },
      },
      { table: "Track", repr: "helix", stage: 2 },
      { table: "THit", repr: "markers" },
      { table: "MHit", repr: "markers" },
      { table: "MTDHit", repr: "markers" },
      { table: "P", repr: "helix", truth: true },
    ],
  } as unknown as Header;
  it("truth mode: a composite never takes a part's match, a vote through hits, or a dangling container colour", () => {
    const c = modeColouring(physics, "P", true);
    for (const t of ["Jet", "PFCand", "Muon", "Seg", "MTDCl"]) expect(c[t]).toBeUndefined();
    expect(c).toMatchObject({
      Track: { relation: "trackTruth" },
      THit: { relation: "trackHits" },
      MHit: { relation: "truthMHits" },
      MTDHit: { relation: "truthMTD" },
    });
    // without truthGap hints the staged composites still cannot climb to their parts' matches
    const plain = { ...physics, display: physics.display.map(({ truthGap: _, ...d }) => d) } as unknown as Header;
    const p = modeColouring(plain, "P", true);
    for (const t of ["Jet", "PFCand", "Muon"]) expect(p[t]).toBeUndefined();
  });
  it("truth mode: a vertex matched to a truth vertex stays neutral (no colour from what decays there)", () => {
    const h = {
      ...physics,
      relations: {
        ...physics.relations,
        decay: rel("P", "TV"),
        vtxTruth: assoc("Vtx", "TV", "score", "min"),
        truthVtx: assoc("TV", "Vtx", "fraction", "max"),
      },
      display: [...physics.display, { table: "Vtx", repr: "markers" }, { table: "TV", repr: "markers", truth: true }],
    } as unknown as Header;
    expect(modeColouring(h, "P", true).Vtx).toBeUndefined();
  });
  it("truth mode: a part of a matched container takes its colour; a part of an uncoloured composite does not", () => {
    const h = {
      ...physics,
      relations: { ...physics.relations, candHit: rel("PFCand", "CHit") },
      display: [...physics.display, { table: "CHit", repr: "markers" }],
    } as unknown as Header;
    const c = modeColouring(h, "P", true);
    expect(c.THit).toEqual({ relation: "trackHits" });
    expect(c.CHit).toBeUndefined();
  });
  it("truth mode: the vote by content only for a kind that opts in, or in a bundle made before truthGap", () => {
    expect(modeColouring(header, "P", true).LC).toEqual({ content: "P" }); // no truthGap anywhere: as before
    const gap = (derived?: "content") =>
      ({
        ...header,
        display: header.display.map((d) =>
          d.table === "LC" ? { ...d, truthGap: { reason: "no layer-cluster associator", gap: 1, derived } } : d,
        ),
      }) as unknown as Header;
    expect(modeColouring(gap("content"), "P", true).LC).toEqual({ content: "P" });
    expect(modeColouring(gap(), "P", true).LC).toBeUndefined();
  });
  it("leaves the colourings of today's cms bundle unchanged", () => {
    const h = cms as unknown as Header,
      roots = modeRoots(h);
    expect(roots).toEqual(cmsColourings.roots);
    expect(modeColouring(h, roots.truth!, true)).toEqual(cmsColourings.truth);
    expect(modeColouring(h, roots.reco!)).toEqual(cmsColourings.reco);
  });
  // The all-detectors bundle (physics objects, calorimeters, muons, vertices with truth vertices).
  it("all-detectors bundle: by truth, no kind with a truthGap and no vertex takes a particle colour", () => {
    const h = all as unknown as Header,
      roots = modeRoots(h),
      c = modeColouring(h, roots.truth!, true);
    expect(c).toMatchSnapshot();
    const none = h.display.filter((d) => truthStatus(h, d.table, c)?.kind === "none").map((d) => d.table);
    expect(none).toEqual(
      expect.arrayContaining(["Jets", "Muons", "MuonSegments", "PFCandidates", "PFClustersHF", "PuppiMET"]),
    );
    for (const t of none) expect([t, c[t]]).toEqual([t, undefined]);
    for (const t of ["Vertices", "SecondaryVertices"]) expect(c[t]).toBeUndefined();
  });
  it("all-detectors bundle: the candidate-type colours reach only layers whose chain ends at the candidates", () => {
    const h = all as unknown as Header,
      roots = modeRoots(h),
      c = modeColouring(h, roots.reco!);
    expect(c).toMatchSnapshot();
    const pid = Object.fromEntries(
      h.display.map((d) => [d.table, recoColourOf(h, c, roots.reco!, d.table)]).filter(([, x]) => x),
    );
    for (const t of Object.keys(pid)) expect([t, reachesRoot(h, c, t)]).toEqual([t, true]);
    for (const t of [
      "EcalHits",
      "HBHEHits",
      "PFClustersECAL",
      "PFClustersHCAL",
      "Muons",
      "MuonHits",
      "MuonSegments",
      "GsfTracks",
      "EGammaSuperClusters",
    ])
      expect([t, pid[t]]).toEqual([t, undefined]);
    expect(pid.HGCalSoARecHitsEE).toEqual({ relation: "lcSoAHitsEE" }); // HGCal keeps its candidate colours
  });
});
