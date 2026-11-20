import { describe, expect, it } from "vitest";
import type { DisplayLayer, Header, Table } from "../io/format";
import {
  cardName,
  cellText,
  chipName,
  cmsswName,
  collection,
  describeRow,
  inText,
  isCopied,
  isIndex,
  kindLabel,
  labelName,
  objectName,
  plain,
  singular,
  withUnit,
} from "./describe";

const layer = (table: string, group: string, label: string, extra: Partial<DisplayLayer> = {}) =>
  ({
    table,
    group,
    label,
    kind: "k",
    repr: "markers",
    visible: true,
    position: ["x", "y", "z"],
    ...extra,
  }) as DisplayLayer;
const jet = layer("Jet", "Jets", "AK4", { describe: { columns: ["pt", "eta"] } }),
  chs = layer("JetCHS", "Jets", "AK4 CHS"),
  ele = layer("Electron", "Electrons", "Electrons", { describe: { columns: ["pt"] } }),
  eleHGC = layer("ElectronHGC", "Electrons", "Electrons (HGCal)"),
  pv = layer("PV", "Vertices", "Primary vertices"),
  sv = layer("SV", "Secondary vertices", "Secondary"),
  met = layer("PuppiMET", "MET", "Puppi MET", { list: { columns: ["pt"], headline: "value" } }),
  pmet = layer("PFMET", "MET", "PF MET"),
  truth = layer("TruthParticles", "Truth graph", "Particles", { truth: true });
const col = (doc: string) => ({ type: "f32", doc });
const header = {
  display: [jet, chs, ele, eleHGC, pv, sv, met, pmet, truth],
  tables: {
    Jet: {
      doc: "AK4 jets (ak4PFJetsPuppi), uncorrected",
      columns: { pt: col("pt [GeV]"), eta: col("pseudorapidity") },
    },
    Electron: {
      doc: "gedGsfElectrons",
      columns: {
        pt: col("pt [GeV]"),
        trackIdx: col("row in GeneralTrack (generalTracks); -1: none"),
        x: col("x [cm] (from PV.x, row 0)"),
        px: col("derived from pt, eta, phi"),
        time: col("t0 [ns]; -99: none"),
        width: col("width"),
      },
    },
    Muon: { doc: "muons", columns: {} },
    PuppiMET: { doc: "PuppiMET", columns: {} },
  },
  relations: {},
} as unknown as Header;

describe("names", () => {
  it("puts a kind in the singular, by its last word", () => {
    expect(["Jets", "Taus", "Vertices", "PF candidates", "MET", "Calorimeter hits", "Beam spot"].map(singular)).toEqual(
      ["Jet", "Tau", "Vertex", "PF candidate", "MET", "Calorimeter hit", "Beam spot"],
    );
    expect(inText("PF candidates")).toBe("PF candidates");
    expect(inText("Calorimeter hits")).toBe("calorimeter hits");
  });
  it("names the kind, and the collection only where the label adds to it", () => {
    expect([jet, chs, ele, eleHGC, pv, sv, met, truth].map((d) => [kindLabel(d), collection(d)])).toEqual([
      ["Jet", "AK4"],
      ["Jet", "AK4 CHS"],
      ["Electron", ""],
      ["Electron", "HGCal"],
      ["Primary vertex", ""],
      ["Secondary vertex", ""],
      ["Puppi MET", ""],
      ["Truth particle", ""],
    ]);
  });
  it("gives an object one name: kind, number from 1, collection where its kind has several, values", () => {
    expect(objectName(header, jet, 0, "pT 99.6 GeV")).toBe("Jet 1 · AK4 · pT 99.6 GeV");
    expect(objectName(header, jet, 0, "pT 99.6 GeV", true)).toBe("Jet 1 · AK4 (ak4PFJetsPuppi) · pT 99.6 GeV");
    expect(objectName(header, ele, 1, "pT 59.7 GeV", true)).toBe("Electron 2 · gedGsfElectrons · pT 59.7 GeV");
    expect(objectName(header, pv, 0, "")).toBe("Primary vertex 1");
    // a one-object table has no number, and a CMSSW name that repeats it is left out
    expect(objectName(header, met, 0, "pT 38.1 GeV", true)).toBe("Puppi MET · pT 38.1 GeV");
    expect(cmsswName(header, layer("Muon", "Muons", "Muons"))).toBe("");
  });
  it("heads the card with the name and its values, and its collection on a line below", () => {
    expect(cardName(header, jet, 0, "pT 99.6 GeV")).toEqual(["Jet 1 · pT 99.6 GeV", "AK4 · ak4PFJetsPuppi"]);
    expect(cardName(header, ele, 1, "pT 59.7 GeV")).toEqual(["Electron 2 · pT 59.7 GeV", "gedGsfElectrons"]);
    expect(cardName(header, met, 0, "pT 38.1 GeV")).toEqual(["Puppi MET · pT 38.1 GeV", ""]);
  });
  it("names an object in a list of its kind by its collection, where the kind has several", () => {
    expect(chipName(header, chs, 0, "pT 52.8 GeV")).toBe("AK4 CHS · pT 52.8 GeV");
    expect(chipName(header, pmet, 0, "pT 34.1 GeV")).toBe("PF MET · pT 34.1 GeV");
    expect(chipName(header, pv, 2, "")).toBe("Primary vertex 3");
    // a collection whose label adds nothing to its kind is named by its CMSSW collection
    expect(chipName(header, ele, 0, "pT 5.15 GeV")).toBe("gedGsfElectrons · pT 5.15 GeV");
    expect(objectName(header, ele, 0, "pT 5.15 GeV")).toBe("Electron 1 · gedGsfElectrons · pT 5.15 GeV");
  });
});

describe("labels", () => {
  it("name the collection only where another of the kind is labelled, by the words that tell them apart", () => {
    expect(labelName(header, jet, 0, "pT 46 GeV", [jet, ele])).toBe("Jet 1 · pT 46 GeV");
    expect(labelName(header, ele, 0, "pT 16 GeV", [jet, ele])).toBe("Electron 1 · pT 16 GeV");
    // AK4 and AK4 CHS: "AK4" is in both, so the CHS jet is "CHS"; the other keeps its whole name, being only "AK4"
    expect(labelName(header, chs, 0, "pT 52.8 GeV", [jet, chs])).toBe("Jet 1 · CHS · pT 52.8 GeV");
    expect(labelName(header, jet, 0, "pT 46 GeV", [jet, chs])).toBe("Jet 1 · AK4 · pT 46 GeV");
    expect(labelName(header, eleHGC, 1, "pT 15.4 GeV", [ele, eleHGC])).toBe("Electron 2 · HGCal · pT 15.4 GeV");
    expect(labelName(header, ele, 0, "pT 16 GeV", [ele, eleHGC])).toBe("Electron 1 · gedGsfElectrons · pT 16 GeV");
    expect(labelName(header, met, 0, "pT miss 27.6 GeV", [met, pmet])).toBe("Puppi MET · pT miss 27.6 GeV");
  });
  it("keep the words that differ, not those all the collections share", () => {
    const puppi = layer("Jet", "Jets", "AK4 PUPPI (raw, no JEC)"),
      chsRaw = layer("JetCHS", "Jets", "AK4 CHS (raw, no JEC)"),
      h = { ...header, display: [puppi, chsRaw] } as Header;
    expect(labelName(h, puppi, 0, "", [puppi, chsRaw])).toBe("Jet 1 · PUPPI");
    expect(labelName(h, chsRaw, 0, "", [puppi, chsRaw])).toBe("Jet 1 · CHS");
    expect(labelName(h, puppi, 0, "", [puppi])).toBe("Jet 1");
  });
});

describe("numbers", () => {
  it("writes numbers in plain decimals, never in e-notation", () => {
    expect([99.625, 0.000657, 5.148, 0.0601, 12345.6, 177, -6.786e-4].map((v) => plain(v))).toEqual([
      "99.6",
      "0.000657",
      "5.15",
      "0.0601",
      "12,346",
      "177",
      "-0.000679",
    ]);
  });
  it("writes 0, a missing number, infinities and negatives plainly", () => {
    expect([0, -0, NaN, Infinity, -Infinity, -5.148, -1e-6].map((v) => plain(v))).toEqual([
      "0",
      "0",
      "not set",
      "∞",
      "−∞",
      "-5.15",
      "-0.000001",
    ]);
    expect(withUnit(-0.000657, "cm")).toBe("-6.57 µm");
    expect(withUnit(0.0999995, "cm")).toBe("1 mm"); // rounded first, then scaled
  });
  it("scales a length and an energy to their size", () => {
    expect(withUnit(0.000657, "cm")).toBe("6.57 µm");
    expect(withUnit(0.139, "cm")).toBe("1.39 mm");
    expect(withUnit(4.09, "cm")).toBe("4.09 cm");
    expect(withUnit(0.035, "GeV")).toBe("35 MeV");
    expect(withUnit(0.561, "GeV")).toBe("0.561 GeV");
    expect(withUnit(3, "ns")).toBe("3 ns");
  });
  it("reads a sentinel as words, and tells indices and copied columns apart", () => {
    const t = {
      n: 1,
      columns: { time: new Float32Array([-99]), trackIdx: new Int32Array([-1]), width: new Float32Array([-1]) },
    } as unknown as Table;
    const d = { ...ele, missing: { width: -1 } };
    expect(cellText(header, d, "Electron", t, "time", 0)).toEqual(["no time", ""]);
    expect(cellText(header, d, "Electron", t, "trackIdx", 0)).toEqual(["none", ""]);
    expect(cellText(header, d, "Electron", t, "width", 0)).toEqual(["not set", ""]);
    expect(
      ["trackIdx", "x", "px", "pt"].map((c) => [isIndex(header, "Electron", c), isCopied(header, "Electron", c)]),
    ).toEqual([
      [true, false],
      [false, true],
      [false, true],
      [false, false],
    ]);
  });
  it("describes a row by its hint, and a layer without one by its cut's quantity", () => {
    const t = {
      n: 1,
      columns: { pt: new Float32Array([65.5]), rechit_energy: new Float32Array([0.0072]) },
    } as unknown as Table;
    expect(describeRow(header, ele, t, 0)).toBe("pT 65.5 GeV");
    const hit = layer("Hit", "HGCal hits", "HGCal", {
      cut: { group: "g", column: "rechit_energy", unit: "GeV" },
    });
    expect(describeRow(header, hit, t, 0)).toBe("E 7.2 MeV");
  });
});
