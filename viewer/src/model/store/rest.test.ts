import { describe, expect, it } from "vitest";
// The store reads the remembered choice and sets the page's theme as it loads: a stand-in storage and page (the tests
// run without a DOM).
const stored = new Map<string, string>([["evd.rest", "hidden"]]);
Object.assign(globalThis, {
  document: { documentElement: { dataset: {} } },
  localStorage: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v) },
});
const { rest, setRest } = await import(".");

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
