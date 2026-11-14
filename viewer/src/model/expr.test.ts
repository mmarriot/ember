import { describe, expect, it } from "vitest";
import { compile } from "./expr";

const run = (src: string, cols: Record<string, number[]>) => {
  const c = compile(src, Object.keys(cols));
  return [
    ...c.run(
      c.columns.map((k) => cols[k]),
      Object.values(cols)[0]?.length ?? 1,
    ),
  ];
};

describe("expressions", () => {
  it("evaluates arithmetic with the usual precedence", () => {
    expect(run("a + b * 2 ^ 2", { a: [1, 2], b: [1, 3] })).toEqual([5, 14]);
    expect(run("-a^2", { a: [3] })).toEqual([-9]);
    expect(run("(a + 1) / 2 ", { a: [3] })).toEqual([2]);
  });
  it("supports functions, constants and comparisons", () => {
    expect(run("hypot(x, y)", { x: [3], y: [4] })).toEqual([5]);
    expect(run("x > 1 && !(y == 4)", { x: [2, 2], y: [4, 5] })).toEqual([0, 1]);
    expect(compile("x > 1", ["x"]).boolean).toBe(true);
    expect(compile("x + 1", ["x"]).boolean).toBe(false);
    expect(run("round(pi * 100)", { x: [0] })).toEqual([314]);
  });
  it("reads each column once, in order of first use", () => {
    expect(compile("b + a * b", ["a", "b"]).columns).toEqual(["b", "a"]);
  });
  it("rejects anything that is not a column, number, operator or listed function", () => {
    for (const bad of [
      "",
      "a +",
      "nope",
      "a; alert(1)",
      "toString(a)",
      "constructor",
      "alert(a)",
      "a[0]",
      "a.length",
      "`a`",
      "a = 1",
      "max()",
    ])
      expect(() => compile(bad, ["a"]), bad).toThrow();
  });
});
