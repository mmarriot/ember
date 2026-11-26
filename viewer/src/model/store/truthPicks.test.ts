import { beforeEach, describe, expect, it } from "vitest";
import type { Bundle } from "../../io/bundle";
import type { DisplayLayer, EventData, Header } from "../../io/format";
import type { Ref } from "../event/relations";
// The store sets the page's theme as it loads: a stand-in page (the tests run without a DOM).
Object.assign(globalThis, { document: { documentElement: { dataset: {} } } });
const {
  bundle,
  clearPicks,
  cuts,
  focus,
  focusBack,
  focusHistory,
  focusOn,
  focusRows,
  highlight,
  look,
  rawEvent,
  selection,
  selectTruth,
  setPicks,
  togglePick,
  truthDraw,
  truthLooked,
  truthPicks,
  visible,
} = await import(".");
const { onlyFor } = await import("../../control/sceneFocus");

const layer = (table: string, extra: Partial<DisplayLayer> = {}) =>
  ({
    table,
    repr: "markers",
    group: table,
    label: table,
    position: ["x", "x", "x"],
    visible: true,
    ...extra,
  }) as DisplayLayer;
const csr = (rows: number[][]) => ({
  offsets: Uint32Array.from(rows.reduce((o, r) => [...o, o[o.length - 1] + r.length], [0])),
  indices: Uint32Array.from(rows.flat()),
  weights: {},
});
// Truth particles 0 (made at vertex 0, ends at vertex 1) -> 1 (made at vertex 1, ends at vertex 3), and 2 on its own
// (vertex 2); each left energy in hit 0, 1, 2. Energies 5, 0.5 and 0.2 GeV, against a cut of 1 GeV. Track 0 (pT 0.5
// GeV, below its cut of 1 GeV) is matched to particle 1.
const header = {
  display: [
    layer("Part", {
      truth: true,
      onSelection: true,
      particle: { flags: "flags", bit: 2 },
      cut: { group: "Truth E", unit: "GeV", default: 1, column: "energy" },
    }),
    layer("Vtx", { truth: true, onSelection: true }),
    layer("Hit", { repr: "cells" }),
    layer("Track", { cut: { group: "Track pT", unit: "GeV", default: 1, column: "pt" } }),
  ],
  tables: {},
  relations: {
    kids: { from: "Part", to: "Part", weights: [] },
    prod: { from: "Part", to: "Vtx", weights: [] },
    decay: { from: "Part", to: "Vtx", weights: [] },
    hits: { from: "Part", to: "Hit", weights: [], association: true },
    trackTruth: { from: "Track", to: "Part", weights: [], association: true },
  },
} as unknown as Header;
const ints = (xs: number[]) => Int32Array.from(xs);
const ev = {
  id: [1, 1, 1],
  tables: {
    Part: {
      n: 3,
      columns: {
        x: new Float32Array(3),
        pdgId: ints([211, 22, 11]),
        status: ints([1, 0, 1]),
        flags: ints([4, 0, 4]),
        prodVertexIdx: ints([0, 1, 2]),
        decayVertexIdx: ints([1, 3, -1]),
        energy: Float32Array.from([5, 0.5, 0.2]),
      },
    },
    Vtx: { n: 4, columns: { x: new Float32Array(4) } },
    Hit: { n: 3, columns: { x: new Float32Array(3) } },
    Track: { n: 1, columns: { x: new Float32Array(1), pt: Float32Array.from([0.5]) } },
  },
  relations: {
    kids: csr([[1], [], []]),
    prod: csr([[0], [1], [2]]),
    decay: csr([[1], [3], []]),
    hits: csr([[0], [1], [2]]),
    trackTruth: csr([[1]]),
  },
} as unknown as EventData;
const at = (table: string, row = 0): Ref => ({ table, row });
const drawn = (table: string) => [...(highlight.value?.get(table) ?? [])].sort();
const state = () => ({ picks: truthPicks.value, selection: selection.value?.row, focus: focus.value?.row });

beforeEach(() => {
  bundle.value = { header, events: [{}] } as unknown as Bundle;
  rawEvent.value = ev;
  selection.value = null;
  truthDraw.value = "descendants";
  visible.value = { "Part:markers": true, "Vtx:markers": true, "Hit:cells": true, "Track:markers": true };
  cuts.value = { "Truth E": 1, "Track pT": 1 };
});

describe("picking truth particles", () => {
  it("selects one by its name: the card and the focus are on it, the view draws it with its descendants, or alone", () => {
    selectTruth(0);
    expect(state()).toEqual({ picks: [], selection: 0, focus: 0 }); // looked at, not ticked
    expect([drawn("Part"), drawn("Vtx"), drawn("Hit")]).toEqual([
      [0, 1],
      [0, 1, 3],
      [0, 1],
    ]);
    truthDraw.value = "particle";
    expect([drawn("Part"), drawn("Vtx")]).toEqual([[0], [0, 1]]); // where it was made and where it ended
    expect(drawn("Hit")).toEqual([0]); // its own hits, not its descendants'
  });
  it("ticks: each tick adds one and looks at it; unticking the one looked at goes back to the last tick", () => {
    togglePick(0);
    togglePick(2);
    expect(state()).toEqual({ picks: [0, 2], selection: 2, focus: 2 });
    expect(drawn("Part")).toEqual([0, 1, 2]);
    expect(drawn("Hit")).toEqual([0, 1, 2]); // the hits and reco of every pick, with their descendants'
    truthDraw.value = "particle";
    expect(drawn("Hit")).toEqual([0, 2]);
    togglePick(2);
    expect(state()).toEqual({ picks: [0], selection: 0, focus: 0 });
    togglePick(0);
    expect(state()).toEqual({ picks: [], selection: undefined, focus: undefined });
  });
  it("selects a name among the ticks without changing them, and draws it with them", () => {
    truthDraw.value = "particle";
    togglePick(0);
    selectTruth(2);
    expect(state()).toEqual({ picks: [0], selection: 2, focus: 2 });
    expect(drawn("Part")).toEqual([0, 2]);
    selectTruth(0);
    expect(state()).toEqual({ picks: [0], selection: 0, focus: 0 });
    expect(drawn("Part")).toEqual([0]); // 2 was only looked at
    selectTruth(2);
    togglePick(0); // unticking another than the one looked at leaves the card
    expect(state()).toEqual({ picks: [], selection: 2, focus: 2 });
  });
  it("ticks and unticks a particle with those below it", () => {
    setPicks([0, 1], true);
    expect(state()).toEqual({ picks: [0, 1], selection: 0, focus: 0 });
    setPicks([0, 1], true); // nothing twice
    expect(truthPicks.value).toEqual([0, 1]);
    togglePick(2);
    setPicks([0, 1], false);
    expect(state()).toEqual({ picks: [2], selection: 2, focus: 2 }); // the one looked at stays
    setPicks([2], false);
    expect(state()).toEqual({ picks: [], selection: undefined, focus: undefined });
  });
  it("clears the picks and the selection", () => {
    togglePick(0);
    togglePick(2);
    clearPicks();
    expect(state()).toEqual({ picks: [], selection: undefined, focus: undefined });
  });
  it("follows the focus: a truth particle chosen elsewhere is looked at with the ticks, anything else ends them", () => {
    togglePick(0);
    togglePick(2);
    selection.value = at("Part", 1); // a click in the view on a particle drawn for the focus: the focus stays
    expect(state()).toEqual({ picks: [0, 2], selection: 1, focus: 2 });
    focusOn(at("Part", 1));
    expect([truthPicks.value, truthLooked.value]).toEqual([[0, 2], 1]);
    focusOn(at("Hit", 0));
    selection.value = at("Hit", 0);
    expect([truthPicks.value, truthLooked.value]).toEqual([[], null]);
  });
  it("keeps ticks out of the way back: back returns to before the first pick", () => {
    focusOn(at("Hit", 0));
    selection.value = at("Hit", 0);
    togglePick(0);
    togglePick(2);
    togglePick(1);
    expect(focusHistory.value).toEqual([at("Hit", 0)]);
    expect(focusBack()).toEqual(at("Hit", 0));
    expect(truthPicks.value).toEqual([]);
  });
  it("leaves the truth of an object looked at from a card as its own: a particle, a vertex", () => {
    truthDraw.value = "particle";
    togglePick(0);
    look(at("Part", 1));
    expect([truthPicks.value, drawn("Part")]).toEqual([[0], [1]]);
    look(at("Vtx", 2));
    expect([truthPicks.value, drawn("Vtx")]).toEqual([[0], [2]]);
  });
  it("draws the picks' vertices and descendants also when their collections are unticked", () => {
    visible.value = { "Part:markers": false, "Vtx:markers": false, "Hit:cells": true };
    truthDraw.value = "particle";
    togglePick(0);
    expect([...focusRows(header.display[1])!].sort()).toEqual([0, 1]);
    truthDraw.value = "descendants";
    expect([...focusRows(header.display[0])!].sort()).toEqual([0, 1]);
    expect([...focusRows(header.display[1])!].sort()).toEqual([0, 1, 3]);
    look(at("Hit", 1)); // another focus: only what is selected
    expect(focusRows(header.display[1])).toBeUndefined();
  });
  it("cuts the descendants and the vertices only they reach, never the picks", () => {
    const [part, vtx] = header.display,
      rows = (d: DisplayLayer) => [...onlyFor(d, `${d.table}:markers`, highlight.value, false)!].sort();
    togglePick(0);
    expect([rows(part), rows(vtx)]).toEqual([[0], [0, 1]]); // particle 1 (0.5 GeV) and its end vertex 3 are cut
    togglePick(2); // 0.2 GeV, but picked
    expect([rows(part), rows(vtx)]).toEqual([
      [0, 2],
      [0, 1, 2],
    ]);
    cuts.value = { "Truth E": 0, "Track pT": 1 };
    expect([rows(part), rows(vtx)]).toEqual([
      [0, 1, 2],
      [0, 1, 2, 3],
    ]);
  });
  it("cuts the picks' truth by the truth cut alone, not by the cut of the reco matched to it", () => {
    const [part, vtx] = header.display,
      rows = (d: DisplayLayer) => [...onlyFor(d, `${d.table}:markers`, highlight.value, false)!].sort();
    cuts.value = { "Truth E": 0.3, "Track pT": 1 }; // particle 1 (0.5 GeV) passes; its only track (0.5 GeV) does not
    togglePick(0);
    expect(drawn("Track")).toEqual([0]);
    expect([rows(part), rows(vtx)]).toEqual([
      [0, 1],
      [0, 1, 3],
    ]);
  });
});
