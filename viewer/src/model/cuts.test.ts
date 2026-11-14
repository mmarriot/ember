import { describe, expect, it } from "vitest";
import type { DisplayLayer, Table } from "../io/format";
import { cutMin, cutValues, rescued } from "./cuts";
import { filterMask } from "./custom";

const t: Table = { n: 4, columns: { pt: Float32Array.from([0.5, 2, 3, 4]), pv: Float32Array.from([0, 0, 1, 1]) } };
const d = { table: "Tracks", cut: { group: "pT", column: "pt" } } as DisplayLayer;
const passing = (values: Float32Array | undefined, min: number) =>
  [...values!].map((v, i) => (v >= min ? i : -1)).filter((i) => i >= 0);

describe("cutValues", () => {
  it("hides the rows a filter leaves out, and those below the cut", () => {
    const v = cutValues(d, t, "pv == 0");
    expect(passing(v, cutMin(d, v, { pT: 1 }))).toEqual([1]);
  });
  it("draws the focus's rows that the filter hides, but not those below the cut", () => {
    const v = cutValues(d, t, "pv == 0", undefined, new Set([0, 2]));
    expect(passing(v, cutMin(d, v, { pT: 1 }))).toEqual([1, 2]); // row 0: in the focus, below the cut
    expect(rescued(filterMask(t, "pv == 0"), new Set([3, 0, 2, 1]))).toBe("2,3");
    expect(rescued(null, new Set([3]))).toBe("");
  });
});
