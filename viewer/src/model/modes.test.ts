import { describe, expect, it } from "vitest";
import type { Header } from "../io/bundle";
import { modeColouring, modeRoots } from "./modes";

// The shape of the hgcal profile: candidates -> interpretations, layer clusters, tracks; tracksters -> layer clusters;
// layer clusters -> hits; truth particles -> hits, children; associations reco <-> truth both ways.
const rel = (from: string, to: string, extra = {}) => ({ from, to, weights: [], ...extra });
const assoc = (from: string, to: string, weight: string, order: "min" | "max") => rel(from, to, { association: true, best: { weight, order } });
const header = {
  relations: {
    candInterp: rel("Cand", "Interp"), candLCs: rel("Cand", "LC"), candTrack: rel("Cand", "Track"), interpLCs: rel("Interp", "LC"),
    tLCs: rel("T", "LC"), lcHits: rel("LC", "Hit"), kids: rel("P", "P"), decay: rel("P", "V"),
    tTruth: assoc("T", "P", "score", "min"), truthT: assoc("P", "T", "sharedFraction", "max"),
    candTruth: assoc("Cand", "P", "score", "min"), truthCand: assoc("P", "Cand", "sharedFraction", "max"),
    truthHits: assoc("P", "Hit", "simEnergy", "max"),
  },
  display: [
    { table: "Hit", repr: "cells" }, { table: "LC", repr: "markers" }, { table: "T", repr: "ellipsoids", stage: 0 },
    { table: "Interp", repr: "ellipsoids", stage: 1 }, { table: "Cand", repr: "ellipsoids", stage: 2 }, { table: "Track", repr: "segments", stage: 2 },
    { table: "P", repr: "segments", truth: true }, { table: "V", repr: "markers", truth: true },
  ],
} as unknown as Header;

describe("colour modes", () => {
  it("builds truth mode on the particles and reco mode on the candidates (not the tracks of the same stage)", () => {
    expect(modeRoots(header)).toEqual({ truth: "P", reco: "Cand" });
    expect(modeRoots({ ...header, display: header.display.filter((d) => !d.truth) })).toEqual({ reco: "Cand" });
  });
  it("truth mode: reco objects by their own best match, hits by particle, layer clusters from their hits", () => {
    expect(modeColouring(header, "P")).toEqual({
      P: "identity", Hit: { relation: "truthHits" }, LC: { content: "P" }, T: { relation: "tTruth" }, Cand: { relation: "candTruth" },
      Interp: { relation: "candInterp" }, Track: { relation: "candTrack" }, V: { relation: "decay" },
    });
  });
  it("reco mode: follows what the candidate is made of; truth particles by the candidate that reconstructs them", () => {
    expect(modeColouring(header, "Cand")).toEqual({
      Cand: "identity", Interp: { relation: "candInterp" }, LC: { relation: "candLCs" }, Track: { relation: "candTrack" },
      Hit: { relation: "lcHits" }, T: { relation: "tLCs" }, P: { relation: "truthCand" }, V: { relation: "decay" },
    });
  });
});
