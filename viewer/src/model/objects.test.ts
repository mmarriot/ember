import { describe, expect, it } from "vitest";
import { passes, stepRow, topRows } from "./objects";

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

describe("N, through a kind's objects", () => {
  it("steps to the next or previous row, cycling; from outside the rows, to the first (or last going back)", () => {
    const rows = [3, 1, 0]; // largest first
    expect(stepRow(rows, 3, 1)).toBe(1);
    expect(stepRow(rows, 0, 1)).toBe(3);
    expect(stepRow(rows, 3, -1)).toBe(0);
    expect(stepRow(rows, undefined, 1)).toBe(3);
    expect(stepRow(rows, undefined, -1)).toBe(0);
    expect(stepRow(rows, 7, 1)).toBe(3); // the selection fell below the cut
    expect(stepRow([], 3, 1)).toBe(undefined);
  });
});
