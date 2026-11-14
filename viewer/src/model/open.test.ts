import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { blobSource, HttpError, type Source } from "../io/bundle";
import { type Listed, recent } from "./library";
// The store sets the page's theme as it loads: a stand-in page (the tests run without a DOM).
Object.assign(globalThis, { document: { documentElement: { dataset: {} } } });
const { bundle, bundleName, catalogue, keepShown, openBundle, opened, openFailure, opening, toasts } = await import(
  "./store"
);

const golden = async () =>
  blobSource(new Blob([readFileSync(new URL("../../../golden/v6_1event.evdb", import.meta.url))]));
const gone = (name: string) => async () => {
  throw new HttpError(name, 404);
};
const settle = () => new Promise((r) => setTimeout(r, 0)); // the background naming of what was opened
/** The owners' indexes, as the site would send them: nobody's, unless a test says. */
const indexes =
  (lists: Record<string, Listed[]> = {}) =>
  async (owner: string) =>
    lists[owner] ?? [];

beforeEach(() => {
  bundle.value = null;
  bundleName.value = "";
  catalogue.value = { bundles: [] };
  openFailure.value = null;
  toasts.value = [];
  recent.value = [];
});

describe("openBundle", () => {
  it("says in full why a data set did not open when there is nothing else to show", async () => {
    await openBundle("data/u/alice/x.evdb", gone("data/u/alice/x.evdb"));
    expect(bundle.value).toBeNull();
    expect(openFailure.value?.kind).toBe("gone");
    expect(opening.value).toBeNull();
    expect(toasts.value).toEqual([]);
  });

  it("keeps the data set on screen when another does not open, with a message", async () => {
    await openBundle("data/sim/golden.evdb", golden);
    const shown = bundle.value;
    await openBundle("data/u/alice/x.evdb", gone("data/u/alice/x.evdb"));
    expect(bundle.value).toBe(shown);
    expect(bundleName.value).toBe("data/sim/golden.evdb");
    expect(openFailure.value).toBeNull();
    expect(toasts.value.at(-1)).toMatchObject({ kind: "error", text: expect.stringContaining("no longer here") });
  });

  it("clears the reason once a data set opens", async () => {
    await openBundle("x.evdb", gone("x.evdb"));
    await openBundle("data/sim/golden.evdb", golden);
    expect(openFailure.value).toBeNull();
    expect(bundle.value?.events).toHaveLength(1);
  });

  it("names a data set from its file until a list has it, then by its title there", async () => {
    await openBundle("data/sim/golden.evdb", golden);
    expect(opened.value).toMatchObject({ file: "data/sim/golden.evdb", title: "golden", local: false });
    catalogue.value = { bundles: [{ file: "data/sim/golden.evdb", title: "One TICL event", events: 1 }] };
    expect(opened.value).toMatchObject({ title: "One TICL event", entry: { events: 1 } });
  });

  it("lists a data set from a link under the recent ones, and a local file as one that cannot be reopened", async () => {
    await openBundle("data/u/alice/golden.evdb", golden, 0, false, indexes());
    await settle();
    expect(recent.value.map((r) => [r.file, r.title, !!r.local])).toEqual([
      ["data/u/alice/golden.evdb", "golden · alice", false],
    ]);
    await openBundle("mine.evdb", golden, 0, true);
    await settle();
    expect(opened.value).toMatchObject({ file: "mine.evdb", title: "mine.evdb", local: true });
    expect(recent.value[0]).toMatchObject({ file: "mine.evdb", local: true });
  });

  it("names a link's data set from its owner's index, where its expiry is", async () => {
    const theirs = { file: "data/u/alice/golden.evdb", title: "For the meeting", expires: "2026-12-01T00:00:00Z" };
    await openBundle("data/u/alice/golden.evdb", golden, 0, false, indexes({ alice: [theirs] }));
    await settle();
    expect(opened.value).toMatchObject({ title: "For the meeting", entry: theirs });
    expect(recent.value[0]).toMatchObject({ file: "data/u/alice/golden.evdb", title: "For the meeting" });
  });

  it("drops what an owner's index says once another data set was asked for", async () => {
    let answer!: () => void;
    const late = (owner: string) =>
      new Promise<Listed[]>((done) => {
        answer = () => done([{ file: `data/u/${owner}/golden.evdb`, title: "Arrived too late" }]);
      });
    await openBundle("data/u/alice/golden.evdb", golden, 0, false, late);
    await openBundle("data/sim/golden.evdb", golden, 0, false, indexes());
    answer();
    await settle();
    expect(opened.value).toMatchObject({ file: "data/sim/golden.evdb", title: "golden" });
    expect(recent.value.some((r) => r.title === "Arrived too late")).toBe(false);
  });

  it("does not list under the recent ones what the site's list has", async () => {
    catalogue.value = { bundles: [{ file: "data/sim/golden.evdb", title: "One TICL event" }] };
    await openBundle("data/sim/golden.evdb", golden);
    await settle();
    expect(recent.value).toEqual([]);
  });

  // Review, finding 1: opens overlap (a slow link, then a choice in the chooser; Live; two quick picks).
  it("does not let an earlier, slower open replace the data set chosen after it", async () => {
    let arrive!: () => Promise<void>;
    const slow = () =>
      new Promise<Source>((done) => {
        arrive = async () => done(await golden());
      });
    const first = openBundle("data/sim/first.evdb", slow, 0);
    const second = await openBundle("data/sim/second.evdb", golden);
    await arrive();
    const late = await first;
    expect(bundleName.value).toBe("data/sim/second.evdb");
    expect(opened.value?.file).toBe("data/sim/second.evdb");
    expect(opening.value).toBeNull();
    expect([second, late]).toEqual([true, false]); // what App.tsx goes by to apply a link's event and view
  });

  it("keeps the data set on screen when it is chosen again while a slower one opens", async () => {
    await openBundle("data/sim/first.evdb", golden);
    let arrive!: () => Promise<void>;
    const slow = openBundle(
      "data/sim/second.evdb",
      () =>
        new Promise<Source>((done) => {
          arrive = async () => done(await golden());
        }),
    );
    expect(opening.value).toBe("data/sim/second.evdb");
    keepShown(); // the chooser, picking first.evdb again
    expect(opening.value).toBeNull();
    await arrive();
    expect(await slow).toBe(false);
    expect(bundleName.value).toBe("data/sim/first.evdb");
  });

  it("says nothing about an open that failed after another was asked for, and keeps that one's Opening…", async () => {
    let fail!: () => void, arrive!: () => Promise<void>;
    const first = openBundle(
      "data/sim/first.evdb",
      () =>
        new Promise<Source>((_, reject) => {
          fail = () => reject(new HttpError("data/sim/first.evdb", 404));
        }),
    );
    const second = openBundle(
      "data/sim/second.evdb",
      () =>
        new Promise<Source>((done) => {
          arrive = async () => done(await golden());
        }),
    );
    fail();
    expect(await first).toBe(false);
    expect(opening.value).toBe("data/sim/second.evdb");
    expect(openFailure.value).toBeNull();
    expect(toasts.value).toEqual([]);
    await arrive();
    expect(await second).toBe(true);
    expect(opening.value).toBeNull();
  });

  // Review, finding 2: the name in a link is not trusted.
  it("opens an address on another site as external: no publisher, not remembered", async () => {
    await openBundle("https://elsewhere.example/data/u/alice/x.evdb", golden);
    await settle();
    expect(opened.value).toMatchObject({ external: true, local: false, entry: undefined });
    expect(recent.value).toEqual([]);
  });

  it("does not save the settings of a bundle from another site under its profile, which it names itself", async () => {
    const saved = new Map<string, string>();
    Object.assign(globalThis, {
      localStorage: {
        getItem: (k: string) => saved.get(k) ?? null,
        setItem: (k: string, v: string) => saved.set(k, v),
      },
    });
    try {
      await openBundle("https://elsewhere.example/data/u/alice/x.evdb", golden);
      const { filters } = await import("./custom");
      filters.value = { ...filters.value, Anything: "0" };
      const settings = () => [...saved.keys()].filter((k) => k.startsWith("evd.custom."));
      expect(settings()).toEqual([]);
      await openBundle("data/sim/mine.evdb", golden);
      filters.value = { ...filters.value, Anything: "0" };
      expect(settings()).toEqual([`evd.custom.${bundle.value!.header.profile}`]);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it("refuses a name that is neither a file of this site nor an address", async () => {
    for (const name of [
      "data/u/alice/..\\tester\\x.evdb",
      "data/u/../x.evdb",
      "data/sim/x.evdb?x=1",
      "/etc/x.evdb",
      "//elsewhere.example/x.evdb",
      "javascript:alert(1)",
    ]) {
      expect(await openBundle(name, golden)).toBe(false);
      expect(bundle.value).toBeNull();
      expect(openFailure.value).toMatchObject({ kind: "badname" });
    }
  });

  // Review, finding 3: a local file that is not a bundle.
  it("says of a local file that is not a bundle that it must be converted again, with nothing to fetch", async () => {
    await openBundle("notes.evdb", async () => blobSource(new Blob(["these are not the bytes of a bundle"])), 0, true);
    expect(openFailure.value).toMatchObject({ kind: "unreadable", local: true });
    expect(openFailure.value!.text).toMatch(/convert it again/);
    expect(openFailure.value!.text).not.toMatch(/upload/);
  });
});
