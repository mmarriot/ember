import { describe, expect, it } from "vitest";
import type { Header } from "../../io/format";
// The store reads the remembered choice and sets the page's theme as it loads: a stand-in storage and page (the tests
// run without a DOM).
const stored = new Map<string, string>([["evd.rest", "hidden"]]);
Object.assign(globalThis, {
  document: { documentElement: { dataset: {} } },
  localStorage: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v) },
});
const { COLLECTIONS, rest, setRest, tabOfDomain } = await import(".");

describe("the rest of the event around a selection", () => {
  it("starts as the user left it, steps dim, faint, hidden and round, and is remembered", () => {
    expect(rest.value).toBe("hidden");
    setRest();
    expect(rest.value).toBe("dim");
    setRest();
    expect(rest.value).toBe("faint");
    setRest("hidden");
    expect(rest.value).toBe("hidden");
    expect(stored.get("evd.rest")).toBe("hidden");
  });
});

describe("the side-panel tab of a domain", () => {
  const domains = (...d: object[]) => ({ domains: d }) as Pick<Header, "domains">,
    bar = domains({ name: "Physics", shared: true }, { name: "Tracker" });
  it("is Collections for every part of a domain bar, shared or not", () => {
    expect(tabOfDomain(bar, "Physics")).toBe(COLLECTIONS);
    expect(tabOfDomain(bar, "Tracker")).toBe(COLLECTIONS);
  });
  it("is the domain's own without a bar", () => {
    expect(tabOfDomain(domains({ name: "HGCal" }), "HGCal")).toBe("HGCal");
    expect(tabOfDomain({}, "HGCal")).toBe("HGCal");
  });
});
