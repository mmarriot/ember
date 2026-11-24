import { beforeEach, describe, expect, it } from "vitest";
import type { Bundle } from "../../io/bundle";
import type { DisplayLayer, EventData, Header } from "../../io/format";
import type { Ref } from "../event/relations";
// The store sets the page's theme as it loads: a stand-in page (the tests run without a DOM).
Object.assign(globalThis, { document: { documentElement: { dataset: {} } } });
const {
  bundle,
  clearPicks,
  focus,
  focusOn,
  highlight,
  look,
  pickTruth,
  rawEvent,
  selection,
  togglePick,
  truthDraw,
  truthPicks,
} = await import(".");

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
// Truth particles 0 (made at vertex 0, ends at vertex 1) -> 1 (made at vertex 1), and 2 on its own (vertex 2); each
// left energy in hit 0, 1, 2.
const header = {
  display: [
    layer("Part", { truth: true, onSelection: true, particle: { flags: "flags", bit: 2 } }),
    layer("Vtx", { truth: true, onSelection: true }),
    layer("Hit", { repr: "cells" }),
  ],
  tables: {},
  relations: {
    kids: { from: "Part", to: "Part", weights: [] },
    prod: { from: "Part", to: "Vtx", weights: [] },
    hits: { from: "Part", to: "Hit", weights: [], association: true },
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
        decayVertexIdx: ints([1, -1, -1]),
      },
    },
    Vtx: { n: 3, columns: { x: new Float32Array(3) } },
    Hit: { n: 3, columns: { x: new Float32Array(3) } },
  },
  relations: { kids: csr([[1], [], []]), prod: csr([[0], [1], [2]]), hits: csr([[0], [1], [2]]) },
} as unknown as EventData;
const at = (table: string, row = 0): Ref => ({ table, row });
const drawn = (table: string) => [...(highlight.value?.get(table) ?? [])].sort();
const state = () => ({ picks: truthPicks.value, selection: selection.value?.row, focus: focus.value?.row });

beforeEach(() => {
  bundle.value = { header, events: [{}] } as unknown as Bundle;
  rawEvent.value = ev;
  selection.value = null;
  truthDraw.value = "descendants";
});

describe("picking truth particles", () => {
  it("picks one: the card and the focus are on it, the view draws it with its descendants, or alone", () => {
    pickTruth(0);
    expect(state()).toEqual({ picks: [0], selection: 0, focus: 0 });
    expect([drawn("Part"), drawn("Vtx")]).toEqual([
      [0, 1],
      [0, 1],
    ]);
    truthDraw.value = "particle";
    expect([drawn("Part"), drawn("Vtx")]).toEqual([[0], [0, 1]]); // where it was made and where it ended
    expect(drawn("Hit")).toEqual([0, 1]); // the hits stay the focus's, its descendants' too
  });
  it("ticks more: the last pick is the card's and the focus; unticking goes back to the one before", () => {
    pickTruth(0);
    togglePick(2);
    expect(state()).toEqual({ picks: [0, 2], selection: 2, focus: 2 });
    expect(drawn("Part")).toEqual([0, 1, 2]);
    expect(drawn("Hit")).toEqual([2]); // reco and hits follow the last pick
    togglePick(2);
    expect(state()).toEqual({ picks: [0], selection: 0, focus: 0 });
    togglePick(0);
    expect(state()).toEqual({ picks: [], selection: undefined, focus: undefined });
  });
  it("clears the picks and the selection", () => {
    pickTruth(0);
    togglePick(2);
    clearPicks();
    expect(state()).toEqual({ picks: [], selection: undefined, focus: undefined });
  });
  it("follows the focus: a truth particle chosen elsewhere is the only pick, anything else ends them", () => {
    pickTruth(0);
    togglePick(2);
    selection.value = at("Part", 1); // a click in the view on a particle drawn for the focus: the focus stays
    expect(state()).toEqual({ picks: [0, 2], selection: 1, focus: 2 });
    focusOn(at("Part", 1));
    expect(truthPicks.value).toEqual([1]);
    focusOn(at("Hit", 0));
    selection.value = at("Hit", 0);
    expect(truthPicks.value).toEqual([]);
  });
  it("leaves the truth of an object looked at from a card as its own: a particle, a vertex", () => {
    truthDraw.value = "particle";
    pickTruth(0);
    look(at("Part", 1));
    expect([truthPicks.value, drawn("Part")]).toEqual([[0], [1]]);
    look(at("Vtx", 2));
    expect([truthPicks.value, drawn("Vtx")]).toEqual([[0], [2]]);
  });
});
