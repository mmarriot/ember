import { describe, expect, it } from "vitest";
import type { DisplayLayer, EventData, Header, Table } from "../io/bundle";
import { colours, PALETTES } from "./colour";

// candidate 0 -> clusters 0, 2; cluster 1 in no candidate; clusters -> hits: 0 -> [0, 1], 1 -> [2], 2 -> [3]; hit 4 in none
const csr = (rows: number[][]) => ({
  offsets: Uint32Array.from(rows.reduce((o, r) => [...o, o[o.length - 1] + r.length], [0])),
  indices: Uint32Array.from(rows.flat()),
  weights: {},
});
const table = (n: number, columns: Table["columns"] = {}): Table => ({ n, columns });
const ev = {
  id: [1, 1, 1],
  tables: { Cand: table(2), LC: table(3), Hit: table(5) },
  relations: { candLCs: csr([[0, 2], []]), lcHits: csr([[0, 1], [2], [3]]) },
} as unknown as EventData;
const layer = (table: string, colourBy: DisplayLayer["colourBy"]) =>
  ({ table, repr: "markers", label: table, visible: true, position: ["x", "y", "z"], colourBy }) as DisplayLayer;
const header = {
  relations: { candLCs: { from: "Cand", to: "LC", weights: [] }, lcHits: { from: "LC", to: "Hit", weights: [] } },
  display: [layer("Cand", "row"), layer("LC", { relation: "candLCs" }), layer("Hit", { relation: "lcHits" })],
} as unknown as Header;
const pal = PALETTES.dark;
const hex = (rgb: Float32Array, i: number) =>
  "#" +
  [0, 1, 2]
    .map((c) =>
      Math.round(rgb[3 * i + c] * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

describe("relation colouring", () => {
  it("follows a chain: a hit takes its cluster's colour, which is its candidate's; none stays grey", () => {
    const c = colours(header.display[2], ev.tables.Hit, ev, header, pal);
    expect([0, 1, 3].map((i) => hex(c.rgb, i))).toEqual(Array(3).fill(pal.categories[0])); // candidate 0's colour
    expect(hex(c.rgb, 2)).toBe(pal.unassigned); // its cluster is in no candidate
    expect(hex(c.rgb, 4)).toBe(pal.unassigned); // in no cluster
    expect([...c.emphasis!]).toEqual([1, 1, 0, 1, 0]);
  });
  it("uses the colouring the caller says a related table has", () => {
    // clusters coloured one per object instead: hits take their cluster's own colour
    const layerFor = (t: string) => (t === "LC" ? layer("LC", "row") : header.display.find((l) => l.table === t));
    const c = colours(header.display[2], ev.tables.Hit, ev, header, pal, { layerFor });
    expect([0, 2, 3].map((i) => hex(c.rgb, i))).toEqual([pal.categories[0], pal.categories[1], pal.categories[2]]);
  });
  it("in truth colours, draws pile-up small in its own grey, also along a chain, and a match below `good` grey", () => {
    // particles 0 (signal) and 1 (pile-up), both generator particles; hits 0, 1 from particle 0, hit 2 from 1; trackster
    // 0 is 80% from particle 0, trackster 1 30% from particle 1
    const tev = {
      id: [1, 1, 1],
      tables: {
        P: table(2, {
          energy: Float32Array.from([10, 50]),
          flags: Uint32Array.from([4, 4]),
          signal: Uint8Array.from([1, 0]),
        }),
        Hit: table(3),
        T: table(2, { e: Float32Array.from([10, 10]) }),
      },
      relations: {
        pHits: { ...csr([[0, 1], [2]]), weights: { simE: Float32Array.from([1, 1, 1]) } },
        tTruth: { ...csr([[0], [1]]), weights: { shared: Float32Array.from([8, 3]) } },
      },
    } as unknown as EventData;
    const th = {
      relations: {
        pHits: { from: "P", to: "Hit", weights: ["simE"], association: true, best: { weight: "simE", order: "max" } },
        tTruth: {
          from: "T",
          to: "P",
          weights: ["shared"],
          association: true,
          match: { measure: "energy", in: "HGCal", shared: "shared", over: ["e"], good: 0.5 },
        },
      },
      display: [
        {
          ...layer("P", "identity"),
          truth: true,
          colour: "energy",
          particle: { flags: "flags", bit: 2, first: "signal" },
        },
        layer("Hit", { relation: "pHits" }),
        layer("T", { relation: "tTruth" }),
      ],
    } as unknown as Header;
    const hits = colours(th.display[1], tev.tables.Hit, tev, th, pal);
    expect([0, 1, 2].map((i) => hex(hits.rgb, i))).toEqual(
      [pal.identity[0], pal.identity[0], pal.pileup].map((c) => c.toLowerCase()),
    );
    expect([...hits.emphasis!]).toEqual([1, 1, 0]);
    const ts = colours(th.display[2], tev.tables.T, tev, th, pal);
    expect([hex(ts.rgb, 0), hex(ts.rgb, 1)]).toEqual([pal.identity[0].toLowerCase(), pal.unassigned]); // 30% is not a clean match
  });
  it("stops at a loop", () => {
    const loop = {
      ...header,
      display: [layer("LC", { relation: "lcHits" }), layer("Hit", { relation: "lcHits" })],
    } as unknown as Header;
    expect(() => colours(loop.display[1], ev.tables.Hit, ev, loop, pal)).not.toThrow();
  });
});

describe("identity colouring", () => {
  it("gives the largest objects a colour each, never repeated, and the rest one 'other' colour", () => {
    const n = pal.identity.length + 2,
      energy = Float32Array.from({ length: n }, (_, i) => i); // largest last
    const t = table(n, { energy }),
      d = { ...layer("Cand", "identity"), colour: "energy" } as DisplayLayer;
    const c = colours(d, t, { ...ev, tables: { Cand: t } } as EventData, header, pal);
    expect(hex(c.rgb, n - 1)).toBe(pal.identity[0].toLowerCase());
    expect(hex(c.rgb, 2)).toBe(pal.identity[pal.identity.length - 1].toLowerCase());
    expect([0, 1].map((i) => hex(c.rgb, i))).toEqual([pal.other, pal.other]);
    expect(c.legend.kind === "category" && c.legend.items?.map((it) => it.ref?.row)).toEqual([
      n - 1,
      n - 2,
      n - 3,
      n - 4,
      n - 5,
      n - 6,
      n - 7,
    ]);
  });
  it("colours a layer cluster like the particle with the most simulated energy in its hits", () => {
    const pev = {
      ...ev,
      tables: { ...ev.tables, P: table(2, { energy: Float32Array.from([10, 20]) }) },
      relations: {
        ...ev.relations,
        pHits: { ...csr([[0, 1, 3], [2]]), weights: { simE: Float32Array.from([1, 1, 1, 5]) } },
      },
    } as unknown as EventData;
    const ph = {
      ...header,
      relations: {
        ...header.relations,
        pHits: { from: "P", to: "Hit", weights: ["simE"], association: true, best: { weight: "simE", order: "max" } },
      },
      display: [
        ...header.display.map((l) => (l.table === "Hit" ? { ...l, repr: "cells" } : l)),
        { ...layer("P", "identity"), truth: true, colour: "energy" },
      ],
    } as unknown as Header; // particles anchor on hits drawn as cells
    const c = colours(layer("LC", { content: "P" }), pev.tables.LC, pev, ph, pal);
    // cluster 0 (hits 0, 1): particle 0; cluster 1 (hit 2): particle 1, the larger, so the first colour; cluster 2 (hit 3): particle 0
    expect([0, 1, 2].map((i) => hex(c.rgb, i))).toEqual(
      [pal.identity[1], pal.identity[0], pal.identity[1]].map((x) => x.toLowerCase()),
    );
    expect(c.legend.kind === "category" && c.legend.text).toContain("derived in evd");
  });
});

describe("category colouring", () => {
  it("follows the order of names given as pairs, which an object with integer keys loses", () => {
    const t = table(4, { subdet: Int32Array.from([5, 4, 1, 2]) });
    const names: [string, string][] = [
      ["1", "pixel barrel"],
      ["2", "pixel endcap"],
      ["5", "outer barrel"],
      ["4", "outer endcap"],
    ];
    const c = colours(layer("H", { category: "subdet", names }), t, ev, header, pal);
    expect(c.legend.kind === "category" && c.legend.items?.map((it) => it.label)).toEqual(names.map(([, n]) => n));
    const asObject = colours(layer("H", { category: "subdet", names: Object.fromEntries(names) }), t, ev, header, pal);
    expect(asObject.legend.kind === "category" && asObject.legend.items?.map((it) => it.label)).toEqual([
      "pixel barrel",
      "pixel endcap",
      "outer endcap",
      "outer barrel",
    ]);
  });
});

describe("fixed colours", () => {
  const jets = { ...layer("Cand", "none"), fixedColour: "#f0a830", colour: "pt" } as DisplayLayer;
  it("give every row the kind's colour, over the old viewers' fallback 'none'", () => {
    const c = colours(jets, ev.tables.Cand, ev, header, pal);
    expect([0, 1].map((i) => hex(c.rgb, i))).toEqual(["#f0a830", "#f0a830"]);
    expect(c.legend).toMatchObject({ kind: "category", items: [{ colour: "#f0a830" }] });
    expect(hex(colours({ ...jets, colourBy: undefined }, ev.tables.Cand, ev, header, pal).rgb, 0)).toBe("#f0a830");
  });
  it("give way to a colour mode's colouring", () => {
    expect(hex(colours({ ...jets, colourBy: "row" }, ev.tables.Cand, ev, header, pal).rgb, 1)).toBe(pal.categories[1]);
  });
});
