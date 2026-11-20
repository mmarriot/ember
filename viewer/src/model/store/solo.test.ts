import { describe, expect, it } from "vitest";
import type { Bundle } from "../../io/bundle";
// The store sets the page's theme as it loads: a stand-in page (the tests run without a DOM).
Object.assign(globalThis, { document: { documentElement: { dataset: {} } } });
const { bundle, drawnLayers, lookAlone, showAll, solo, visible } = await import(".");

describe("looking at one kind alone", () => {
  const tracks = { table: "Track", repr: "helix", group: "Tracks", domain: "Tracker", visible: true },
    hits = { table: "TrackHits", repr: "markers", group: "Track hits", domain: "Tracker", onSelection: true };
  bundle.value = { header: { display: [tracks, hits] }, events: [] } as unknown as Bundle;

  it("draws all the rows of a kind drawn only for a selection, so the view is not empty", () => {
    visible.value = { "Track:helix": true, "TrackHits:markers": true };
    showAll.value = {};
    lookAlone("Tracker|Track hits");
    expect(solo.value).toBe("Tracker|Track hits");
    expect(showAll.value).toEqual({ "TrackHits:markers": true });
    expect(drawnLayers.value).toEqual({ "Track:helix": false, "TrackHits:markers": true });
  });
  it("puts them back to the selection's rows when it ends, unless they were drawn in full before", () => {
    showAll.value = {};
    lookAlone("Tracker|Track hits");
    lookAlone(null);
    expect(showAll.value).toEqual({});
    showAll.value = { "TrackHits:markers": true };
    lookAlone("Tracker|Track hits");
    lookAlone("Tracker|Tracks");
    expect(showAll.value).toEqual({ "TrackHits:markers": true });
  });
  it("leaves other kinds' rows as they are", () => {
    showAll.value = {};
    lookAlone("Tracker|Tracks");
    expect(showAll.value).toEqual({});
    lookAlone(null);
    expect(solo.value).toBeNull();
  });
});
