import { describe, expect, it } from "vitest";
import type { Bundle } from "../../io/bundle";
import type { DisplayLayer, Header } from "../../io/format";
// The store sets the page's theme as it loads: a stand-in page (the tests run without a DOM).
Object.assign(globalThis, { document: { documentElement: { dataset: {} } } });
const { bundle, focus, framed, highlight, rawEvent } = await import(".");

const layer = (table: string, extra: Partial<DisplayLayer> = {}) =>
  ({
    table,
    repr: "markers",
    group: table,
    label: table,
    position: ["x", "x", "x"],
    visible: true,
    ...extra,
  }) as DisplayLayer;

describe("framing the focus", () => {
  it("frames the focus and its parts, not what is only linked to it (its truth particle)", () => {
    const header = {
      display: [layer("Track", { repr: "helix" }), layer("Hit"), layer("Part", { truth: true })],
      tables: {},
      relations: {
        trackHits: { from: "Track", to: "Hit", weights: [] },
        trackPart: { from: "Track", to: "Part", weights: [], association: true },
      },
    } as unknown as Header;
    bundle.value = { header, events: [{}], keep: () => {} } as unknown as Bundle;
    const x = (n: number) => ({ n, columns: { x: new Float32Array(n) } });
    const rel = (offsets: number[], indices: number[]) => ({
      offsets: Uint32Array.from(offsets),
      indices: Uint32Array.from(indices),
      weights: {},
    });
    rawEvent.value = {
      id: [1, 1, 1],
      tables: { Track: x(1), Hit: x(2), Part: x(1) },
      relations: { trackHits: rel([0, 2], [0, 1]), trackPart: rel([0, 1], [0]) },
    };
    focus.value = { table: "Track", row: 0 };
    expect(highlight.value?.get("Part")).toEqual(new Set([0])); // highlighted: drawn bright
    expect([...framed.value!.keys()].sort()).toEqual(["Hit", "Track"]); // but not framed
    expect(framed.value!.get("Hit")).toEqual(new Set([0, 1]));
  });
});
