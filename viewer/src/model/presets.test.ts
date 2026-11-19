import { describe, expect, it } from "vitest";
import type { Bundle } from "../io/bundle";
// The store sets the page's theme as it loads: a stand-in page (the tests run without a DOM).
Object.assign(globalThis, { document: { documentElement: { dataset: {} } } });
const { bundle, visible } = await import("./store");
const { colourBy, filters } = await import("./custom");
const { applyPreset } = await import("./presets");

const PF = { table: "PF", repr: "markers", visible: false },
  TRACKS = { table: "Trk", repr: "helix", visible: true },
  MTD = { table: "MTD", repr: "markers", visible: false };

describe("presets", () => {
  it("tick the layers they show, and the next preset puts them back to their default tick", () => {
    bundle.value = {
      header: {
        display: [PF, TRACKS, MTD],
        tables: {},
        relations: {},
        presets: [
          { name: "Primary vertex" },
          { name: "What PUPPI removed", filters: { PF: "puppiWeight == 0" }, show: ["PF"] },
          { name: "Track time", colour: { Trk: "t0", MTD: "t0" }, show: ["MTD"] },
        ],
      },
      events: [],
    } as unknown as Bundle;
    visible.value = { "PF:markers": false, "Trk:helix": true, "MTD:markers": false };
    applyPreset(1);
    expect(visible.value).toEqual({ "PF:markers": true, "Trk:helix": true, "MTD:markers": false });
    expect(filters.value.PF).toBe("puppiWeight == 0");
    applyPreset(2); // PF back to unticked, its filter gone; MTD ticked and coloured
    expect(visible.value).toEqual({ "PF:markers": false, "Trk:helix": true, "MTD:markers": true });
    expect(filters.value.PF).toBeUndefined();
    expect(colourBy.value).toMatchObject({ "Trk:helix": "t0", "MTD:markers": "t0" });
    applyPreset(0); // the defaults: nothing a preset ticked stays ticked, no colour choice stays
    expect(visible.value).toEqual({ "PF:markers": false, "Trk:helix": true, "MTD:markers": false });
    expect(colourBy.value["Trk:helix"]).toBeUndefined();
  });
});
