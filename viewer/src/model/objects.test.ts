import { describe, expect, it } from "vitest";
import type { Table } from "../io/format";
import { passes, ranks, stepRow, topRows, whyHidden } from "./objects";

const t = { n: 5, columns: { pt: new Float32Array([5, 40, 12, 80, 3]), eta: new Float32Array([0, 1, -1, 2, 0]) } };

describe("object rows", () => {
  it("lists the largest rows that pass the cut and the filter, at most max", () => {
    const keep = new Float32Array([1, 1, 1, 0, 1]); // the filter hides row 3
    const pass = passes({ cut: { group: "pT", column: "pt" } }, t, 4, keep);
    expect(topRows(t, "pt", pass, 10)).toEqual([1, 2, 0]);
    expect(topRows(t, "pt", pass, 2)).toEqual([1, 2]);
  });
  it("keeps a short list's largest rows in one pass, in the order a sort gives (equal ones in row order)", () => {
    const big = { n: 200, columns: { e: Float32Array.from({ length: 200 }, (_, i) => (i * 37) % 23) } },
      all = () => true;
    expect(topRows(big, "e", all, 8)).toEqual(topRows(big, "e", all, 1000).slice(0, 8));
    expect(topRows(big, "e", (i) => i % 3 === 0, 5)).toEqual(topRows(big, "e", (i) => i % 3 === 0, 1000).slice(0, 5));
  });
  it("keeps row order without a sort column, and passes everything without cut or filter", () => {
    expect(topRows(t, undefined, passes({}, t, 0, null), 3)).toEqual([0, 1, 2]);
    expect(topRows(t, "missing", passes({}, t, 0, null), 10)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("ranks", () => {
  it("gives each row its place, largest first, from 1; equal values in row order, NaN last", () => {
    expect([...ranks(t.columns.pt, t.n)]).toEqual([4, 2, 3, 1, 5]);
    expect([...ranks(new Float32Array([2, NaN, 7, 2]), 4)]).toEqual([2, 4, 1, 3]);
    expect([...ranks(new BigInt64Array([3n, 10n]), 2)]).toEqual([2, 1]);
    expect([...ranks(new Float32Array(0), 0)]).toEqual([]);
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

describe("whyHidden", () => {
  it("says the cut only when the cut alone leaves a row out", () => {
    const t = { n: 3, columns: { pt: Float32Array.from([5, 20, 5]) } } as unknown as Table,
      d = { cut: { group: "g", column: "pt" } },
      keep = Float32Array.from([1, 0, 0]);
    expect([0, 1, 2].map((i) => whyHidden(d, t, 10, keep, i))).toEqual(["cut", "filter", "both"]);
    expect(whyHidden(d, t, 1, null, 0)).toBeUndefined();
  });
});
