import { describe, expect, it } from "vitest";
import type { Bundle } from "../../io/bundle";
import type { DisplayLayer, Header } from "../../io/format";
// The store sets the page's theme as it loads: a stand-in page (the tests run without a DOM).
Object.assign(globalThis, { document: { documentElement: { dataset: {} } } });
const { activeMode, bundle, focus, modes, pairView, rawEvent } = await import(".");

const layer = (table: string, extra: Partial<DisplayLayer>) =>
  ({
    table,
    repr: "markers",
    group: table,
    label: table,
    position: ["x", "x", "x"],
    visible: true,
    ...extra,
  }) as DisplayLayer;

/** A bundle of one event with one TICL-like candidate, the reco root (the last stage), and its hits; `truth` adds
 *  truth particles with the hits' simulated energy. */
function open(truth: boolean) {
  const header = {
    display: [
      layer("Cand", { stage: 0, colourBy: { category: "pdgId" } }),
      layer("Hit", { repr: "cells" }),
      ...(truth ? [layer("Part", { truth: true, particle: { flags: "flags", bit: 2 } })] : []),
    ],
    tables: {},
    relations: {
      candHits: { from: "Cand", to: "Hit", weights: [] },
      ...(truth
        ? { partHits: { from: "Part", to: "Hit", weights: ["e"], association: true, fact: { in: "HGCal" } } }
        : {}),
    },
  } as unknown as Header;
  bundle.value = { header, events: [{}], keep: () => {} } as unknown as Bundle;
  const one = (v: number) => new Float32Array([v]);
  rawEvent.value = {
    id: [1, 1, 1],
    tables: {
      Cand: { n: 1, columns: { x: one(0), pdgId: new Int32Array([211]) } },
      Hit: { n: 1, columns: { x: one(0) } },
      ...(truth ? { Part: { n: 1, columns: { x: one(0), flags: new Int32Array([4]) } } } : {}),
    },
    relations: {
      candHits: { offsets: new Uint32Array([0, 1]), indices: new Uint32Array([0]), weights: {} },
      ...(truth
        ? { partHits: { offsets: new Uint32Array([0, 1]), indices: new Uint32Array([0]), weights: { e: one(1) } } }
        : {}),
    },
  };
  focus.value = { table: "Cand", row: 0 };
}

describe("pairView", () => {
  it("opens no truth <-> reco pair in a bundle without truth", () => {
    open(false);
    // everything else a pair needs is there: the reco mode, its root, a selected candidate
    expect(activeMode.value).toBe("pid");
    expect(modes.value.roots).toEqual({ reco: "Cand" });
    expect(focus.value).toEqual({ table: "Cand", row: 0 });
    expect(pairView.value).toBeNull();
  });
});
