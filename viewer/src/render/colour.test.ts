import { describe, expect, it } from "vitest";
import type { DisplayLayer, EventData, Header, Table } from "../io/format";
import { colours, PALETTES, typeColour } from "./colour";

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
    expect(c.legend.kind === "category" && c.legend.text).toContain("derived in Ember");
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

describe("particle type colours", () => {
  // PF candidates list their types as [value, name] pairs; TICL candidates as an object, whose integer keys JavaScript
  // reorders (11 electron first).
  const pf: [string, string][] = [
    ["211", "charged hadron"],
    ["22", "photon"],
    ["130", "neutral hadron"],
    ["11", "electron"],
    ["13", "muon"],
    ["1", "HF hadron"],
    ["2", "HF EM"],
  ];
  const ticl = { "22": "photon", "11": "electron", "13": "muon", "211": "charged hadron", "130": "neutral hadron" };
  const t = table(4, { pdgId: Int32Array.from([211, -11, 13, 22]) });
  const of = (names: DisplayLayer["colourBy"] & object, theme: keyof typeof PALETTES = "dark") => {
    const c = colours(layer("P", names), t, ev, header, PALETTES[theme]);
    return [0, 1, 2, 3].map((i) => hex(c.rgb, i));
  };
  const expected = (theme: keyof typeof PALETTES) =>
    ["charged hadron", "electron", "muon", "photon"].map((n) => typeColour(PALETTES[theme], n)!.toLowerCase());
  it("are keyed by the type's name, not by its place in names", () => {
    expect(of({ category: "pdgId", abs: true, names: pf })).toEqual(expected("dark"));
    expect(of({ category: "pdgId", abs: true, names: [...pf].reverse() })).toEqual(expected("dark"));
  });
  it("are the same for PF and TICL candidates of a type, in both themes", () => {
    for (const theme of ["dark", "light"] as const) {
      expect(of({ category: "pdgId", abs: true, names: ticl }, theme)).toEqual(expected(theme));
      expect(of({ category: "pdgId", abs: true, names: pf }, theme)).toEqual(expected(theme));
    }
  });
  it("are all different in each theme, and named only by the table's own keys", () => {
    for (const p of [PALETTES.dark, PALETTES.light])
      expect(new Set(Object.values(p.types)).size).toBe(Object.keys(p.types).length);
    expect(typeColour(pal, "constructor")).toBeUndefined();
  });
  it("leave other names to the order of names, and the legend names each type", () => {
    const names: [string, string][] = [["13", "lepton"], ...pf.filter(([v]) => v !== "13")];
    const c = colours(layer("P", { category: "pdgId", abs: true, names }), t, ev, header, pal);
    expect(hex(c.rgb, 2)).toBe(pal.others[0].toLowerCase());
    expect(c.legend.kind === "category" && c.legend.items?.find((it) => it.label === "electron")?.colour).toBe(
      pal.types.electron,
    );
  });
  it("give a kind named after a type (electrons, jets) the type's colour in each theme", () => {
    const electrons = { ...layer("Cand", "none"), kind: "electron", fixedColour: "#3cc864" } as DisplayLayer;
    for (const p of [PALETTES.dark, PALETTES.light])
      expect(hex(colours(electrons, ev.tables.Cand, ev, header, p).rgb, 0)).toBe(p.types.electron.toLowerCase());
  });
  it("give a layer with the same profile colour as such a kind (global muon tracks) that type's colour too", () => {
    const muons = { ...layer("Mu", "none"), kind: "muon", fixedColour: "#e04040" } as DisplayLayer;
    const tracks = { ...layer("Cand", "none"), kind: "muonTrack", fixedColour: "#e04040" } as DisplayLayer;
    const other = { ...tracks, fixedColour: "#3fb8b0" } as DisplayLayer; // standalone tracks keep their own
    const h = { ...header, display: [...header.display, muons, tracks] } as Header;
    expect(hex(colours(tracks, ev.tables.Cand, ev, h, pal).rgb, 0)).toBe(pal.types.muon.toLowerCase());
    expect(hex(colours(other, ev.tables.Cand, ev, h, pal).rgb, 0)).toBe("#3fb8b0");
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
