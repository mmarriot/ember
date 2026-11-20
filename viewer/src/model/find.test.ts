import { describe, expect, it } from "vitest";
import type { DisplayLayer, Table } from "../io/format";
import { findEvent, findObjects, parseEventId } from "./find";

describe("parseEventId", () => {
  it("reads run:lumi:event, run:event and event", () => {
    expect(parseEventId("392294:21:11805516")).toEqual({ run: 392294, lumi: 21, event: 11805516 });
    expect(parseEventId("392294:11805516")).toEqual({ run: 392294, event: 11805516 });
    expect(parseEventId("18")).toEqual({ event: 18 });
  });
  it("takes spaces as separators", () => {
    expect(parseEventId(" 1 1 18 ")).toEqual({ run: 1, lumi: 1, event: 18 });
    expect(parseEventId("1 : 18")).toEqual({ run: 1, event: 18 });
  });
  it("rejects anything else", () => {
    for (const t of ["", "electron", "1:2:3:4", "1.5", "-3", "1:x"]) expect(parseEventId(t)).toBeNull();
  });
});

describe("findEvent", () => {
  const events = [
    { run: 1, lumi: 1, event: 18 },
    { run: 1, lumi: 2, event: 21 },
    { run: 2, lumi: 21, event: 18 },
  ];
  it("matches every id given", () => {
    expect(findEvent(events, { event: 18 })).toBe(0);
    expect(findEvent(events, { run: 2, event: 18 })).toBe(2);
    expect(findEvent(events, { run: 1, lumi: 2, event: 21 })).toBe(1);
  });
  it("never reads the lumi section as the event", () => {
    expect(findEvent(events, { run: 2, lumi: 21, event: 99 })).toBe(-1);
    expect(findEvent(events, { run: 1, lumi: 1, event: 21 })).toBe(-1);
  });
});

describe("findObjects", () => {
  const jets = { table: "Jet", label: "AK4", group: "Jets", kind: "jet" } as DisplayLayer,
    chs = { table: "JetCHS", label: "AK4 CHS", group: "Jets", kind: "jet" } as DisplayLayer,
    electrons = { table: "Electron", label: "Electrons", group: "Electrons", kind: "electron" } as DisplayLayer;
  const tables: Record<string, Table> = {
    Jet: { n: 3, columns: { pt: Float32Array.from([99.6, 63.9, 46.9]) } },
    JetCHS: { n: 1, columns: { pt: Float32Array.from([120]), btag: Float32Array.from([0.8]) } },
    Electron: { n: 0, columns: { pt: new Float32Array() } },
  };
  const layers = [jets, chs, electrons];
  it("finds a kind by its name, singular or plural, and filters by an expression", () => {
    expect(findObjects("jet", layers, tables)).toMatchObject({ layer: jets, rows: [0, 1, 2] });
    expect(findObjects("Jets pt > 50", layers, tables)).toMatchObject({ layer: jets, rows: [0, 1], where: "pt > 50" });
    expect(findObjects("AK4 CHS", layers, tables)).toMatchObject({ layer: chs, rows: [0] });
  });
  it("goes on to the kind's next collection when the first has none", () => {
    expect(findObjects("jet pt > 100", layers, tables)).toMatchObject({ layer: chs, rows: [0] });
  });
  it("skips the kind's collections that lack a column of the condition", () => {
    expect(findObjects("jet btag > 0.5", layers, tables)).toMatchObject({ layer: chs, rows: [0] });
    expect(findObjects("jet btag > 0.9", layers, tables)).toBe("No jets with btag > 0.9 in this event");
  });
  it("ends the kind's name at the first operator, and wants a condition", () => {
    expect(findObjects("jet > 50", layers, tables)).toMatch(/^Jets: /);
    expect(findObjects("jet 50", layers, tables)).toMatch(/is not a condition/);
  });
  it("says why nothing was found", () => {
    expect(findObjects("electron", layers, tables)).toBe("No electrons in this event");
    expect(findObjects("jet pt > 500", layers, tables)).toBe("No jets with pt > 500 in this event");
    expect(findObjects("jet foo > 1", layers, tables)).toMatch(/^Jets: .*foo/);
    expect(findObjects("gluon", layers, tables)).toMatch(/neither an event/);
  });
});
