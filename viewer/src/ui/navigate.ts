// Moving the focus between objects from lists and links (e.g. a candidate and its truth-graph particle), with "back";
// the camera glides to the new focus, conservatively. Moving between the parts of the detector (domains), keeping the
// focus.
import { batch } from "@preact/signals";
import { type DisplayLayer, kindName } from "../io/bundle";
import { filterMask, filters } from "../model/custom";
import { rowsInDomain, stepDomain, withFocus } from "../model/domains";
import { passes, stepRow, topRows } from "../model/objects";
import {
  anchor,
  bundle,
  cuts,
  domain,
  drawnLayers,
  event,
  focus,
  focusBack,
  focusOn,
  highlight,
  ladder,
  layerKey,
  layerOf,
  modes,
  openCard,
  openTab,
  reconstructed,
  selection,
  shared,
  sizeColumn,
  tabOfDomain,
  toast,
  unlook,
  view,
} from "../model/store";
import type { Ref } from "../model/relations";
import { engine } from "./scene";

export function jump(ref: Ref) {
  focusOn(ref);
  selection.value = { ...ref };
  engine?.frame(highlight.peek() ?? undefined, true, 800);
}

/** Back (keyboard: B): while another object is looked at, to the card's own object; else to the previous card. */
export function back() {
  if (anchor.peek()) unlook();
  else {
    const prev = focusBack();
    if (!prev) return;
    selection.value = { ...prev };
  }
  engine?.frame(highlight.peek() ?? undefined, true, 800);
}

/** Across the reco ↔ truth link (keyboard: X): from a reco object to its best truth match (a hit or a layer cluster:
 *  the particle with the most simulated energy in it); from a truth object to the reco object of the latest
 *  reconstruction step whose own best match it is (else the one holding most of it). Says so when there is nothing on
 *  the other side; does nothing in a bundle without truth. */
export function cross() {
  if (!selection.peek() || !modes.peek().roots.truth) return;
  if (anchor.peek()) openCard(selection.peek()!); // across from what the view shows: the object looked at
  const l = ladder.peek(),
    rec = reconstructed.peek();
  if (l) {
    for (const x of l.self.links) {
      if (x.kind === "match" && x.partners.length) return jump({ table: x.truth, row: x.partners[0][0] });
      if (x.kind === "fact" && x.particles.length) return jump({ table: x.truth, row: x.particles[0][0] });
      if (x.kind === "derived" && x.partners.length) return jump({ table: x.truth, row: x.partners[0][0] });
    }
    return toast(
      l.self.links.some((x) => x.kind === "none" || x.kind === "container")
        ? "No truth link for this kind: step to one of its parts"
        : "No truth particle for this object",
    );
  }
  const all = (rec?.reco ?? []).filter((r) => r.partners.length),
    own = all.find((r) => r.partners.some((p) => p.best)) ?? all[0];
  if (!own) return toast("Nothing reconstructed is linked to this truth object");
  jump({ table: own.table, row: (own.partners.find((p) => p.best) ?? own.partners[0]).row });
}

/** Look at one domain (header `domains`): only its layers, those of shared domains and those without a domain are
 *  drawn, in its view and colour mode (store.ts activeMode), and its layers' tab opens in the side panel; null:
 *  everything, in the bundle's starting view. A selection is kept: the view frames its objects in the domain (e.g. a
 *  jet's calorimeter clusters), else the domain's region (All: the objects). `animate`: glide there. */
export function chooseDomain(name: string | null, animate = true) {
  const h = bundle.peek()?.header,
    d = h?.domains?.find((x) => x.name === name);
  if (!h || (name && !d)) return;
  batch(() => {
    // one rebuild for the domain (and its colour mode) and its view
    domain.value = d ? d.name : null;
    if (d) openTab.value = { name: tabOfDomain(h, d.name) }; // its tab in the side panel (choosing a tab does not change the view)
    view.value = d?.view ?? h.view?.start ?? "3d";
  });
  const part = focusIn(d?.name ?? null),
    f = focus.peek();
  if (part && f) engine?.frame(withFocus(part, f), animate, 700);
  else if (d) engine?.frameRegion(d.region.rMax, d.region.zMax, animate);
  else engine?.frame(undefined, animate);
}

/** The focus's objects that domain `name` draws as its own (model/domains.ts rowsInDomain); null without a focus. */
function focusIn(name: string | null) {
  const h = bundle.peek()?.header,
    hl = highlight.peek();
  return h && hl && focus.peek() ? rowsInDomain(hl, h.display, name, shared.peek()) : null;
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
  const pass = passes(d, t, d.cut ? (cuts.peek()[d.cut.group] ?? 0) : 0, filterMask(t, filters.peek()[d.table]));
  return topRows(t, d.list?.sort ?? sizeColumn(d.table, t), pass, max);
}

/** Select the next (`by` 1) or previous (-1) object of the selected one's kind, largest first (keyboard: N, Shift+N);
 *  without a selection, the leading object of the first drawn layer with labels (or object rows). Not for hits, which
 *  lead nowhere (400k HGCal cells at PU200). A press ranks the kind's passing rows: a sort of the table, ~40 ms for the
 *  110k layer clusters of a PU200 event, under 2 ms for its tracks (measured). */
export function nextObject(by = 1) {
  const b = bundle.peek(),
    sel = selection.peek();
  if (!b) return;
  const drawn = drawnLayers.peek(),
    d = sel
      ? layerOf(sel.table)
      : (b.header.display.find((l) => l.labels && drawn[layerKey(l)]) ??
        b.header.display.find((l) => l.list && drawn[layerKey(l)]));
  if (!d) return;
  if (d.repr === "cells" || d.context)
    return toast(`N steps through objects (e.g. jets, tracks); ${kindName(d).toLowerCase()} are hits`);
  const row = stepRow(ranked(d), sel?.table === d.table ? sel.row : undefined, by);
  if (row !== undefined) jump({ table: d.table, row });
}
