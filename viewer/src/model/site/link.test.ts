import { describe, expect, it } from "vitest";
import { type Link, readLink, writeLink } from "./link";

describe("the address of a view", () => {
  it("reads back what it wrote, with / and : left as they are", () => {
    const link: Link = {
      bundle: "data/u/alice/x.ember",
      event: 30,
      view: "rz",
      domain: "All",
      selection: { table: "Tracks", row: 4 },
      level: "particle",
      truth: true,
      group: "collision",
      only: "Tracks:helix",
    };
    const text = writeLink(link);
    expect(text).toBe(
      "b=data/u/alice/x.ember&e=30&v=rz&d=All&s=Tracks:4&lv=particle&c=truth&g=collision&only=Tracks:helix",
    );
    expect(readLink(text)).toEqual(link);
    expect(readLink(writeLink({ bundle: "x.ember", event: 0 }))).toEqual({ bundle: "x.ember", event: 0 });
  });

  it("names no data set without b", () => {
    expect(readLink("")).toBeNull();
    expect(readLink("b=&e=3")).toBeNull();
  });

  it("drops an event or a row that is not a position", () => {
    for (const e of ["abc", "1.5", "-1", "", "1e3"]) expect(readLink(`b=x.ember&e=${e}`)?.event).toBe(0);
    for (const s of ["T:-1", "T:1.5", "T:", ":3", "T"]) expect(readLink(`b=x.ember&s=${s}`)?.selection).toBeUndefined();
  });
});
