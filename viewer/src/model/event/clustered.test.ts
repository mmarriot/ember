import { describe, expect, it } from "vitest";
import type { DisplayLayer, EventData, Header, Relation } from "../../io/format";
import { cutValues, keptMask, keptRows, rescued } from "../custom/cuts";
import {
  CLUSTERED,
  clusterSources,
  defaultHidden,
  unclusteredHidden,
  unusedCount,
  usedBy,
  withClustered,
} from "./clustered";

// Five hits; clusters list hits 1 and 2 (and 2 twice, through a supercluster); the truth leaves energy in 0 and 4.
const layer = (table: string, repr: string, more: Partial<DisplayLayer> = {}) =>
  ({ table, kind: table, label: table, repr, ...more }) as DisplayLayer;
const header = {
  display: [
    layer("Hits", "cells"),
    layer("Clusters", "markers", { group: "Layer clusters" }),
    layer("Tracksters", "ellipsoids", { stage: 0, group: "Tracksters" }),
    layer("Candidates", "ellipsoids", { stage: 1 }),
    layer("PFCandidates", "helix"),
    layer("Super", "markers"),
    layer("Truth", "helix", { truth: true }),
    layer("Muons", "helix"),
    layer("SoAHits", "cells"),
    layer("Readout", "cells", { context: true }),
    layer("Chambers", "cells", { onSelection: true }),
  ],
  relations: {
    clusterHits: { from: "Clusters", to: "Hits", weights: [] },
    superHits: { from: "Super", to: "Hits", weights: [] },
    truthHits: { from: "Truth", to: "Hits", weights: [] },
    muonHits: { from: "Muons", to: "Hits", weights: [] }, // a crossed cell, not a cluster
    soaHits: { from: "SoAHits", to: "Hits", weights: [] }, // the same hit in another table
    internal: { from: "Helper", to: "Hits", weights: [] }, // a table no layer draws
    readout: { from: "Clusters", to: "Readout", weights: [] },
    chambers: { from: "Clusters", to: "Chambers", weights: [] },
    tracksterClusters: { from: "Tracksters", to: "Clusters", weights: [] },
    candidateClusters: { from: "Candidates", to: "Clusters", weights: [] },
    pfClusters: { from: "PFCandidates", to: "Clusters", weights: [] }, // not a reconstruction step
    candidateTracksters: { from: "Candidates", to: "Tracksters", weights: [] }, // tracksters are a step: no chip
  },
} as unknown as Pick<Header, "display" | "relations">;
const rel = (offsets: number[], indices: number[]): Relation =>
  ({ offsets: Uint32Array.from(offsets), indices: Uint32Array.from(indices), weights: {} }) as Relation;
const event = (relations: Record<string, Relation>): EventData => ({
  id: [1, 1, 1],
  tables: {
    Hits: { n: 5, columns: { energy: Float32Array.from([1, 2, 3, 4, 5]) } },
    Clusters: { n: 2, columns: {} },
  },
  relations,
});
const both = {
  clusterHits: rel([0, 1, 2], [1, 2]),
  superHits: rel([0, 1], [2]),
  truthHits: rel([0, 2], [0, 4]),
  muonHits: rel([0, 1], [3]),
};
const hits = () => withClustered(event(both), clusterSources(header)).tables.Hits;
const shown = (v: Float32Array | null | undefined) =>
  v ? [...v].map((x, i) => (x > 0 ? i : -1)).filter((i) => i >= 0) : "all";

describe("objects no later step uses", () => {
  it("are hits no cluster (a reco layer drawn as points) lists: not the truth, a muon, another hit table", () => {
    expect(clusterSources(header).get("Hits")).toEqual(["clusterHits", "superHits"]);
  });
  it("are clusters no reconstruction step (a layer with a stage) lists; steps themselves have none", () => {
    expect([...clusterSources(header).keys()]).toEqual(["Hits", "Clusters"]);
    expect(clusterSources(header).get("Clusters")).toEqual(["tracksterClusters", "candidateClusters"]);
  });
  it("are named on the chip by what uses them, and counted once per event", () => {
    expect(usedBy({ repr: "cells" })).toBe("in clusters");
    expect(usedBy({ repr: "markers" })).toBe("in tracksters");
    expect(unusedCount(hits())).toBe(3);
    expect(unusedCount({ n: 2, columns: { [CLUSTERED]: Uint8Array.from([0, 0]) } })).toBe(0); // not our flags
  });
  it("are flagged once per event, a hit listed twice still once", () => {
    const raw = event(both),
      ev = withClustered(raw, clusterSources(header));
    expect([...ev.tables.Hits.columns[CLUSTERED]]).toEqual([0, 1, 1, 0, 0]);
    expect(ev.tables.Clusters).toBe(raw.tables.Clusters); // shared, not copied
    expect(CLUSTERED in raw.tables.Hits.columns).toBe(false); // the event as read is left as it is
  });
  it("are not flagged when the event has none of the relations: nothing is known, so nothing is hidden", () => {
    const ev = withClustered(event({ truthHits: both.truthHits }), clusterSources(header));
    expect(CLUSTERED in ev.tables.Hits.columns).toBe(false);
  });
  it("are told only by the flags made here, not by a column of the same name from the bundle or the user", () => {
    const own = { n: 2, columns: { [CLUSTERED]: Uint8Array.from([0, 1]) } };
    expect(unclusteredHidden(own, true)).toBeUndefined();
    const t = hits();
    expect(unclusteredHidden(t, true)).toBe(t.columns[CLUSTERED]);
    expect(unclusteredHidden(t, false)).toBeUndefined();
  });
  it("are left out while hidden, with the layer's own filter", () => {
    const t = hits();
    expect(keptMask(t, undefined, false)).toBeNull();
    expect(shown(keptMask(t, undefined, true))).toEqual([1, 2]);
    expect(shown(keptMask(t, "energy > 2", true))).toEqual([2]);
  });
  it("of the selection are drawn whatever the cluster rule, but not past a filter the selection does not bypass", () => {
    const t = hits(),
      clustered = unclusteredHidden(t, true),
      filter = Float32Array.from([1, 1, 1, 1, 0]), // a filter that leaves out hit 4
      d = { table: "Hits", cut: { group: "E", column: "energy" } } as DisplayLayer;
    // the selection (a truth particle) reaches hits 0, 3 and 4
    expect(shown(keptRows(5, null, clustered, new Set([0, 3, 4])))).toEqual([0, 1, 2, 3, 4]);
    expect(shown(keptRows(5, filter, clustered, new Set([0, 3, 4])))).toEqual([0, 1, 2, 3]);
    // ... unless it bypasses the filter (its profile default): then hit 4 too
    expect(shown(keptRows(5, filter, clustered, new Set([0, 3, 4]), new Set([4])))).toEqual([0, 1, 2, 3, 4]);
    expect(rescued(filter, undefined, clustered, new Set([0, 3, 4]))).toBe("0,3");
    expect(rescued(filter, new Set([4]), clustered, new Set([0, 3, 4]))).toBe("0,3,4");
    expect(rescued(null, undefined, undefined, new Set([0]))).toBe("");
    const v = cutValues(d, t, undefined, undefined, undefined, clustered, new Set([4]))!;
    expect(shown(v)).toEqual([1, 2, 4]);
  });
  it("are hidden by default only with a domain bar (collision events)", () => {
    const bar = { ...header, domains: [{ name: "Physics" }, { name: "HGCal" }] } as Header;
    expect(defaultHidden(bar)).toEqual({ Hits: true, Clusters: true });
    expect(defaultHidden(header)).toEqual({});
  });
});
