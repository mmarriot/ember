// How the focus shapes the drawn layers (control/scene.ts): which rows a layer drawn only for the selection keeps, and
// how a layer is dressed (highlight, outlines, pair style).
import { untracked } from "@preact/signals";
import type { DisplayLayer, EventData, Header } from "../io/format";
import { HIDDEN } from "../model/custom/cuts";
import { PAIR } from "../model/truth/pair";
import {
  activeMode,
  bundle,
  cuts,
  domain,
  drawnLayers,
  event,
  focusIsTruth,
  inDomain,
  layerKey,
  layerOf,
  levelTop,
  noTruth,
  pairView,
  parentRows,
  selection,
  showAll,
  shownLevel,
  truthPreview,
} from "../model/store";
import type { Layer } from "../render/layers";

type Highlight = Map<string, Set<number>> | null;

/** The focus's rows that the layer's filter does not hide: all of them while the filter is the profile's default (a
 *  candidate's track from another vertex); none once the user changed it (a filter they chose applies to the focus too,
 *  and a click never rebuilds a big layer they filtered). */
export const bypassing = (d: DisplayLayer, f: Record<string, string>, hl: Highlight) =>
  d.filter && f[d.table] === d.filter ? hl?.get(d.table) : undefined;

/** Whether a layer drawn only for the focus is drawn whole because a replay (`replaying`) builds paths from its
 *  objects (display hint `grow` on a drawn layer), so the building can be seen. */
export const replayOnly = (d: DisplayLayer, key: string, hl: Highlight, replaying: boolean) => {
  const h = bundle.peek()?.header,
    drawn = drawnLayers.peek();
  return (
    !!d.onSelection &&
    !showAll.peek()[key] &&
    replaying &&
    !hl &&
    !!h?.display.some((p) => p.grow && drawn[layerKey(p)] && inDomain(p) && h.relations[p.grow.parts]?.to === d.table)
  );
};

/** For a layer drawn only for the focus: the rows to keep (none without a focus), less those reached only from objects
 *  a cut hides (the hits and truth of a vertex's tracks below the pT cut); else undefined. */
export const onlyFor = (d: DisplayLayer, key: string, hl: Highlight, replaying: boolean) => {
  const parents = untracked(() => parentRows(d));
  if (parents) return parents; // a shared part's layer drawn only for what the focus is part of
  if (!d.onSelection || showAll.peek()[key] || replayOnly(d, key, hl, replaying)) return undefined;
  const rows = hl?.get(d.table);
  if (!rows) return (!hl && truthPreview(d)) || new Set<number>(); // before a selection, the truth colours' particles
  const cut = belowCut(d.table, hl!);
  return cut.size ? new Set([...rows].filter((r) => !cut.has(r))) : rows;
};

/** The focus's objects of `table` reached only from focus objects (not the selected one) that fail their layer's cut,
 *  across every relation into `table`. */
function belowCut(table: string, hl: Map<string, Set<number>>) {
  const h = bundle.peek()?.header,
    ev = event.peek(),
    c = cuts.peek(),
    sel = selection.peek(),
    hidden = new Set<number>(),
    kept = new Set<number>();
  for (const [name, r] of Object.entries(h?.relations ?? {})) {
    const p = layerOf(r.from),
      rel = ev?.relations[name],
      from = hl.get(r.from),
      col = p?.cut && ev?.tables[r.from]?.columns[p.cut.column];
    if (r.to !== table || r.from === table || !p?.cut || !rel || !from || !col) continue;
    const min = c[p.cut.group] ?? 0;
    for (const f of from) {
      const into = Number(col[f]) >= min || (sel?.table === r.from && sel.row === f) ? kept : hidden;
      for (let k = rel.offsets[f]; k < rel.offsets[f + 1]; k++) into.add(rel.indices[k]);
    }
  }
  for (const r of kept) hidden.delete(r);
  return hidden;
}

/** A layer's cut values hide every row (a layer drawn only for a selection, without one). */
export const nothingDrawn = (cut?: Float32Array) => !!cut && !cut.some((v) => v > HIDDEN);

/** An event's relation with its `to` table, for layers drawn through one (a polyline's points). */
export const relationOf = (header: Header | undefined, ev: EventData | null) => (name: string) => {
  const info = header?.relations[name],
    rel = ev?.relations[name],
    to = info && ev?.tables[info.to];
  return rel && to ? { offsets: rel.offsets, indices: rel.indices, to } : undefined;
};

/** Reco objects drawn as outlines: when the focus is a truth particle, except in the pair view, which looks the same
 *  from either side. */
export const truthOutline = () => focusIsTruth.peek() && !pairView.peek();

/** A layer of a shared domain (e.g. physics objects) seen from another domain's view is drawn as an outline (cones:
 *  their rim), so it does not cover that detector's objects. */
const sharedOutline = (layer: Layer) => {
  const d = layerOf(layer.table),
    current = domain.peek(),
    domains = bundle.peek()?.header.domains;
  return !!d?.domain && !!current && d.domain !== current && !!domains?.find((x) => x.name === d.domain && x.shared);
};

/** By truth, a kind with no truth of its own drawn as cones (jets) is an outline, so it never looks like a matched
 *  object (docs/truth.md "Where truth stops"). */
const faintOutline = (layer: Layer) =>
  activeMode.peek() === "truth" && layerOf(layer.table)?.repr === "cones" && noTruth(layer.table);

/** While a level is shown inside the focus (e.g. a candidate's tracksters), the focus's layer draws it as a full-size
 *  outline around them. */
const isEnvelope = (layer: Layer) => !!shownLevel.peek() && layer.table === levelTop.peek()?.table;

/** Whether a layer is drawn as outlines, and whether its focus object is an envelope around the level shown.
 *  `truth`: truthOutline(), worked out once by callers that dress many layers. */
export function outline(layer: Layer, truth = truthOutline()) {
  layer.setOutline?.(truth || sharedOutline(layer) || faintOutline(layer), isEnvelope(layer));
}

/** Draw a layer as the focus asks: its objects highlighted (`hl` null: nothing fades), its outline style, and in the
 *  pair view a shower holding only a split-off part of the particle as a faint rim, its match standing out. */
export function dress(layer: Layer, hl: Highlight, truth = truthOutline()) {
  layer.setHighlight(hl ? (hl.get(layer.table) ?? new Set()) : null);
  outline(layer, truth);
  if (layer.setPairStyle) {
    const cls = pairView.peek()?.classes.get(layer.table);
    layer.setPairStyle(cls ? cls.map((c) => (c === PAIR.split ? 1 : c === PAIR.matched ? 2 : 0)) : null);
  }
}
