import { beforeEach, describe, expect, it } from "vitest";
import type { Bundle, EventData, Header } from "../io/bundle";
import type { Ref } from "./relations";
// The store sets the page's theme as it loads: a stand-in page (the tests run without a DOM).
Object.assign(globalThis, { document: { documentElement: { dataset: {} } } });
const {
  anchor,
  bundle,
  focus,
  focusBack,
  focusHistory,
  focusOn,
  look,
  openCard,
  rawEvent,
  selection,
  subject,
  unlook,
} = await import("./store");

// jet 0 -> candidate 0 -> layer clusters 0, 1 -> hits 0, 1; a track on its own
const csr = (rows: number[][]) => ({
  offsets: Uint32Array.from(rows.reduce((o, r) => [...o, o[o.length - 1] + r.length], [0])),
  indices: Uint32Array.from(rows.flat()),
  weights: {},
});
const header = {
  tables: {},
  relations: {
    jetCand: { from: "Jet", to: "Cand", weights: [] },
    candLCs: { from: "Cand", to: "LC", weights: [] },
    lcHits: { from: "LC", to: "Hit", weights: [] },
  },
  display: ["Hit", "LC", "Cand", "Jet", "Trk"].map((table) => ({
    table,
    group: table,
    label: table,
    repr: "markers",
    visible: true,
    position: ["x", "y", "z"],
  })),
} as unknown as Header;
const ev = {
  id: [1, 1, 1],
  tables: Object.fromEntries(
    ["Jet", "Cand", "Trk"]
      .map((t) => [t, { n: 1, columns: {} }])
      .concat(["LC", "Hit"].map((t) => [t, { n: 2, columns: {} }])),
  ),
  relations: { jetCand: csr([[0]]), candLCs: csr([[0, 1]]), lcHits: csr([[0], [1]]) },
} as unknown as EventData;
const at = (table: string, row = 0): Ref => ({ table, row });
const name = (r: Ref | null) => (r ? `${r.table}${r.row}` : "none");
const state = () => ({
  card: name(subject.value),
  view: name(selection.value),
  focus: name(focus.value),
  back: focusHistory.value.map(name),
});
/** As ui/navigate.ts jump: a list row, N, a linked object clicked in the view. */
const jump = (ref: Ref) => {
  focusOn(ref);
  selection.value = { ...ref };
};

beforeEach(() => {
  bundle.value = { header, events: [{}] } as unknown as Bundle;
  rawEvent.value = ev;
  selection.value = null;
});

describe("looking at an object from another's card", () => {
  it("moves the view and keeps the card, with nothing added to the way back; stopping returns to the card's object", () => {
    jump(at("Cand"));
    look(at("LC", 1));
    expect(state()).toEqual({ card: "Cand0", view: "LC1", focus: "LC1", back: [] });
    look(at("Hit", 0)); // another one: the card still stays
    expect(state()).toEqual({ card: "Cand0", view: "Hit0", focus: "Hit0", back: [] });
    unlook();
    expect([state(), anchor.value]).toEqual([{ card: "Cand0", view: "Cand0", focus: "Cand0", back: [] }, null]);
  });
  it("comes back to the card's object as it was shown: a part selected inside a focus keeps that focus", () => {
    jump(at("Jet"));
    selection.value = at("Cand"); // a click on a part in the view: the jet stays the focus
    look(at("Hit", 1));
    unlook();
    expect(state()).toEqual({ card: "Cand0", view: "Cand0", focus: "Jet0", back: [] });
  });
  it("opens the card of the object looked at, and back returns to the card it was opened from", () => {
    jump(at("Cand"));
    look(at("LC", 0));
    openCard(at("LC", 0));
    expect(state()).toEqual({ card: "LC0", view: "LC0", focus: "LC0", back: ["Cand0"] });
    expect(name(focusBack())).toBe("Cand0");
  });
  it("ends when something is selected elsewhere, keeping the card's object for back and never the object looked at", () => {
    jump(at("Cand"));
    look(at("LC", 0));
    jump(at("Trk")); // a list row
    expect(state()).toEqual({ card: "Trk0", view: "Trk0", focus: "Trk0", back: ["Cand0"] });
    selection.value = null;
    jump(at("Cand"));
    look(at("LC", 0));
    selection.value = at("Jet"); // a click in the view on an object outside what is shown
    expect(state()).toEqual({ card: "Jet0", view: "Jet0", focus: "Jet0", back: ["Cand0"] });
    selection.value = null;
    jump(at("Cand"));
    look(at("LC", 0));
    selection.value = at("Hit", 0); // a click on a part of the object looked at: that object stays the focus
    expect(state()).toEqual({ card: "Hit0", view: "Hit0", focus: "LC0", back: ["Cand0"] });
  });
  it("ends with the selection: nothing is left of it", () => {
    jump(at("Cand"));
    look(at("LC", 0));
    selection.value = null;
    expect([state(), anchor.value]).toEqual([{ card: "none", view: "none", focus: "none", back: [] }, null]);
  });
});
