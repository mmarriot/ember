import { describe as group, expect, it } from "vitest";
import type { Bundle } from "../../io/bundle";
import type { EventData } from "../../io/format";
// The store sets the page's theme as it loads: a stand-in page (the tests run without a DOM).
Object.assign(globalThis, { document: { documentElement: { dataset: {} } } });
const { bundle, describe, showEvent } = await import(".");

group("describe", () => {
  it("names a value by `names`, else after its `prefix`, else with its unit", async () => {
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
    expect(describe("Seg", 0)).toBe("St 4 · ME1/1-30 · 2 ns");
  });
});
