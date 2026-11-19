import { describe, expect, it } from "vitest";
import type { Bundle } from "../../io/bundle";
import type { EventData } from "../../io/format";
import { PALETTES, type Legend } from "../../render/colour";
// The store sets the page's theme as it loads: a stand-in page (the tests run without a DOM).
Object.assign(globalThis, { document: { documentElement: { dataset: {} } } });
const { bundle, modes, withRootLegend } = await import(".");

describe("the colour root's legend", () => {
  it("is added when the root's layer is not drawn (the PF candidates unticked), and kept when it is", () => {
    const pf = {
      table: "PF",
      kind: "pfCandidate",
      repr: "markers",
      visible: false,
      colourBy: {
        category: "pdgId",
        abs: true,
        names: [
          ["211", "charged hadron"],
          ["22", "photon"],
        ],
      },
    };
    const header = {
      display: [pf],
      tables: { PF: { doc: "", columns: {} } },
      relations: {},
      view: { colourRoot: "pfCandidate" },
    };
    bundle.value = { header, events: [] } as unknown as Bundle;
    expect(modes.value.roots.reco).toBe("PF");
    const ev = {
      id: [1, 1, 0],
      tables: { PF: { n: 3, columns: { pdgId: Int32Array.from([211, -211, 22]) } } },
      relations: {},
    } as unknown as EventData;
    const drawn: Record<string, Legend> = {};
    withRootLegend(header as never, ev, drawn, PALETTES.dark);
    const legend = drawn["PF:markers"];
    expect(legend.kind === "category" && legend.items?.map((it) => it.label)).toEqual(["charged hadron", "photon"]);
    const own = { kind: "none" } as unknown as Legend; // the layer is drawn: its own legend stays
    const kept: Record<string, Legend> = { "PF:markers": own };
    withRootLegend(header as never, ev, kept, PALETTES.dark);
    expect(kept["PF:markers"]).toBe(own);
  });
});
