import { describe, expect, it } from "vitest";
import { placeLabels } from "./placement";

describe("label placement", () => {
  const label = (kind: "selected" | "focus" | "hover" | "lead", x: number, y: number) => ({
    kind,
    at: [x, y] as [number, number],
    w: 100,
    h: 16,
  });
  const card = { x0: 600, y0: 0, x1: 1000, y1: 800 };
  it("puts a label right of its object, or left of it where it would cross the card", () => {
    expect(placeLabels([label("lead", 100, 100)], card)).toEqual(["right"]);
    expect(placeLabels([label("selected", 550, 100)], card)).toEqual(["left"]);
    expect(placeLabels([{ ...label("lead", 100, 100), at: null }], card)).toEqual([null]); // not drawn
  });
  it("hides the less important of two overlapping labels, the selection's never", () => {
    // Two objects at the same spot: the second leading object goes left, a third finds no room and hides.
    expect(placeLabels([label("lead", 100, 100), label("lead", 102, 101), label("lead", 104, 102)])).toEqual([
      "right",
      "left",
      null,
    ]);
    // The selection is placed first (right), whatever the order of the list: the leading objects get what is left.
    expect(placeLabels([label("lead", 100, 100), label("lead", 102, 101), label("selected", 104, 102)])).toEqual([
      "left",
      null,
      "right",
    ]);
    // Under the card on both sides: a leading object's label hides; the selection's is still shown.
    const under = { x0: 0, y0: 0, x1: 1000, y1: 800 };
    expect(placeLabels([label("lead", 500, 100), label("selected", 500, 300)], under)).toEqual([null, "right"]);
  });
});
