import { describe, expect, it } from "vitest";
import type { Bundle } from "../../io/bundle";
import type { DisplayLayer, Header } from "../../io/format";
import { PALETTES, type Legend } from "../../render/colour";
// The store sets the page's theme as it loads: a stand-in page (the tests run without a DOM).
Object.assign(globalThis, { document: { documentElement: { dataset: {} } } });
const { bundle, colourChoice, layerKey, legends, rawEvent, shown, theme, truthLevel, visible } = await import(
  "../store"
);
const { layerEntries, modeKey, viewKey } = await import("./key");
const { COLOUR_LEVELS } = await import("../truth/truth");

const layer = (table: string, extra: Partial<DisplayLayer> = {}) =>
  ({ table, repr: "markers", group: table, label: table, position: ["x", "x", "x"], ...extra }) as DisplayLayer;
const pal = PALETTES.light;
const ramp: Legend = {
  kind: "ramp",
  palette: "heat",
  range: { scale: "log", lo: -2, hi: Math.log10(20) },
  column: "energy",
  unit: "GeV",
};

/** A bundle of one event with candidates (the reco root, by type), jets and muons in their kind's colour, and hits
 *  coloured by energy; every layer ticked, with the legends the scene would give them. */
function open() {
  const display = [
    layer("Cand", { stage: 0, colourBy: { category: "pdgId" } }),
    layer("Jet", { fixedColour: "#A898C8", colourBy: "none", group: "Jets", label: "AK4 PUPPI" }), // as bundles give it
    layer("Muon", { fixedColour: "#7A0010", label: "Muons" }),
    layer("Hit", { repr: "cells", colour: "energy", label: "HGCal hits" }),
  ];
  bundle.value = {
    header: { display, tables: {}, relations: {} } as unknown as Header,
    events: [{}],
    keep: () => {},
  } as unknown as Bundle;
  const one = { n: 1, columns: { x: new Float32Array([0]) } };
  rawEvent.value = { id: [1, 1, 1], tables: { Cand: one, Jet: one, Muon: one, Hit: one }, relations: {} };
  theme.value = "light";
  visible.value = Object.fromEntries(display.map((d) => [layerKey(d), true]));
  const items = (label: string, colour: string): Legend => ({ kind: "category", text: "", items: [{ label, colour }] });
  legends.value = {
    "Cand:markers": { kind: "category", text: "by type", items: [{ label: "photon", colour: "#2E9BD6" }] },
    "Jet:markers": items("AK4 PUPPI", "#A898C8"),
    "Muon:markers": items("Muons", "#7A0010"),
    "Hit:cells": ramp,
  };
  return display;
}

describe("layerEntries", () => {
  it("gives a value ramp its colours and its range, with or without its column", () => {
    const [, , , hits] = open();
    expect(layerEntries(hits, ramp, pal)).toEqual([
      { label: "energy 0.0100 – 20.0 GeV", colours: pal.ramps.heat, ramp: true },
    ]);
    expect(layerEntries(hits, ramp, pal, false)[0].label).toBe("0.0100 – 20.0 GeV");
  });

  it("lists named categories, and gives one colour per object a few of its colours", () => {
    const [cand] = open();
    expect(layerEntries(cand, legends.value["Cand:markers"], pal)).toEqual([{ label: "photon", colours: ["#2E9BD6"] }]);
    const rows: Legend = { kind: "category", text: "one colour per object", note: "grey: none" };
    expect(layerEntries(layer("T", { colourBy: "row" }), rows, pal)).toEqual([
      { label: "one colour per object; grey: none", colours: pal.categories.slice(0, 5) },
    ]);
  });
});

describe("the view's key", () => {
  it("is the mode's group, then the kinds in their own colour together, then each other layer's scale", () => {
    open();
    expect(modeKey.value).toEqual({
      id: "pid",
      title: "candidate type (reco)",
      entries: [
        { label: "photon", colours: ["#2E9BD6"] },
        { label: "in no candidate", colours: [pal.unassigned], small: true },
      ],
    });
    expect(viewKey.value.map((g) => [g.title, g.entries.map((e) => e.label)])).toEqual([
      ["candidate type (reco)", ["photon", "in no candidate"]],
      ["", ["Jets: AK4 PUPPI", "Muons"]],
      ["HGCal hits", ["energy 0.0100 – 20.0 GeV"]],
    ]);
  });

  it("leaves out a layer with nothing drawn (all of it cut away)", () => {
    open();
    shown.value = { "Hit:cells": 0 };
    expect(viewKey.value.map((g) => g.id)).toEqual(["pid", "kinds"]);
    shown.value = {};
  });

  it("leaves out the mode's group when nothing drawn takes its colours", () => {
    open();
    visible.value = { ...visible.value, "Cand:markers": false };
    expect(viewKey.value.map((g) => g.id)).toEqual(["kinds", "Hit:cells"]);
  });

  it("follows what is drawn and the theme", () => {
    open();
    visible.value = { ...visible.value, "Jet:markers": false, "Hit:cells": false };
    theme.value = "dark";
    expect(viewKey.value.map((g) => g.title)).toEqual(["candidate type (reco)", ""]);
    expect(viewKey.value[0].entries[1].colours).toEqual([PALETTES.dark.unassigned]);
  });
});

describe("the truth group", () => {
  /** Truth particles (`signal`: which are of the signal collision) owning hits, coloured by truth, with the truth
   *  layer's legend as the scene gives it. */
  function openTruth(signal: number[], items: { label: string; colour: string }[]) {
    const display = [
      layer("P", { truth: true, colourBy: "identity", particle: { flags: "flags", bit: 2, first: "signal" } }),
      layer("Hit", { repr: "cells" }),
    ];
    const relations = { pHits: { from: "P", to: "Hit", weights: [], association: true } };
    bundle.value = {
      header: { display, tables: {}, relations } as unknown as Header,
      events: [{}],
      keep: () => {},
    } as unknown as Bundle;
    const columns = { x: new Float32Array(signal.length), flags: new Uint32Array(signal.length).fill(4) };
    rawEvent.value = {
      id: [1, 1, 1],
      tables: { P: { n: signal.length, columns: { ...columns, signal: Uint8Array.from(signal) } } },
      relations: {},
    };
    colourChoice.value = "truth";
    legends.value = { "P:markers": { kind: "category", text: "", items } };
  }
  const labels = () => modeKey.value?.entries.map((e) => e.label);

  it("by class, lists the classes drawn and no other grey", () => {
    openTruth(
      [1, 0],
      [
        { label: "signal collision", colour: "#D55E00" },
        { label: "pile-up", colour: "#2E8FCB" },
      ],
    );
    truthLevel.value = COLOUR_LEVELS.find((l) => l.id === "collision")!;
    expect(labels()).toEqual(["signal collision", "pile-up", "no in-time truth, or not cleanly matched"]);
  });

  it("by particle, lists pile-up only in an event that has some", () => {
    truthLevel.value = null;
    openTruth([1, 1], []);
    expect(labels()).toEqual(["other signal", "no simulated energy, or not cleanly matched"]);
    openTruth([1, 0], []);
    expect(labels()).toContain("pile-up");
  });
});
