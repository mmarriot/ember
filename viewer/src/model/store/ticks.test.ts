import { beforeEach, describe, expect, it } from "vitest";
import type { Bundle } from "../../io/bundle";
import type { EventData, Header } from "../../io/format";
// The store sets the page's theme as it loads: a stand-in page (the tests run without a DOM).
Object.assign(globalThis, { document: { documentElement: { dataset: {} } } });
const {
  bundle,
  chooseLevel,
  domain,
  drawnLayers,
  focusLayers,
  focusRows,
  focusRowsKey,
  levels,
  rawEvent,
  selection,
  shownLevel,
  stepFocusLevel,
  tickLevel,
  visible,
} = await import(".");

// candidate 0 -> trackster 0 -> layer clusters 0, 1 -> hits 0, 1, and the candidate's track 0 (in the tracker); a
// second candidate, trackster, cluster, hit and track of their own
const csr = (rows: number[][]) => ({
  offsets: Uint32Array.from(rows.reduce((o, r) => [...o, o[o.length - 1] + r.length], [0])),
  indices: Uint32Array.from(rows.flat()),
  weights: {},
});
const hgcal = ["Cand", "T", "LC", "Hit"],
  ticked = { "Cand:markers": true, "T:markers": false, "LC:markers": true, "Hit:markers": true, "Trk:markers": true };
const header = {
  tables: {},
  domains: [{ name: "HGCal" }, { name: "Tracker" }],
  relations: {
    candT: { from: "Cand", to: "T", weights: [] },
    tLC: { from: "T", to: "LC", weights: [] },
    lcHit: { from: "LC", to: "Hit", weights: [] },
    candTrk: { from: "Cand", to: "Trk", weights: [] },
  },
  display: [...hgcal, "Trk"].map((table) => ({
    table,
    group: table,
    label: table,
    repr: "markers",
    visible: ticked[`${table}:markers` as keyof typeof ticked],
    domain: table === "Trk" ? "Tracker" : "HGCal",
    position: ["x", "y", "z"],
  })),
} as unknown as Header;
const ev = {
  id: [1, 1, 1],
  tables: Object.fromEntries(
    ["Cand", "T", "Trk"]
      .map((t) => [t, { n: 2, columns: {} }])
      .concat(["LC", "Hit"].map((t) => [t, { n: 3, columns: {} }])),
  ),
  relations: {
    candT: csr([[0], [1]]),
    tLC: csr([[0, 1], [2]]),
    lcHit: csr([[0], [1], [2]]),
    candTrk: csr([[0], [1]]),
  },
} as unknown as EventData;
const cand = { table: "Cand", row: 0 };
const layer = (t: string) => header.display.find((d) => d.table === t)!;
const ticks = () =>
  Object.entries(visible.value)
    .filter(([, on]) => on)
    .map(([k]) => k.split(":")[0])
    .sort();

describe("what a selection draws: the ticks alone", () => {
  beforeEach(() => {
    bundle.value = { header, events: [{}] } as unknown as Bundle;
    rawEvent.value = ev;
    domain.value = null;
    visible.value = { ...ticked };
    selection.value = null;
  });

  it("never hides a ticked level: the candidate's layer clusters stay drawn, and are the level shown", () => {
    selection.value = cand;
    expect(levels.value.map((l) => `${l.name}${l.always ? " (always)" : ""}`)).toEqual([
      "T",
      "LC",
      "Hit (always)",
      "Trk (always)",
    ]);
    expect(drawnLayers.value["LC:markers"]).toBe(true);
    expect([...focusLayers.value]).toEqual([]);
    expect(shownLevel.value).toBe("LC");
  });
  it("never draws an unticked collection for its parts: not the tracksters, not the unticked layer clusters", () => {
    visible.value = { ...ticked, "LC:markers": false };
    selection.value = cand;
    expect([...focusLayers.value]).toEqual([]);
    expect(focusRows(layer("T"))).toBeUndefined();
    expect(shownLevel.value).toBeNull();
  });
  it("draws the selected object of an unticked collection, and only it", () => {
    visible.value = { ...ticked, "LC:markers": false };
    selection.value = cand;
    selection.value = { table: "LC", row: 1 }; // one of its parts, from the card's chain: the focus stays
    expect([...focusRows(layer("LC"))!]).toEqual([1]);
    expect([...focusLayers.value]).toEqual(["LC:markers"]);
  });
  it("says when the selected object moves within an unticked collection, so its layer is rebuilt", () => {
    visible.value = { ...ticked, "LC:markers": false };
    selection.value = cand;
    selection.value = { table: "LC", row: 0 };
    expect(focusRowsKey.value).toBe("LC:markers=0");
    selection.value = { table: "LC", row: 1 }; // same focus, same highlight, same layers: only the row moved
    expect(focusRowsKey.value).toBe("LC:markers=1");
  });
  it("leaves the key as it is for clicks among ticked objects, so nothing is rebuilt", () => {
    selection.value = cand;
    const key = focusRowsKey.value;
    selection.value = { table: "LC", row: 0 };
    selection.value = { table: "LC", row: 1 };
    expect(focusRowsKey.value).toBe(key);
  });
  it("draws only the selection's objects of a ticked collection in a part not looked at, none of an unticked one", () => {
    domain.value = "HGCal";
    selection.value = cand;
    expect(drawnLayers.value["Trk:markers"]).toBe(false);
    expect([...focusRows(layer("Trk"))!]).toEqual([0]);
    visible.value = { ...ticked, "Trk:markers": false };
    expect(focusRows(layer("Trk"))).toBeUndefined();
  });
  it("moves the tick between the levels in between with ↓ ↑, the others left as they are", () => {
    selection.value = cand;
    expect(stepFocusLevel(-1)).toBe(true); // up from the layer clusters: the tracksters
    expect(ticks()).toEqual(["Cand", "Hit", "T", "Trk"]);
    expect(shownLevel.value).toBe("T");
    stepFocusLevel(1); // and back down
    expect(ticks()).toEqual(["Cand", "Hit", "LC", "Trk"]);
    stepFocusLevel(1); // the last stays
    expect(ticks()).toEqual(["Cand", "Hit", "LC", "Trk"]);
    stepFocusLevel(-1);
    stepFocusLevel(-1); // above the first: none in between
    expect(ticks()).toEqual(["Cand", "Hit", "Trk"]);
    expect(shownLevel.value).toBeNull();
  });
  it("ticks or unticks one level from the chain, and draws one level alone from a link", () => {
    selection.value = cand;
    tickLevel("T", true);
    expect(ticks()).toEqual(["Cand", "Hit", "LC", "T", "Trk"]);
    tickLevel("Hit", false); // the hits too: a level always drawn is ticked like any other
    expect(ticks()).toEqual(["Cand", "LC", "T", "Trk"]);
    chooseLevel("T");
    expect(ticks()).toEqual(["Cand", "T", "Trk"]);
  });
});

describe("the levels of the part looked at", () => {
  // a jet with layer clusters and hits in HGCal, PF clusters and calorimeter hits in Calo
  const jet = {
    tables: {},
    domains: [{ name: "HGCal" }, { name: "Calo" }],
    relations: {
      jetLC: { from: "Jet", to: "LC", weights: [] },
      lcHit: { from: "LC", to: "Hit", weights: [] },
      jetPFC: { from: "Jet", to: "PFC", weights: [] },
      pfcCHit: { from: "PFC", to: "CHit", weights: [] },
    },
    display: [
      ["Jet", undefined],
      ["LC", "HGCal"],
      ["Hit", "HGCal"],
      ["PFC", "Calo"],
      ["CHit", "Calo"],
    ].map(([table, domain]) => ({
      table,
      group: table,
      label: table,
      repr: "markers",
      visible: true,
      domain,
      position: [],
    })),
  } as unknown as Header;
  const one = { n: 1, columns: {} };
  const jetEvent = {
    id: [1, 1, 2],
    tables: { Jet: one, LC: one, Hit: one, PFC: one, CHit: one },
    relations: { jetLC: csr([[0]]), lcHit: csr([[0]]), jetPFC: csr([[0]]), pfcCHit: csr([[0]]) },
  } as unknown as EventData;

  it("steps, names and draws alone only the levels of the part looked at, leaving the other parts' ticks", () => {
    bundle.value = { header: jet, events: [{}] } as unknown as Bundle;
    rawEvent.value = jetEvent;
    visible.value = Object.fromEntries(jet.display.map((d) => [`${d.table}:markers`, true]));
    domain.value = "HGCal";
    selection.value = { table: "Jet", row: 0 };
    expect(shownLevel.value).toBe("LC"); // not the PF clusters, out of view
    chooseLevel(null);
    expect(ticks()).toEqual(["CHit", "Hit", "Jet", "PFC"]);
    stepFocusLevel(1);
    expect(ticks()).toEqual(["CHit", "Hit", "Jet", "LC", "PFC"]);
  });
});
