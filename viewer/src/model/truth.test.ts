import { describe, expect, it } from "vitest";
import {
  bremOf,
  colourLevel,
  conversionOf,
  copiesBelow,
  decayVertexMatches,
  flightOf,
  foldCopies,
  graphOf,
  length,
  matchesQuery,
  parseTruthQuery,
  particlesInView,
  ruleText,
  tauDecayOf,
  unassociatedKinds,
  topCopy,
  vertexText,
} from "./truth";

const csr = (rows: number[][]) => ({
  offsets: Uint32Array.from(rows.reduce((o, r) => [...o, o[o.length - 1] + r.length], [0])),
  indices: Uint32Array.from(rows.flat()),
});

// An event in the truth graph's terms. A particle's decayVertexIdx is the latest of the vertices where its kept
// daughters were made, and its children are those of all of them (TruthGraphNanoTableProducers).
// Vertices: 0 the hard scatter (0,0,0); 1 a brem at R 10; 2 a brem at R 50; 3 a conversion at R 26, z 40; 4 the τ's
// decay at R 0.07; 5 a B⁰ decay 3 mm away; 6 the π⁰ decay; 7 a Compton scattering at R 15; 8 a D⁻ decay 2 mm further.
// Particles:
//  0 μ⁺ (status 23) -> 1 μ⁺ (51) -> 2 μ⁺ (1): copies
//  3 e⁻ (E 70, 20 at the calorimeter) -> brem photons 4 (E 30, at vertex 1) and 5 (E 20, at vertex 2); its end vertex
//    is the later brem's, 2
//  6 π⁰ -> 7 γ and 10 γ (reaches the calorimeter); 7 Compton-scatters at vertex 7 (-> 21 e⁻) and then converts at
//    vertex 3 (-> 8 e⁻, 9 e⁺): its end vertex is the conversion, but its children are all three
//  11 τ⁻ (23) -> 12 τ⁻ (2) + 13 γ (FSR); 12 decays at vertex 4 -> 14 ντ, 15 π⁻ (E 40), 16 π⁰ (E 20)
//  17 B⁰ (b hadron) -> decays at vertex 5 -> 18 K⁺, 19 π⁻, 22 D⁻ (c hadron); 22 decays at vertex 8 -> 20 π⁺
const P = {
  pdgId: [-13, -13, -13, 11, 22, 22, 111, 22, 11, -11, 22, 15, 15, 22, 16, -211, 111, 511, 321, -211, 211, 11, -411],
  status: [23, 51, 1, 1, 0, 0, 2, 1, 0, 0, 1, 23, 2, 1, 1, 1, 2, 2, 1, 1, 1, 0, 2],
  energy: [162, 162, 162, 70, 30, 20, 60, 35, 20, 15, 25, 120, 118, 2, 58, 40, 20, 34, 5, 6, 7, 1, 20],
  charge: [1, 1, 1, -1, 0, 0, 0, 0, -1, 1, 0, -1, -1, 0, 0, -1, 0, 0, 1, -1, 1, -1, -1],
  hasBoundary: [0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0],
  boundaryE: [0, 0, 160, 20, 30, 0, 0, 0, 19, 14, 25, 0, 0, 0, 0, 39, 0, 0, 5, 6, 7, 0, 0],
  prodVertexIdx: [0, 0, 0, 0, 1, 2, -1, 6, 3, 3, 6, 0, 0, 0, 4, 4, 4, 0, 5, 5, 8, 7, 5],
  decayVertexIdx: [-1, -1, -1, 2, -1, -1, 6, 3, -1, -1, -1, -1, 4, -1, -1, -1, -1, 5, -1, -1, -1, -1, 8],
  levelFlags: [0, 0, 4, 4, 0, 0, 0, 4, 0, 0, 4, 0, 0, 0, 4, 4, 0, 256, 4, 4, 4, 0, 512],
};
const V = {
  reason: [17, 3, 3, 5, 2, 2, 2, 6, 2],
  x: [0, 10, 50, 26, 0.07, 0.3, 0, 15, 0.5],
  y: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  z: [0, 5, 20, 40, 0.1, 0, 0, 22, 0],
};
const kids: number[][] = Array.from({ length: P.pdgId.length }, () => []);
kids[0] = [1];
kids[1] = [2];
kids[3] = [4, 5];
kids[6] = [7, 10];
kids[7] = [21, 8, 9];
kids[11] = [12, 13];
kids[12] = [14, 15, 16];
kids[17] = [18, 19, 22];
kids[22] = [20];
const g = graphOf({ n: P.pdgId.length, columns: P }, csr(kids), { n: V.reason.length, columns: V });

describe("the truth graph", () => {
  it("folds generator copies (the only child of the same pdgId) into one", () => {
    expect(copiesBelow(g, 0)).toEqual([0, 1, 2]);
    expect(topCopy(g, 2)).toBe(0);
    expect(foldCopies(g, [0, 1, 2])).toEqual([[0, 1, 2]]);
    // a τ written again beside a photon it radiated is still one τ
    expect(foldCopies(g, [11, 12])).toEqual([[11, 12]]);
    expect(copiesBelow(g, 11)).toEqual([11, 12]);
    expect(foldCopies(g, [6, 7])).toEqual([[6], [7]]); // a π⁰'s photon is not a copy
  });
  it("sums an electron's brem photons, where they were radiated, and its energy at the calorimeter", () => {
    const b = bremOf(g, 3)!;
    expect(b.count).toBe(2);
    expect(b.energy).toBe(50);
    expect([b.rMin, b.rMax]).toEqual([10, 50]);
    expect(b.atCalo).toBe(20);
    expect(bremOf(g, 15)).toBeUndefined();
  });
  // An e⁺ of 221 GeV (egamma_0PU event 7) leaves the tracker (|z| 293.5 cm) at t 9.49 ns with 139 GeV, having radiated
  // 82 GeV before: a 27 GeV photon it radiates beyond the boundary (z −298 cm, t 9.66 ns) is not brem in the tracker.
  const late = graphOf(
    {
      n: 3,
      columns: {
        pdgId: [-11, 22, 22],
        status: [1, 0, 0],
        energy: [221, 82, 27],
        prodVertexIdx: [0, 1, 2],
        hasBoundary: [1, 0, 0],
        boundaryE: [139, 0, 0],
        boundaryT: [9.49, 0, 0],
        boundaryX: [30, 0, 0],
        boundaryY: [40, 0, 0],
        boundaryZ: [-293.5, 0, 0],
      },
    },
    csr([[1, 2], [], []]),
    { n: 3, columns: { reason: [17, 3, 3], x: [0, 18, 52], y: [0, 0, 0], z: [0, -103, -298], t: [0, 3.05, 9.66] } },
  );
  it("counts only the brem radiated before the calorimeter, so that E = ΣE + E at the calorimeter", () => {
    expect(bremOf(late, 0)).toMatchObject({
      count: 1,
      energy: 82,
      rMin: 18,
      rMax: 18,
      atCalo: 139,
      atR: 50,
      atZ: -293.5,
    });
  });
  it("says where a photon converted, into what, and its π⁰ and sister photon", () => {
    const c = conversionOf(g, 7)!;
    // the Compton electron made earlier by the same photon is not a conversion product
    expect(c).toMatchObject({
      converted: true,
      showered: false,
      r: 26,
      z: 40,
      products: [8, 9],
      pi0: 6,
      sisters: [10],
    });
    expect(conversionOf(g, 10)).toMatchObject({ converted: false, reachedCalo: true, pi0: 6, sisters: [7] });
  });
  it("calls a conversion after the photon reached the calorimeter the start of its shower, not a conversion", () => {
    // a H → γγ photon (egamma_0PU event 11) reaching the barrel calorimeter at t 4.56 ns, its first pair at R 129 cm
    const p = graphOf(
      {
        n: 3,
        columns: {
          pdgId: [22, 11, -11],
          status: [1, 0, 0],
          energy: [81, 40, 41],
          prodVertexIdx: [0, 1, 1],
          hasBoundary: [1, 0, 0],
          boundaryT: [4.56, 0, 0],
        },
      },
      csr([[1, 2], [], []]),
      { n: 2, columns: { reason: [17, 5], x: [0, 129], y: [0, 0], z: [0, -82.5], t: [0, 4.79] } },
    );
    expect(conversionOf(p, 0)).toMatchObject({ converted: false, showered: true, r: 129, z: -82.5, products: [] });
  });
  it("reads a τ's decay products from the τ that decays, and its visible energy without neutrinos", () => {
    const t = tauDecayOf(g, 11)!;
    expect(t.last).toBe(12);
    expect(t.products).toEqual([14, 15, 16]);
    expect(t.visibleE).toBe(60);
  });
  it("measures a hadron's flight from its production to its decay vertex", () => {
    const f = flightOf(g, 17)!;
    expect(f.lxy).toBeCloseTo(0.3);
    expect(f.vertex).toBe(5);
    expect(flightOf(g, 3)).toBeUndefined(); // an electron's brems are no decay
  });
  it("finds the reco vertices matched to a b hadron's decay and its c hadron's, best completeness first", () => {
    const ev = {
      id: [1, 1, 1],
      tables: {},
      relations: {
        truthSV: {
          ...csr([[], [], [], [], [], [0], [], [], [1, 0]]),
          weights: { fraction: Float32Array.from([0.4, 0.7, 0.1]) },
        },
      },
    } as unknown as Parameters<typeof decayVertexMatches>[0];
    const header = {
      relations: {
        svTruth: { from: "SV", to: "V", association: true, weights: ["score"], match: { target: "decayVertex" } },
        truthSV: {
          from: "V",
          to: "SV",
          association: true,
          weights: ["fraction"],
          match: { completeness: { weight: "fraction" } },
        },
      },
    } as unknown as Parameters<typeof decayVertexMatches>[1];
    const m = decayVertexMatches(ev, header, g, "V", 17, "levelFlags");
    expect(m.associator).toBe(true);
    expect(m.matches.map((x) => [x.vertex, x.row])).toEqual([
      [8, 1],
      [5, 0],
      [8, 0],
    ]);
    const none = decayVertexMatches(ev, { relations: {} } as unknown as typeof header, g, "V", 17, "levelFlags");
    expect(none).toEqual({ associator: false, matches: [] });
  });
  it("names a vertex by what ended there and how many charged particles it made", () => {
    const names = (r: number) => ({ 17: "B⁰", 7: "γ" })[r] ?? "?";
    const reasons = { "2": "decay", "5": "conversion" };
    expect(vertexText(g, 5, names, reasons)).toBe("B⁰ decay · 3 charged");
    expect(vertexText(g, 3, names, reasons)).toBe("γ conversion · 2 charged"); // the photon whose daughters these are
  });
  it("gives lengths in a unit that suits them", () => {
    expect(length(0.0012)).toBe("12.0 µm");
    expect(length(0.074)).toBe("740 µm");
    expect(length(0.3)).toBe("3.00 mm");
    expect(length(26.3)).toBe("26.3 cm");
  });
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

describe("colour levels", () => {
  it("name a level and the rule the slots follow", () => {
    expect(colourLevel(4).name).toBe("generator particle");
    expect(colourLevel(768).only).toBe(true);
    expect(colourLevel(2).name).toBe("bit 1");
    expect(ruleText({ selection: false, by: "simEnergy", in: "HGCal", detectors: ["HGCal"] }, 7)).toBe(
      "top 7 by simulated energy in HGCal",
    );
    expect(ruleText({ selection: false, by: "simEnergy", in: "Calo", detectors: ["ECAL", "HCAL"] }, 7)).toBe(
      "top 7 by simulated energy within each of ECAL, HCAL, in turn",
    );
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
