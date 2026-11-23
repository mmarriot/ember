import { describe, expect, it } from "vitest";
import type { DisplayLayer, EventData, Header } from "../../io/format";
import { identities, truthClasses } from "./identities";

const csr = (rows: number[][]) => ({
  offsets: Uint32Array.from(rows.reduce((o, r) => [...o, o[o.length - 1] + r.length], [0])),
  indices: Uint32Array.from(rows.flat()),
  weights: {},
});

describe("truth identities", () => {
  // particles: 0 π⁺ (100 GeV) -> children 1, 2 (inside the tracker); 1 owns hits 0, 1; 2 owns hit 2; 3 γ (30 GeV) owns
  // hit 3; 4 a quark (500 GeV) linked to nothing; 5 (5 GeV) owns no hits but a trackster is matched to it
  const tev = {
    id: [1, 1, 1],
    tables: {
      P: { n: 6, columns: { energy: Float32Array.from([100, 40, 20, 30, 500, 5]) } },
      Hit: { n: 4, columns: {} },
    },
    relations: {
      kids: csr([[1, 2], [], [], [], [], []]),
      pHits: { ...csr([[], [0, 1], [2], [3], [], []]), weights: { simE: Float32Array.from([1, 2, 3, 4]) } },
      tTruth: csr([[0], [5]]),
    },
  } as unknown as EventData;
  const th = {
    relations: {
      kids: { from: "P", to: "P", weights: [] },
      pHits: { from: "P", to: "Hit", weights: ["simE"], association: true, best: { weight: "simE", order: "max" } },
      tTruth: { from: "T", to: "P", weights: [], association: true },
    },
    display: [
      { table: "Hit", repr: "cells" },
      { table: "P", repr: "segments", truth: true, colour: "energy" },
    ],
  } as unknown as Header;
  const d = th.display[1] as DisplayLayer;
  it("gives a particle the key of its highest ancestor that left hits or is matched", () => {
    const { key, top, others } = identities(d, tev.tables.P, tev, th, 2);
    expect([...key]).toEqual([0, 0, 0, 3, 4, 5]); // daughters of the matched π⁺ share its key
    expect(top).toEqual([0, 3]); // largest first; the quark is linked to nothing and takes no colour
    expect(others).toBe(1); // particle 5
    expect([...identities(d, tev.tables.P, tev, th, 2).used]).toEqual([1, 0, 0, 1, 0, 1]); // keys in use: not the quark
  });
  it("with a particle level, gives a particle the key of its generator particle, signal first", () => {
    // 0 K*⁰ (not in the level) -> 1 π⁻ (level); 1 -> 2, a secondary that owns hits; 3 γ (level, pile-up) owns hits;
    // 4 π⁰ (not in the level, decayed by the generator) is matched by a trackster -> 5, 6 γ (level) own hits
    const lev = {
      id: [1, 1, 1],
      tables: {
        P: {
          n: 7,
          columns: {
            energy: Float32Array.from([244, 67, 60, 50, 46, 30, 16]),
            flags: Uint32Array.from([0, 4, 0, 4, 0, 4, 4]),
            signal: Uint8Array.from([1, 1, 1, 0, 1, 1, 1]),
          },
        },
        Hit: { n: 4, columns: {} },
      },
      relations: {
        kids: csr([[1], [2], [], [], [5, 6], [], []]),
        pHits: { ...csr([[], [], [0], [1], [], [2], [3]]), weights: { simE: Float32Array.from([1, 1, 1, 1]) } },
        tTruth: csr([[4]]),
      },
    } as unknown as EventData;
    const ld = { ...d, particle: { flags: "flags", bit: 2, first: "signal" } } as DisplayLayer;
    const { key, used, top } = identities(ld, lev.tables.P, lev, th, 4);
    expect([...key]).toEqual([0, 1, 1, 3, 4, 5, 6]); // the secondary takes its generator particle; the π⁰'s photons their own
    expect([...used]).toEqual([0, 1, 0, 1, 1, 1, 1]); // the K*⁰ owns nothing and is matched by nothing
    expect(top).toEqual([1, 5, 6, 4]); // signal generator particles, then the matched π⁰ above the level; pile-up takes none
  });
  describe("colour slots by relevance", () => {
    // 0 μ⁺ (pT 90, η 1) matched by track 0; 1 p (pT 2, η -5.2, E 180: a beam remnant); 2 K⁻ (pT 20) left 30 GeV in HGCal
    // hits and 1 GeV in ECAL; 3 γ (pT 25) left 5 GeV in ECAL and 4 GeV in HCAL; 4 π⁺ (pT 10) left 8 GeV in HCAL; 5 a
    // b hadron (pT 40, bits 8) -> 6 its π⁻ (pT 5, bit 2) matched by track 1
    const pev = {
      id: [1, 1, 1],
      tables: {
        P: {
          n: 7,
          columns: {
            energy: Float32Array.from([162, 180, 69, 30, 12, 100, 6]),
            pt: Float32Array.from([90, 2, 20, 25, 10, 40, 5]),
            eta: Float32Array.from([1, -5.2, 1.8, 0.5, 0.3, 1, 1]),
            flags: Uint32Array.from([4, 4, 4, 4, 4, 256, 4]),
            signal: Uint8Array.from([1, 1, 1, 1, 1, 1, 1]),
          },
        },
        HGC: { n: 2, columns: {} },
        EB: { n: 2, columns: {} },
        HB: { n: 2, columns: {} },
        Trk: { n: 2, columns: {} },
      },
      relations: {
        kids: csr([[], [], [], [], [], [6], []]),
        hgc: { ...csr([[], [], [0, 1], [], [], [], []]), weights: { simE: Float32Array.from([20, 10]) } },
        eb: { ...csr([[], [], [0], [1], [], [], []]), weights: { simE: Float32Array.from([1, 5]) } },
        hb: { ...csr([[], [], [], [0], [1], [], []]), weights: { simE: Float32Array.from([4, 8]) } },
        trkTruth: csr([[0], [6]]),
      },
    } as unknown as EventData;
    const fact = (to: string) => ({
      from: "P",
      to,
      weights: ["simE"],
      association: true,
      best: { weight: "simE", order: "max" },
    });
    const ph = {
      domains: [{ name: "Physics", shared: true }, { name: "HGCal" }, { name: "Calo" }, { name: "Tracker" }],
      relations: {
        kids: { from: "P", to: "P", weights: [] },
        hgc: { ...fact("HGC"), fact: { in: "HGCal" } },
        eb: { ...fact("EB"), fact: { in: "ECAL" } },
        hb: { ...fact("HB"), fact: { in: "HCAL" } },
        trkTruth: { from: "Trk", to: "P", weights: [], association: true, match: { measure: "hits", in: "tracker" } },
      },
      display: [
        { table: "HGC", repr: "cells", domain: "HGCal" },
        { table: "EB", repr: "cells", domain: "Calo" },
        { table: "HB", repr: "cells", domain: "Calo" },
        { table: "Trk", repr: "helix", domain: "Tracker" },
        { table: "P", repr: "helix", truth: true, colour: "energy" },
      ],
    } as unknown as Header;
    const pd = { ...(ph.display[4] as DisplayLayer), particle: { flags: "flags", bit: 2, first: "signal" } };
    const slots = (rank = {}) => identities(pd, pev.tables.P, pev, ph, 3, rank);
    it("in Physics and All, by pT with |η| < 5 first (never by energy: no beam remnants)", () => {
      expect(slots().top).toEqual([0, 3, 2]);
      expect(slots({ domain: "Physics" }).rule.by).toBe("pt");
    });
    it("in a calorimeter's view, by simulated energy there, ranked in each detector and taken in turn", () => {
      const h = slots({ domain: "HGCal" });
      expect(h.top).toEqual([2]); // only particles with energy there
      expect(h.rule).toMatchObject({ by: "simEnergy", in: "HGCal" });
      // Calo: ECAL ranks γ (5), K⁻ (1); HCAL ranks π⁺ (8), γ (4). Energies of the two are never compared or added:
      // ECAL's first, HCAL's first, ECAL's second.
      expect(slots({ domain: "Calo" }).top).toEqual([3, 4, 2]);
    });
    it("without simulated energy in a view, by pT among the particles its objects are matched to", () => {
      const t = slots({ domain: "Tracker" });
      expect(t.top).toEqual([0, 6]);
      expect(t.rule.by).toBe("matchedPt");
    });
    it("puts the selection's particles first, by their key", () => {
      const s = slots({ domain: "HGCal", prefer: [4, 6] });
      expect(s.top).toEqual([4, 6, 2]);
      expect(s.preferred).toBe(2);
      expect(s.rule.selection).toBe(true);
    });
    it("groups by the level chosen, and with `only` gives slots to its particles alone", () => {
      const b = slots({ level: 256, only: true });
      expect(b.key[6]).toBe(5); // the b hadron's π⁻ takes its colour
      expect(b.top).toEqual([5]);
    });
  });
  it("keeps every reconstructed object its own key", () => {
    const { key, top } = identities({ ...d, truth: false }, tev.tables.P, tev, th, 10);
    expect([...key]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(top).toEqual([4, 0, 1, 3, 2, 5]);
  });
});

describe("truth classes", () => {
  // 0 t (bit 4) -> 1 b (bit 5) -> 2 a secondary (no bits); 3 a UE particle (bit 6) -> 4 its secondary; 5 an ISR
  // particle (bit 0); 6 a pile-up particle, which carries the UE bit too
  const cev = {
    id: [1, 1, 1],
    tables: {
      P: {
        n: 7,
        columns: {
          flags: Uint32Array.from([16, 32, 0, 64, 0, 1, 64]),
          signal: Uint8Array.from([1, 1, 1, 1, 1, 1, 0]),
        },
      },
    },
    relations: { kids: csr([[1], [2], [], [4], [], [], []]) },
  } as unknown as EventData;
  const ch = { relations: { kids: { from: "P", to: "P", weights: [] } }, display: [] } as unknown as Header;
  const cd = {
    table: "P",
    repr: "segments",
    truth: true,
    particle: { flags: "flags", bit: 2, first: "signal" },
  } as DisplayLayer;
  it("puts a particle in the class of its nearest ancestor in one, the rest after the classes, pile-up last", () => {
    const signalUE = [
      { name: "signal", mask: 48 },
      { name: "underlying event", mask: 64 },
    ];
    expect([...truthClasses(cd, cev.tables.P, cev, ch, signalUE)]).toEqual([0, 0, 0, 1, 1, 2, 3]);
  });
  it("puts every particle of the signal collision in a class without bits", () => {
    expect([...truthClasses(cd, cev.tables.P, cev, ch, [{ name: "signal collision" }])]).toEqual([0, 0, 0, 0, 0, 0, 2]);
  });
});
