import { describe as group, expect, it } from "vitest";
import type { Bundle } from "../../io/bundle";
import type { EventData } from "../../io/format";
// The store sets the page's theme as it loads: a stand-in page (the tests run without a DOM).
Object.assign(globalThis, { document: { documentElement: { dataset: {} } } });
const { bundle, describe, showEvent } = await import(".");

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
