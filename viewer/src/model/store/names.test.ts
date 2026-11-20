import { describe as group, expect, it } from "vitest";
import type { Bundle } from "../../io/bundle";
import type { EventData } from "../../io/format";
// The store sets the page's theme as it loads: a stand-in page (the tests run without a DOM).
Object.assign(globalThis, { document: { documentElement: { dataset: {} } } });
const { bundle, describe, nameOf, numberOf, showEvent } = await import(".");

group("describe", () => {
  it("names a value by `names`, else after its `prefix` or its column, with its unit", async () => {
    const ev = {
      id: [1, 1, 0],
      tables: {
        Seg: {
          n: 1,
          columns: { station: new Int16Array([4]), chamber: new Int16Array([30]), t: new Float32Array([2]) },
        },
      },
      relations: {},
    } as unknown as EventData;
    bundle.value = {
      header: {
        display: [
          {
            table: "Seg",
            repr: "segments",
            describe: {
              columns: ["station", "chamber", "t"],
              names: { chamber: { "30": "ME1/1-30" } },
              prefix: { station: "St" },
            },
          },
        ],
        tables: { Seg: { doc: "", columns: { t: { type: "f4", doc: "time [ns]" } } } },
        relations: {},
      },
      events: [{}],
      event: async () => ev,
      keep: () => {},
    } as unknown as Bundle;
    await showEvent(0);
    expect(describe("Seg", 0)).toBe("St 4 · ME1/1-30 · t 2 ns");
  });
  it("names the quantity of each number: pT, E, E raw", async () => {
    const columns = {
      pt: new Float32Array([65.5]),
      energy: new Float32Array([177]),
      raw_energy: new Float32Array([178]),
    };
    const ev = { id: [1, 1, 0], tables: { O: { n: 1, columns } }, relations: {} } as unknown as EventData;
    const doc = { type: "f4", doc: "[GeV]" };
    bundle.value = {
      header: {
        display: [{ table: "O", repr: "markers", describe: { columns: ["pt", "energy", "raw_energy"] } }],
        tables: { O: { doc: "", columns: { pt: doc, energy: doc, raw_energy: doc } } },
        relations: {},
      },
      events: [{}],
      event: async () => ev,
      keep: () => {},
    } as unknown as Bundle;
    await showEvent(0);
    expect(describe("O", 0)).toBe("pT 65.5 GeV · E 177 GeV · E raw 178 GeV");
    expect(describe("O", 0, ["energy"])).toBe("pT 65.5 GeV · E raw 178 GeV");
    const d = bundle.value!.header.display[0];
    d.describe = { columns: ["pt"], prefix: { pt: "" } };
    expect(describe("O", 0)).toBe("65.5 GeV"); // an empty prefix: the bare number
  });
});

group("numberOf", () => {
  it("numbers objects by pT rank in their table, the row kept in the address; by row with nothing to rank by", async () => {
    const pt = [new Float32Array([5, 40, 12]), new Float32Array([50, 4, 12])],
      evs = pt.map(
        (p) =>
          ({
            id: [1, 1, 0],
            tables: {
              Ele: { n: 3, columns: { pt: p } },
              SV: { n: 3, columns: { nTracks: new Int16Array([2, 3, 5]), sumPt2: new Float32Array([1, 9, 4]) } },
              PV: { n: 2, columns: { z: new Float32Array([0.1, -3]) } },
              SC: { n: 3, columns: { energy: new Float32Array([7, 90, 30]) } },
              Hit: { n: 3, columns: { energy: new Float32Array([1, 9, 4]) } },
            },
            relations: {},
          }) as unknown as EventData,
      );
    const doc = { type: "f4", doc: "" };
    bundle.value = {
      header: {
        display: [
          { table: "Ele", group: "Electrons", label: "Electrons", kind: "electron", repr: "markers" },
          {
            table: "SV",
            group: "Secondary vertices",
            label: "Secondary",
            kind: "secondaryVertex",
            repr: "markers",
            list: { columns: ["nTracks"], sort: "sumPt2" },
          },
          { table: "PV", group: "Vertices", label: "Primary vertices", kind: "vertex", repr: "markers" },
          { table: "SC", group: "Superclusters", label: "ECAL barrel", kind: "supercluster", repr: "markers" },
          { table: "Hit", group: "Calorimeter hits", label: "ECAL barrel", kind: "hit", repr: "cells" },
        ],
        tables: {
          Ele: { doc: "", columns: { pt: doc } },
          SV: { doc: "", columns: { nTracks: doc, sumPt2: doc } },
          PV: { doc: "", columns: { z: doc } },
          SC: { doc: "", columns: { energy: doc } },
          Hit: { doc: "", columns: { energy: doc } },
        },
        relations: {},
      },
      events: [{}, {}],
      event: async (i: number) => evs[i],
      keep: () => {},
    } as unknown as Bundle;
    await showEvent(0);
    expect([0, 1, 2].map((r) => numberOf("Ele", r))).toEqual([3, 1, 2]);
    expect(nameOf({ table: "Ele", row: 1 })).toBe("Electron 1");
    // no pT: the column its object rows are sorted by; neither: its row (the leading primary vertex stays 1)
    expect([0, 1, 2].map((r) => numberOf("SV", r))).toEqual([3, 1, 2]);
    expect([0, 1].map((r) => numberOf("PV", r))).toEqual([1, 2]);
    // a supercluster by its energy, as its rows are listed; hits keep their row (no list shows their numbers)
    expect([0, 1, 2].map((r) => numberOf("SC", r))).toEqual([3, 1, 2]);
    expect([0, 1, 2].map((r) => numberOf("Hit", r))).toEqual([1, 2, 3]);
    // ranked again for the next event
    await showEvent(1);
    expect([0, 1, 2].map((r) => numberOf("Ele", r))).toEqual([1, 3, 2]);
  });
});
