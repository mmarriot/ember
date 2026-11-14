import { describe, expect, it } from "vitest";
import type { DisplayLayer } from "../io/bundle";
import { focusLevels, levelLayers, mergeAcrossDomains, scopeLevels, stepLevel } from "./levels";

// Display layers as a profile orders them, from the bottom up (hits first, candidates last), then truth.
const layer = (table: string, group: string, extra: Partial<DisplayLayer> = {}) =>
  ({
    table,
    group,
    label: table,
    kind: group.toLowerCase(),
    repr: "ellipsoids",
    position: ["x", "y", "z"],
    visible: false,
    ...extra,
  }) as DisplayLayer;
const display = [
  layer("Hit", "Hits", { repr: "cells", visible: true }),
  layer("LegacyHit", "Hits", { repr: "cells", alternative: true }),
  layer("Readout", "Detector", { repr: "cells", context: true, visible: true }),
  layer("LC", "Layer clusters", { repr: "markers", visible: true }),
  layer("T", "Tracksters", { stage: 0 }),
  layer("Link", "Linked tracksters", { stage: 1 }),
  layer("DNN", "Linked tracksters", { stage: 1 }),
  layer("I", "Interpretations", { stage: 2 }),
  layer("Cand", "Candidates", { stage: 3, visible: true }),
  layer("Track", "Tracks", { repr: "segments", stage: 3, visible: true }),
  layer("P", "Truth", { repr: "segments", truth: true, visible: true }),
];
const rows = (r: Record<string, number[]>) => new Map(Object.entries(r).map(([t, v]) => [t, new Set(v)]));
// A candidate's highlight: what it is made of, the tracksters inside it, its truth particle; the readout and the
// legacy hits have rows too, to check they are left out.
const candidate = rows({
  Cand: [0],
  Track: [1],
  I: [0],
  Link: [0, 1],
  DNN: [0],
  T: [2, 3],
  LC: [0, 1, 2],
  Hit: [0, 1, 2, 3],
  LegacyHit: [5],
  Readout: [0],
  P: [4],
});
const own = (t: string) => t !== "P"; // P is reached through an association only
const names = (lv: ReturnType<typeof focusLevels>) => lv.map((l) => `${l.name} ${l.count}`);

describe("focusLevels", () => {
  it("lists what a candidate is made of, top first, by kind", () => {
    const lv = focusLevels(display, "Cand", candidate, own);
    expect(names(lv)).toEqual([
      "Interpretations 1",
      "Linked tracksters 3",
      "Tracksters 2",
      "Layer clusters 3",
      "Hits 4",
    ]);
    expect(lv[1].layers.map((d) => d.table)).toEqual(["DNN", "Link"]); // one level per kind, all its layers
  });
  it("leaves out the focus's stage (its track), truth, background and alternative layers", () => {
    const tables = focusLevels(display, "Cand", candidate, own).flatMap((l) => l.layers.map((d) => d.table));
    for (const t of ["Cand", "Track", "P", "Readout", "LegacyHit"]) expect(tables).not.toContain(t);
  });
  it("starts below the focus: a trackster has layer clusters and hits", () => {
    expect(names(focusLevels(display, "T", rows({ T: [2], LC: [0, 1], Hit: [0, 1, 2] }), () => true))).toEqual([
      "Layer clusters 2",
      "Hits 3",
    ]);
  });
  it("has no levels for a hit, nor for kinds it has no objects in", () => {
    expect(focusLevels(display, "Hit", rows({ Hit: [0] }), () => true)).toEqual([]);
    expect(names(focusLevels(display, "Cand", rows({ Cand: [0], Track: [0], LC: [], Hit: [1] }), () => true))).toEqual([
      "Hits 1",
    ]);
  });
});

describe("focusLevels with relations", () => {
  // A candidate with tracksters down to hits, and a track down to its own hits (another branch, listed later).
  const branches = [
    ...display.filter((d) => d.table !== "Track"),
    layer("Trk", "Tracks", { repr: "helix", visible: true }),
    layer("TH", "Track hits", { repr: "markers", visible: true }),
  ];
  const rel = (from: string, to: string) => ({ from, to, weights: [] });
  const relations = {
    candI: rel("Cand", "I"),
    iLCs: rel("I", "LC"),
    linkLCs: rel("Link", "LC"),
    tLCs: rel("T", "LC"),
    lcHits: rel("LC", "Hit"),
    candTrk: rel("Cand", "Trk"),
    trkHits: rel("Trk", "TH"),
    truthHits: { ...rel("P", "Hit"), association: true },
  };
  const hl = rows({ Cand: [0], I: [0], Link: [0], T: [2], LC: [0, 1], Hit: [0, 1, 2], Trk: [3], TH: [7, 8], P: [4] });
  it("puts what holds something before it, and every branch's smallest objects and its lines last, always drawn", () => {
    const lv = focusLevels(branches, "Cand", hl, own, relations);
    expect(lv.map((l) => `${l.name}${l.leaf ? " (leaf)" : ""}${l.always ? " (always)" : ""}`)).toEqual([
      "Interpretations",
      "Linked tracksters",
      "Tracksters",
      "Layer clusters",
      "Tracks (always)",
      "Track hits (leaf) (always)",
      "Hits (leaf) (always)",
    ]);
    expect(
      levelLayers(lv, null, () => false)
        .draw.map((d) => d.table)
        .sort(),
    ).toEqual(["Hit", "TH", "Trk"]);
    expect(stepLevel(lv, "Layer clusters", 1)).toBe("Layer clusters"); // the leaves and lines are not stepped to
    expect(stepLevel(lv, null, 1)).toBe("Interpretations");
    // depth: the longest chain of levels holding it; the track branch starts again at 0
    expect(Object.fromEntries(lv.map((l) => [l.name, l.depth]))).toEqual({
      Interpretations: 0,
      "Linked tracksters": 1,
      Tracksters: 2,
      "Layer clusters": 3,
      Tracks: 0,
      "Track hits": 1,
      Hits: 4,
    });
  });
  it("finds what a level holds through a level the highlight lacks (a pair view without layer clusters)", () => {
    // A trackster's pair with no candidate: its interpretation and linked trackster reach the hits through layer
    // clusters, which the pair's highlight has none of. Only the hits are a leaf.
    const pair = rows({ T: [2], I: [0], Link: [0], Hit: [0, 1, 2] });
    const lv = focusLevels(branches, "T", pair, () => true, relations);
    expect(lv.map((l) => `${l.name}${l.always ? " (always)" : ""}`)).toEqual([
      "Interpretations",
      "Linked tracksters",
      "Hits (always)",
    ]);
    expect(levelLayers(lv, null, () => false).draw.map((d) => d.table)).toEqual(["Hit"]);
  });
  it("orders levels of one branch that reach the same objects only through tables that are not levels (a hit's pair)", () => {
    const lv = focusLevels(branches, "Hit", rows({ Hit: [0], I: [0], Link: [0], T: [2] }), () => true, relations);
    expect(lv.map((l) => `${l.name}${l.always ? " (always)" : ""}`)).toEqual([
      "Interpretations",
      "Linked tracksters",
      "Tracksters (always)",
    ]);
  });
  it("draws a vertex's tracks with their hits: lines do not hide them", () => {
    const vtx = [
      layer("TH", "Track hits", { repr: "markers" }),
      layer("Trk", "Tracks", { repr: "helix" }),
      layer("V", "Vertices", { repr: "markers" }),
    ];
    const lv = focusLevels(vtx, "V", rows({ V: [0], Trk: [1, 2], TH: [3, 4, 5] }), () => true, {
      vTrk: rel("V", "Trk"),
      trkHits: rel("Trk", "TH"),
    });
    expect(lv.map((l) => `${l.name} ${l.count}${l.always ? " (always)" : ""}`)).toEqual([
      "Tracks 2 (always)",
      "Track hits 3 (always)",
    ]);
    expect(stepLevel(lv, null, 1)).toBeNull();
  });
});

describe("levelLayers", () => {
  const lv = focusLevels(display, "Cand", candidate, own),
    ticked = (d: DisplayLayer) => d.visible;
  const tables = (ds: DisplayLayer[]) => ds.map((d) => d.table).sort();
  it("draws the bottom level only, and hides the others even if ticked (layer clusters)", () => {
    const { draw, hide } = levelLayers(lv, null, ticked);
    expect(tables(draw)).toEqual(["Hit"]);
    expect(tables(hide)).toEqual(["DNN", "I", "LC", "Link", "T"]);
  });
  it("draws the chosen level as well, all its layers when none is ticked", () => {
    const { draw, hide } = levelLayers(lv, "Linked tracksters", ticked);
    expect(tables(draw)).toEqual(["DNN", "Hit", "Link"]);
    expect(tables(hide)).toEqual(["I", "LC", "T"]);
  });
  it("draws only the ticked layers of a level when some are", () => {
    const { draw } = levelLayers(lv, "Linked tracksters", (d) => d.visible || d.table === "DNN");
    expect(tables(draw)).toEqual(["DNN", "Hit"]);
  });
});

describe("stepLevel", () => {
  const lv = focusLevels(display, "Cand", candidate, own);
  it("steps down from none to the level just below the bottom one, and no further", () => {
    let chosen: string | null = null;
    const seen = [];
    for (let i = 0; i < 6; i++) seen.push((chosen = stepLevel(lv, chosen, 1)));
    expect(seen).toEqual([
      "Interpretations",
      "Linked tracksters",
      "Tracksters",
      "Layer clusters",
      "Layer clusters",
      "Layer clusters",
    ]);
  });
  it("steps up back to none", () => {
    expect(stepLevel(lv, "Linked tracksters", -1)).toBe("Interpretations");
    expect(stepLevel(lv, "Interpretations", -1)).toBeNull();
    expect(stepLevel(lv, null, -1)).toBeNull();
  });
  it("has nothing to step to with a single level", () => {
    expect(stepLevel(lv.slice(-1), null, 1)).toBeNull();
  });
});

describe("levels across parts of the detector", () => {
  // A jet (shared Physics domain) made of particles (shared), whose tracks are in the Tracker and clusters in Calo,
  // each down to its own hits.
  const shared = new Set(["Physics"]);
  const L = (name: string, domain: string | undefined, depth: number, always = false) => ({
    name,
    layers: [layer(name, name, { domain })],
    count: 2,
    leaf: always,
    always,
    depth,
  });
  const lv = [
    L("Particles", "Physics", 0),
    L("Clusters", "Calo", 1),
    L("Superclusters", "Calo", 1),
    L("Seeds", "Tracker", 1),
    L("Tracks", "Tracker", 1, true),
    L("Track hits", "Tracker", 2, true),
    L("Calo hits", "Calo", 2, true),
  ];
  it("merges same-depth levels of different parts into one, but not two of one part, nor lines and leaves", () => {
    expect(mergeAcrossDomains(lv, shared).map((l) => `${l.name} ${l.count}`)).toEqual([
      "Particles 2",
      "Clusters · Seeds 4",
      "Superclusters 2",
      "Tracks 2",
      "Track hits 2",
      "Calo hits 2",
    ]);
  });
  it("scopes the levels to the domain looked at: its own and the shared ones", () => {
    expect(scopeLevels(lv, "Physics", shared).map((l) => l.name)).toEqual(["Particles"]);
    expect(scopeLevels(lv, "Calo", shared).map((l) => l.name)).toEqual([
      "Particles",
      "Clusters",
      "Superclusters",
      "Calo hits",
    ]);
    expect(scopeLevels(lv, null, shared)).toEqual(lv);
  });
});
