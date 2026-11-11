// Moving the focus between objects from lists and links (e.g. a candidate and its truth-graph particle), with "back";
// the camera glides to the new focus, conservatively. Moving between the parts of the detector (domains), keeping the
// focus.
import { batch } from "@preact/signals";
import type { DisplayLayer } from "../io/bundle";
import { filterMask, filters } from "../model/custom";
import { stepDomain } from "../model/domains";
import { passes, topRows } from "../model/objects";
import { bundle, cuts, domain, drawnLayers, event, focus, focusBack, focusOn, highlight, layerKey, layerOf, openTab, selection, shared, sizeColumn, tabOfDomain, view } from "../model/store";
import type { Ref } from "../model/relations";
import { engine } from "./Viewport";

export function jump(ref: Ref) {
  focusOn(ref);
  selection.value = { ...ref };
  engine?.frame(highlight.peek() ?? undefined, true, 800);
}

export function back() {
  const prev = focusBack();
  if (!prev) return;
  selection.value = { ...prev };
  engine?.frame(highlight.peek() ?? undefined, true, 800);
}

/** Look at one domain (header `domains`): only its layers, those of shared domains and those without a domain are
 *  drawn, in its view and colour mode (store.ts activeMode), and its layers' tab opens in the side panel; null:
 *  everything, in the bundle's starting view. A selection is kept: the view frames its objects in the domain (e.g. a
 *  jet's calorimeter clusters), else the domain's region (All: the objects). `animate`: glide there. */
export function chooseDomain(name: string | null, animate = true) {
  const h = bundle.peek()?.header, d = h?.domains?.find((x) => x.name === name);
  if (!h || (name && !d)) return;
  batch(() => { // one rebuild for the domain (and its colour mode) and its view
    domain.value = d ? d.name : null;
    if (d) openTab.value = { name: tabOfDomain(h, d.name) }; // its tab in the side panel (choosing a tab does not change the view)
    view.value = d?.view ?? h.view?.start ?? "3d";
  });
  const part = focusIn(d?.name ?? null), f = focus.peek();
  // The focus with its part there: a jet from its vertex to its clusters, not only the clusters (which, in a 2D view,
  // would fill the screen).
  if (part && f) engine?.frame(new Map([...part, [f.table, new Set([...(part.get(f.table) ?? []), f.row])]]), animate, 700);
  else if (d) engine?.frameRegion(d.region.rMax, d.region.zMax, animate);
  else engine?.frame(undefined, animate);
}

/** The focus's objects (its highlight) that domain `name` draws as its own (not those of shared domains or without a
 *  domain, which every domain draws); with `name` a shared domain or null (All), all of them. Null without a focus or
 *  when the domain has none of them. */
function focusIn(name: string | null): Map<string, Set<number>> | null {
  const h = bundle.peek()?.header, hl = highlight.peek();
  if (!h || !hl || !focus.peek()) return null;
  if (!name || shared.peek().has(name)) return hl.size ? hl : null;
  const tables = new Set(h.display.filter((l) => l.domain === name).map((l) => l.table));
  const rows = new Map([...hl].filter(([t, set]) => tables.has(t) && set.size));
  return rows.size ? rows : null;
}

/** The next (`by` 1) or previous (-1) domain, All after the last (keyboard: D, Shift+D). With a selection, the domains
 *  it has nothing in are skipped. */
export function nextDomain(by = 1) {
  const names = bundle.peek()?.header.domains?.map((d) => d.name) ?? [];
  const has = (name: string) => !focus.peek() || shared.peek().has(name) || !!focusIn(name);
  const next = stepDomain(names, domain.peek(), by, has);
  if (next !== domain.peek()) chooseDomain(next);
}

/** Show everything: the domain's region while one is looked at (in its view), else the whole event; `home`: also back
 *  to the view's preset direction (3D). */
export function showWhole(home = false) {
  const d = bundle.peek()?.header.domains?.find((x) => x.name === domain.peek());
  if (d) engine?.frameRegion(d.region.rMax, d.region.zMax, true);
  else if (home) engine?.home();
  else engine?.frame(undefined, true);
}

/** The objects of a layer that pass its cut and filter, largest first (by its `list` sort column, else its size
 *  column): the order of its object rows, of N, and of the labels. */
export function ranked(d: DisplayLayer, max = Infinity): number[] {
  const t = event.peek()?.tables[d.table];
  if (!t) return [];
  const pass = passes(d, t, d.cut ? cuts.peek()[d.cut.group] ?? 0 : 0, filterMask(t, filters.peek()[d.table]));
  return topRows(t, d.list?.sort ?? sizeColumn(d.table, t), pass, max);
}

/** Select the next (`by` 1) or previous (-1) object of the selected one's kind, largest first (keyboard: N, Shift+N);
 *  without a selection, the leading object of the first drawn layer with labels (or object rows). */
export function nextObject(by = 1) {
  const b = bundle.peek(), sel = selection.peek();
  if (!b) return;
  const drawn = drawnLayers.peek(), d = sel ? layerOf(sel.table)
    : b.header.display.find((l) => l.labels && drawn[layerKey(l)]) ?? b.header.display.find((l) => l.list && drawn[layerKey(l)]);
  if (!d) return;
  const rows = ranked(d);
  if (!rows.length) return;
  const at = sel ? rows.indexOf(sel.row) : -1;
  const i = at < 0 ? (by > 0 ? 0 : rows.length - 1) : (at + by + rows.length) % rows.length;
  jump({ table: d.table, row: rows[i] });
}
