import { describe, expect, it } from "vitest";
import type { DisplayLayer, Table } from "../../io/format";
import { cutAmount, cutMin, cutName, cutValues, rescued } from "./cuts";
import { filterMask } from "./settings";

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

describe("a cut in words", () => {
  it("names it by its label or its group, never the column", () => {
    expect(cutName({ group: "Hit energy" })).toBe("hit energy");
    expect(cutName({ group: "Jet pT", label: "jet pT" })).toBe("jet pT");
  });
  it("drops what repeats the row's name", () => {
    expect(cutName({ group: "ECAL barrel energy", label: "ECAL barrel" }, "ECAL barrel")).toBe("energy");
    expect(cutName({ group: "Hit energy" }, "HGCal")).toBe("hit energy");
  });
  it("gives energies below 1 GeV in MeV", () => {
    expect(cutAmount(0.035, "GeV")).toBe("35 MeV");
    expect(cutAmount(1, "GeV")).toBe("1 GeV");
    expect(cutAmount(2.5, "GeV")).toBe("2.5 GeV");
    expect(cutAmount(0.00123, "cm")).toBe("0.00123 cm");
  });
});
