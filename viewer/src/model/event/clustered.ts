// Hits in no cluster. A hit drawn as a cell is clustered when a cluster that the bundle draws (a reco layer drawn as
// points: a layer cluster, a PF cluster, a supercluster) lists it; the truth's relations do not count, nor do tracks,
// muons or other hits. Collision events hide the others until asked for (the menu's "Unclustered hits": most are
// noise); test-beam ones show them. The rule applies where the view decides what to draw (model/custom/cuts.ts
// keptRows); the selection's own hits are drawn whatever it says.
import { signal } from "@preact/signals";
import type { EventData, Header, Table } from "../../io/format";

/** The column added to such a hit table: 1 for a hit that a cluster lists, else 0. */
export const CLUSTERED = "clustered";

/** Whether the hits in no cluster are drawn. openBundle sets each bundle's default (defaultShowUnclustered). */
export const showUnclustered = signal(true);
/** Shown in bundles without a domain bar (test beam, MCT), hidden in collision events, which have one. */
export const defaultShowUnclustered = (h: Pick<Header, "domains">) => (h.domains?.length ?? 0) < 2;

/** Per hit table, the relations through which clusters list its hits: the tables of the layers drawn as cells (not
 *  truth, not context, not drawn only for a selection, as the muon chambers) that a reco layer drawn as points points
 *  into. */
export function clusterSources(h: Pick<Header, "display" | "relations">): Map<string, string[]> {
  const clusters = new Set(h.display.filter((d) => !d.truth && d.repr === "markers").map((d) => d.table));
  const out = new Map<string, string[]>();
  for (const d of h.display) {
    if (d.repr !== "cells" || d.truth || d.context || d.onSelection || out.has(d.table)) continue;
    const names = Object.entries(h.relations)
      .filter(([, r]) => r.to === d.table && clusters.has(r.from))
      .map(([name]) => name);
    if (names.length) out.set(d.table, names);
  }
  return out;
}

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
    // One pass over each relation's flat index list: sequential reads, a byte write per link into the hit mask.
    const mask = new Uint8Array(t.n);
    for (const r of rels) for (const i of r.indices) if (i < t.n) mask[i] = 1;
    made.add(mask);
    tables ??= { ...ev.tables };
    tables[table] = { n: t.n, columns: { ...t.columns, [CLUSTERED]: mask } };
  }
  return tables ? { ...ev, tables } : ev;
}

/** The table's flags of clustered hits while the hits in no cluster are hidden (`hide`), else undefined. */
export function unclusteredHidden(t: Table, hide: boolean): Uint8Array | undefined {
  const c = hide ? t.columns[CLUSTERED] : undefined;
  return c instanceof Uint8Array && made.has(c) ? c : undefined;
}
