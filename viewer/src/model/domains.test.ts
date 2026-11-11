import { describe, expect, it } from "vitest";
import { drawsLayer, ownDomains, sharedDomains, startDomain, stepDomain } from "./domains";

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
    expect(ownDomains([{ domain: "Physics" }, { domain: "Calo" }, {}, { domain: "Calo" }], sharedDomains(header))).toEqual(new Set(["Calo"]));
  });
});
