import { describe, expect, it } from "vitest";
import { findEvent, parseEventId } from "./find";

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
