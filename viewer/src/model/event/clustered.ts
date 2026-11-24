// Objects no later step uses: hits in no cluster, layer clusters in no trackster. Each such layer has a chip on its
// row in the side panel ("in clusters" | "all", "in tracksters" | "all") when the event has some. Collision events start with these
// objects hidden (most hits in no cluster are noise; most layer clusters at 200 pile-up are in no trackster); test-beam
// ones show them. The rule applies where the view decides what to draw (model/custom/cuts.ts keptRows); the
// selection's own objects are drawn whatever it says.
//
// Who counts as using an object (clusterSources):
// - a hit (a layer drawn as cells): a cluster the bundle draws (a reco layer drawn as points: a layer cluster, a PF
//   cluster, a supercluster) that lists it; not the truth, a track, a muon or another hit table;
// - a cluster (a reco layer drawn as points, not a step itself): a reconstruction step that lists it (a layer with a
//   `stage`: the tracksters, linked tracksters, candidates).
import { signal } from "@preact/signals";
import type { DisplayLayer, EventData, Header, Table } from "../../io/format";

/** The column added to such a table: 1 for an object a later step uses, else 0. */
export const CLUSTERED = "clustered";

/** Per table, whether its objects that no later step uses are hidden. openBundle sets each bundle's default
 *  (defaultHidden); the row's chip changes it. */
export const hideUnclustered = signal<Record<string, boolean>>({});
/** Hidden in collision events (a bundle with a domain bar), shown in test-beam and MCT ones. */
export const defaultHidden = (h: Pick<Header, "domains" | "display" | "relations">): Record<string, boolean> =>
  (h.domains?.length ?? 0) >= 2 ? Object.fromEntries([...clusterSources(h).keys()].map((t) => [t, true])) : {};

/** Per table, the relations through which a later step lists its objects (see the rule above). Layers drawn only for
 *  a selection (the muon chambers), truth and context layers have none. */
export function clusterSources(h: Pick<Header, "display" | "relations">): Map<string, string[]> {
  const reco = h.display.filter((d) => !d.truth),
    clusters = new Set(reco.filter((d) => d.repr === "markers").map((d) => d.table)),
    steps = new Set(reco.filter((d) => d.stage !== undefined).map((d) => d.table));
  const out = new Map<string, string[]>();
  for (const d of h.display) {
    if (d.truth || d.context || d.onSelection || out.has(d.table)) continue;
    const users = d.repr === "cells" ? clusters : d.repr === "markers" && d.stage === undefined ? steps : undefined;
    if (!users) continue;
    const names = Object.entries(h.relations)
      .filter(([, r]) => r.to === d.table && r.from !== d.table && users.has(r.from))
      .map(([name]) => name);
    if (names.length) out.set(d.table, names);
  }
  return out;
}

/** What the chip of a layer's row says while its unused objects are hidden: hits are used by clusters, clusters by
 *  tracksters (the reconstruction steps). */
export const usedBy = (d: Pick<DisplayLayer, "repr">) => (d.repr === "cells" ? "in clusters" : "in tracksters");

const made = new WeakSet<Uint8Array>(); // the CLUSTERED columns withClustered made (not a bundle's or a user's)

/** The event with the CLUSTERED column added to each table of `sources` (clusterSources). A table keeps its own column
 *  of that name, and gets none when the event has none of its relations: then nothing is known to be clustered, and
 *  hiding everything would be wrong. Tables without it are shared, not copied. */
export function withClustered(ev: EventData, sources: Map<string, string[]>): EventData {
  let tables: EventData["tables"] | undefined;
  for (const [table, names] of sources) {
    const t = ev.tables[table],
      rels = names.map((name) => ev.relations[name]).filter((r) => r !== undefined);
    if (!t || CLUSTERED in t.columns || !rels.length) continue;
    // One pass over each relation's flat index list: sequential reads, a byte write per link into the mask.
    const mask = new Uint8Array(t.n);
    for (const r of rels) for (const i of r.indices) if (i < t.n) mask[i] = 1;
    made.add(mask);
    tables ??= { ...ev.tables };
    tables[table] = { n: t.n, columns: { ...t.columns, [CLUSTERED]: mask } };
  }
  return tables ? { ...ev, tables } : ev;
}

const unused = new WeakMap<Uint8Array, number>(); // per flags column: how many objects no later step uses

/** How many of the table's objects no later step uses (0 without the flags): counted once per event. */
export function unusedCount(t: Table): number {
  const c = t.columns[CLUSTERED];
  if (!(c instanceof Uint8Array) || !made.has(c)) return 0;
  let n = unused.get(c);
  if (n === undefined) {
    n = 0;
    for (let i = 0; i < c.length; i++) if (!c[i]) n++;
    unused.set(c, n);
  }
  return n;
}

/** The table's flags of used objects while its unused ones are hidden (`hide`), else undefined. */
export function unclusteredHidden(t: Table, hide: boolean): Uint8Array | undefined {
  const c = hide ? t.columns[CLUSTERED] : undefined;
  return c instanceof Uint8Array && made.has(c) ? c : undefined;
}
