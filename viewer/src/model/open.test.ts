import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { blobSource, HttpError } from "../io/bundle";
import { recent } from "./library";
// The store sets the page's theme as it loads: a stand-in page (the tests run without a DOM).
Object.assign(globalThis, { document: { documentElement: { dataset: {} } } });
const { bundle, bundleName, catalogue, openBundle, opened, openFailure, opening, toasts } = await import("./store");

const golden = async () => blobSource(new Blob([readFileSync(new URL("../../../golden/v6_1event.evdb", import.meta.url))]));
const gone = (name: string) => async () => { throw new HttpError(name, 404); };
const settle = () => new Promise((r) => setTimeout(r, 0)); // the background naming of what was opened

beforeEach(() => { bundle.value = null; bundleName.value = ""; catalogue.value = { bundles: [] }; openFailure.value = null; toasts.value = []; recent.value = []; });

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
    await openBundle("data/u/alice/golden.evdb", golden);
    await settle();
    expect(recent.value.map((r) => [r.file, r.title, !!r.local])).toEqual([["data/u/alice/golden.evdb", "golden · alice", false]]);
    await openBundle("mine.evdb", golden, 0, true);
    await settle();
    expect(opened.value).toMatchObject({ file: "mine.evdb", title: "mine.evdb", local: true });
    expect(recent.value[0]).toMatchObject({ file: "mine.evdb", local: true });
  });

  it("does not list under the recent ones what the site's list has", async () => {
    catalogue.value = { bundles: [{ file: "data/sim/golden.evdb", title: "One TICL event" }] };
    await openBundle("data/sim/golden.evdb", golden);
    await settle();
    expect(recent.value).toEqual([]);
  });
});
