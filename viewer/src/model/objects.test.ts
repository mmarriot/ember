import { describe, expect, it } from "vitest";
import { passes, topRows } from "./objects";

const t = { n: 5, columns: { pt: new Float32Array([5, 40, 12, 80, 3]), eta: new Float32Array([0, 1, -1, 2, 0]) } };

describe("object rows", () => {
  it("lists the largest rows that pass the cut and the filter, at most max", () => {
    const keep = new Float32Array([1, 1, 1, 0, 1]); // the filter hides row 3
    const pass = passes({ cut: { group: "pT", column: "pt" } }, t, 4, keep);
    expect(topRows(t, "pt", pass, 10)).toEqual([1, 2, 0]);
    expect(topRows(t, "pt", pass, 2)).toEqual([1, 2]);
  });
  it("keeps row order without a sort column, and passes everything without cut or filter", () => {
    expect(topRows(t, undefined, passes({}, t, 0, null), 3)).toEqual([0, 1, 2]);
    expect(topRows(t, "missing", passes({}, t, 0, null), 10)).toEqual([0, 1, 2, 3, 4]);
  });
});
