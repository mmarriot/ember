import { describe, expect, it } from "vitest";
import { graphOf } from "./graph";
import { matchesQuery, parseTruthQuery, particlesInView, unassociatedKinds } from "./particles";

const csr = (rows: number[][]) => ({
  offsets: Uint32Array.from(rows.reduce((o, r) => [...o, o[o.length - 1] + r.length], [0])),
  indices: Uint32Array.from(rows.flat()),
});

describe("truth search", () => {
  it("takes a pdgId, a pdgId of either sign, or the start of a name", () => {
    expect(parseTruthQuery("511")).toEqual({ pdg: 511, abs: false });
    expect(parseTruthQuery("-11")).toEqual({ pdg: -11, abs: false });
    expect(parseTruthQuery("|pdg|=11")).toEqual({ pdg: 11, abs: true });
    expect(parseTruthQuery("|11|")).toEqual({ pdg: 11, abs: true });
    expect(parseTruthQuery(" B ")).toEqual({ name: "b" });
    expect(parseTruthQuery("  ")).toBeNull();
  });
  it("matches particles by them", () => {
    expect(matchesQuery({ pdg: 11, abs: true }, -11, "e⁺")).toBe(true);
    expect(matchesQuery({ pdg: 11, abs: false }, -11, "e⁺")).toBe(false);
    expect(matchesQuery({ name: "b" }, 511, "B⁰")).toBe(true);
  });
});

describe("particles in a view", () => {
  // particles 0 (pT 50), 1 (pT 5), 2 (pT 20, pile-up); HGCal hits: 0 leaves 0.3 + 0.1, 1 leaves 0.2, 2 leaves 0.5.
  // Tracksters: 0 holds 60% of particle 0 and is its best, 1 holds 30% of it; particle 1's best is trackster 0 too.
  // Tracks: track 0 is matched to particle 0, track 1 to particle 2.
  const ev = {
    id: [1, 1, 1],
    tables: {
      P: { n: 3, columns: { pt: Float32Array.from([50, 5, 20]) } },
      H: { n: 4, columns: {} },
      T: { n: 2, columns: {} },
      K: { n: 2, columns: {} },
    },
    relations: {
      hits: { ...csr([[0, 1], [2], [3]]), weights: { simE: Float32Array.from([0.3, 0.1, 0.2, 0.5]) } },
      tTruth: { ...csr([[0], [0]]), weights: { score: Float32Array.from([0.1, 0.5]) } },
      truthT: { ...csr([[0, 1], [0], []]), weights: { frac: Float32Array.from([0.6, 0.3, 0.9]) } },
      kTruth: { ...csr([[0], [2]]), weights: { score: Float32Array.from([0, 0]) } },
    },
  } as unknown as Parameters<typeof particlesInView>[0];
  const header = {
    domains: [{ name: "HGCal" }, { name: "Tracker" }, { name: "Physics", shared: true }],
    display: [
      { table: "P", truth: true },
      { table: "H", repr: "cells", domain: "HGCal" },
      { table: "T", domain: "HGCal" },
      { table: "K", domain: "Tracker" },
    ],
    relations: {
      hits: {
        from: "P",
        to: "H",
        association: true,
        weights: ["simE"],
        best: { weight: "simE" },
        fact: { in: "HGCal" },
      },
      tTruth: {
        from: "T",
        to: "P",
        association: true,
        weights: ["score"],
        best: { weight: "score", order: "min" },
        match: { measure: "energy", in: "HGCal", shared: "x" },
      },
      truthT: {
        from: "P",
        to: "T",
        association: true,
        weights: ["frac"],
        best: { weight: "frac", order: "max" },
        match: { measure: "energy", in: "HGCal", completeness: { weight: "frac" } },
      },
      kTruth: {
        from: "K",
        to: "P",
        association: true,
        weights: ["score"],
        best: { weight: "score", order: "min" },
        match: { measure: "hits", in: "tracker", shared: "x" },
      },
    },
  } as unknown as Parameters<typeof particlesInView>[1];
  it("lists a detector's particles by simulated energy, with their best match, completeness, splits and merges", () => {
    const [h] = particlesInView(ev, header, "P", "HGCal");
    expect(h).toMatchObject({ in: "HGCal", by: "simEnergy", kind: "T" });
    expect(h.rows.map((r) => r.particle)).toEqual([2, 0, 1]);
    const p0 = h.rows.find((r) => r.particle === 0)!;
    expect(p0.amount).toBeCloseTo(0.4);
    expect(p0).toMatchObject({ best: 0, split: 2, shares: 1 });
    expect(p0.completeness).toBeCloseTo(0.6);
    expect(h.rows.find((r) => r.particle === 2)!.best).toBe(-1);
  });
  it("in the tracker, lists the particles tracks are matched to, by pT; the whole detector has both", () => {
    const [t] = particlesInView(ev, header, "P", "Tracker", (r) => r !== 2);
    expect(t).toMatchObject({ in: "tracker", by: "pt" });
    expect(t.rows.map((r) => r.particle)).toEqual([0]);
    expect(particlesInView(ev, header, "P", null).map((d) => d.in)).toEqual(["tracker", "HGCal"]);
  });
});

describe("kinds with no associator a particle could reach", () => {
  // particle 0 (π⁻) left HGCal hits; HGCal layer clusters (no truth) are made of HGCal hits; ECAL superclusters (no
  // truth) of ECAL hits; electrons (Physics, no truth) of superclusters; jets (Physics, no truth) of layer clusters.
  const ev = {
    id: [1, 1, 1],
    tables: { P: { n: 1, columns: { pdgId: Int32Array.from([-211]) } } },
    relations: { hgc: { ...csr([[0]]), weights: { e: Float32Array.from([1]) } }, kids: csr([[]]) },
  } as unknown as Parameters<typeof unassociatedKinds>[0];
  const header = {
    domains: [{ name: "Physics", shared: true }, { name: "HGCal" }, { name: "Calo" }],
    display: [
      { table: "P", truth: true },
      { table: "HGC", repr: "cells", domain: "HGCal" },
      { table: "EB", repr: "cells", domain: "Calo" },
      { table: "LC", domain: "HGCal" },
      { table: "SC", domain: "Calo" },
      { table: "Ele", domain: "Physics", kind: "electron" },
      { table: "Jet", domain: "Physics", kind: "jet" },
    ],
    relations: {
      hgc: { from: "P", to: "HGC", association: true, weights: ["e"], fact: { in: "HGCal" } },
      eb: { from: "P", to: "EB", association: true, weights: ["e"], fact: { in: "ECAL" } },
      lcHits: { from: "LC", to: "HGC", weights: [] },
      scHits: { from: "SC", to: "EB", weights: [] },
      eleSC: { from: "Ele", to: "SC", weights: [] },
      jetLC: { from: "Jet", to: "LC", weights: [] },
    },
  } as unknown as Parameters<typeof unassociatedKinds>[1];
  const g = graphOf(ev.tables.P, ev.relations.kids);
  it("lists those of its detectors and species, never another detector's or species'", () => {
    const kinds = unassociatedKinds(ev, header, "P", 0, g, (t) =>
      ["P", "HGC", "EB"].includes(t) ? undefined : { reason: "none" },
    );
    expect(kinds.map((k) => k.table)).toEqual(["LC", "Jet"]);
  });
});
