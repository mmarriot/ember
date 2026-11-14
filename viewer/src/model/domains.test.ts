import { describe, expect, it } from "vitest";
import { drawsLayer, ownDomains, rowsInDomain, sharedDomains, startDomain, stepDomain, withFocus } from "./domains";

const header = {
  domains: [
    { name: "Physics", shared: true, region: { rMax: 750, zMax: 1100 } },
    { name: "Tracker", region: { rMax: 120, zMax: 280 } },
    { name: "Calo", region: { rMax: 420, zMax: 700 } },
  ],
  view: { domain: "Physics" },
};

describe("domains", () => {
  it("draws a domain's own layers, those without a domain and those of a shared domain", () => {
    const shared = sharedDomains(header);
    expect(shared).toEqual(new Set(["Physics"]));
    expect(drawsLayer({ domain: "Tracker" }, "Tracker", shared)).toBe(true);
    expect(drawsLayer({ domain: "Calo" }, "Tracker", shared)).toBe(false);
    expect(drawsLayer({ domain: "Physics" }, "Tracker", shared)).toBe(true); // jets in the tracker view
    expect(drawsLayer({}, "Tracker", shared)).toBe(true); // truth
    expect(drawsLayer({ domain: "Tracker" }, "Physics", shared)).toBe(false); // the Physics view: only its own
    expect(drawsLayer({ domain: "Calo" }, null, shared)).toBe(true); // All
  });

  it("opens on the header's start domain only if it is one of two or more", () => {
    expect(startDomain(header)).toBe("Physics");
    expect(startDomain({ ...header, view: { domain: "Muons" } })).toBe(null);
    expect(startDomain({ domains: header.domains.slice(0, 1), view: { domain: "Physics" } })).toBe(null);
    expect(startDomain({ domains: header.domains })).toBe(null);
  });

  it("steps through the domains then All, both ways, skipping those without the selection", () => {
    const names = header.domains.map((d) => d.name);
    expect(stepDomain(names, "Physics", 1)).toBe("Tracker");
    expect(stepDomain(names, "Calo", 1)).toBe(null);
    expect(stepDomain(names, null, 1)).toBe("Physics");
    expect(stepDomain(names, "Physics", -1)).toBe(null);
    expect(stepDomain(names, null, -1)).toBe("Calo");
    const has = (n: string) => n !== "Tracker";
    expect(stepDomain(names, "Physics", 1, has)).toBe("Calo");
    expect(stepDomain(names, "Calo", -1, has)).toBe("Physics");
    expect(stepDomain(["Only"], null, 1)).toBe(null); // one domain: no cycle
  });

  it("names the parts of the detector a set of layers lies in", () => {
    expect(
      ownDomains([{ domain: "Physics" }, { domain: "Calo" }, {}, { domain: "Calo" }], sharedDomains(header)),
    ).toEqual(new Set(["Calo"]));
  });
});

describe("a focus seen from a domain", () => {
  const shared = sharedDomains(header);
  const display = [
    { table: "Jets", domain: "Physics" },
    { table: "Tracks", domain: "Tracker" },
    { table: "Hits", domain: "Calo" },
    { table: "Truth" },
  ];
  const hl = new Map([
    ["Jets", new Set([0])],
    ["Tracks", new Set([3, 4])],
    ["Hits", new Set<number>()],
    ["Truth", new Set([7])],
  ]);
  it("keeps the rows a domain draws as its own; all of them in All or a shared domain; none if it has none", () => {
    expect(rowsInDomain(hl, display, "Tracker", shared)).toEqual(new Map([["Tracks", new Set([3, 4])]]));
    expect(rowsInDomain(hl, display, "Calo", shared)).toBe(null); // its hit set is empty
    expect(rowsInDomain(hl, display, null, shared)).toBe(hl);
    expect(rowsInDomain(hl, display, "Physics", shared)).toBe(hl);
    expect(rowsInDomain(new Map(), display, null, shared)).toBe(null);
  });
  it("frames the focus with its part there (a jet from its vertex to its tracks), without changing the part", () => {
    const part = rowsInDomain(hl, display, "Tracker", shared)!;
    expect(withFocus(part, { table: "Jets", row: 0 })).toEqual(
      new Map([
        ["Tracks", new Set([3, 4])],
        ["Jets", new Set([0])],
      ]),
    );
    expect(withFocus(part, { table: "Tracks", row: 9 }).get("Tracks")).toEqual(new Set([3, 4, 9]));
    expect(part.get("Tracks")).toEqual(new Set([3, 4]));
  });
});
