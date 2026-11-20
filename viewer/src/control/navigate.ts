// Moving the focus between objects from lists and links (e.g. a candidate and its truth-graph particle), with "back";
// the camera glides to the new focus, conservatively. Moving between the parts of the detector (domains), keeping the
// focus.
import { batch, computed, effect, signal } from "@preact/signals";
import { type DisplayLayer, kindName } from "../io/format";
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
  framed,
  highlight,
  kindOf,
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
  statement,
  subject,
  tabOfDomain,
  toast,
  unlook,
  view,
} from "../model/store";
import type { Ref } from "../model/relations";
import { inText } from "../model/describe";
import { partChoices, type PartMatch } from "../model/statement";
import { engine } from "./scene";

/** Frame the focus in the part of the view the card leaves free (engine.frame, store `framed`): `F`, a double click,
 *  the card's button, X, back, a link; `ms`: the glide's length (0: at once). In a part of the detector, what it has
 *  there (partFrame), as when the part is chosen: a TICL candidate's shower, not the whole track from the vertex to
 *  it, which would leave the shower a speck at the edge. */
export function frameFocus(ms = 450) {
  const rows = framed.peek(),
    f = focus.peek(),
    least = f && rows ? vertexRadius(f, rows) : undefined;
  if (least !== undefined) engine?.frame(new Map([[f!.table, [f!.row]]]), ms > 0, ms, 0, least);
  else engine?.frame((rows && partFrame(domain.peek(), rows)) ?? rows ?? undefined, ms > 0, ms);
}

/** What to frame of the focus in domain `name`: its objects there (focusIn), with the focus itself (a jet's cone from
 *  its vertex: its clusters alone would fill a 2D view), unless it is a line (an electron, a truth particle), which
 *  runs from the vertex, outside the part. Null when it has nothing there. */
function partFrame(name: string | null, hl: Map<string, Set<number>>) {
  const part = focusIn(name, hl),
    f = focus.peek();
  if (!part || !f) return null;
  return LINES.has(layerOf(f.table)?.repr ?? "") ? part : withFocus(part, f);
}

/** For a vertex (profile kind "vertex", "secondaryVertex", ...: made of lines, its tracks), the radius it is framed
 *  at: the smallest `minRadius` of its lines' parts of the detector (the tracker's: about the pixel volume), so the
 *  view shows where its tracks start, not the whole tracker they cross. Undefined for anything else. */
function vertexRadius(f: Ref, rows: Map<string, Set<number>>) {
  const d = layerOf(f.table),
    h = bundle.peek()?.header;
  if (!h || !d || !/vertex$/i.test(d.kind ?? "")) return undefined;
  const lines = [...rows.keys()].map(layerOf).filter((l) => l && l.table !== f.table && LINES.has(l.repr)),
    radii = lines.flatMap((l) => h.domains?.find((x) => x.name === l!.domain)?.minRadius ?? []);
  return radii.length ? Math.min(...radii) : undefined;
}
const LINES = new Set(["helix", "segments", "polyline"]);

export function jump(ref: Ref) {
  focusOn(ref);
  selection.value = { ...ref };
  frameFocus(800);
}

/** Back (keyboard: B): while another object is looked at, to the card's own object; else to the previous card. */
export function back() {
  if (anchor.peek()) unlook();
  else {
    const prev = focusBack();
    if (!prev) return;
    selection.value = { ...prev };
  }
  frameFocus(800);
}

/** A particle X can go to from an object without a truth link of its own: one of its parts' own matches. */
export type CrossChoice = PartMatch & { truth: string; measure: string };
/** The choices X opened (the card shows them), null while none are open. They close with the selection. */
export const crossChoices = signal<CrossChoice[] | null>(null);
effect(() => {
  selection.value;
  crossChoices.value = null;
});

/** Where X goes from the card's object: `to`, the other side of its own link (a reco object's match, the particle
 *  with the most simulated energy in a hit; for a truth object, the reco object of the latest reconstruction step
 *  whose own best match it is, else the one holding most of it); else `choices`, its parts' own matches; else
 *  nothing, and `why`. */
export const crossing = computed<{ to?: Ref; choices: CrossChoice[]; why?: string }>(() => {
  const l = ladder.value,
    rec = reconstructed.value,
    st = statement.value,
    sel = subject.value;
  if (!sel || !modes.value.roots.truth) return { choices: [], why: "No truth in this data set" };
  if (l) {
    for (const x of l.self.links) {
      if (x.kind === "match" && x.partners.length)
        return { to: { table: x.truth, row: x.partners[0][0] }, choices: [] };
      if (x.kind === "fact" && x.particles.length)
        return { to: { table: x.truth, row: x.particles[0][0] }, choices: [] };
    }
    const choices = st ? partChoices(st) : [];
    if (choices.length) return { choices };
    const own = st?.own,
      kind = inText(kindOf(sel.table));
    const why =
      own?.kind === "match"
        ? "Not matched: the associator found no truth for it, and none of its parts is matched"
        : own?.kind === "fact"
          ? "No simulated energy in this hit"
          : own?.kind === "container"
            ? "Its truth is that of what contains it"
            : `No CMSSW associator for ${kind}, and none of its parts is matched`;
    return { choices, why };
  }
  const all = (rec?.reco ?? []).filter((r) => r.partners.length),
    own = all.find((r) => r.partners.some((p) => p.best)) ?? all[0];
  if (!own) return { choices: [], why: "Nothing reconstructed is linked to this truth object" };
  return { to: { table: own.table, row: (own.partners.find((p) => p.best) ?? own.partners[0]).row }, choices: [] };
});

/** Across the reco ↔ truth link (keyboard: X), see `crossing`; with no link of the object's own, a chooser of its
 *  parts' matches opens in the card (X again takes the first). Says why when there is nothing on the other side;
 *  does nothing in a bundle without truth. While another object is looked at, X crosses from that one; `fromCard`
 *  (the card's button) crosses from the card's own object. */
export function cross(fromCard = false) {
  if (!selection.peek() || !modes.peek().roots.truth) return;
  const open = crossChoices.peek();
  if (open?.length) return crossTo(open[0]);
  if (anchor.peek()) {
    if (fromCard) unlook();
    else openCard(selection.peek()!); // across from what the view shows: the object looked at
  }
  const c = crossing.peek();
  if (c.to) return jump(c.to);
  if (c.choices.length) crossChoices.value = c.choices;
  else toast(c.why ?? "No truth link");
}

/** Go to one of X's choices: its particle. */
export function crossTo(c: CrossChoice) {
  crossChoices.value = null;
  jump({ table: c.truth, row: c.particle });
}

/** Look at one domain (header `domains`): only its layers and those without a domain are drawn (those of shared
 *  domains as an overlay, store/view.ts `overlay`), in its view and colour mode (store/colours.ts activeMode), and its
 *  layers' tab opens in the side panel; null: everything, in the bundle's starting view. A selection is kept: the view frames its objects in the domain (e.g. a
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
  const hl = framed.peek(),
    part = hl && partFrame(d?.name ?? null, hl);
  if (part) engine?.frame(part, animate, 700);
  else if (d) engine?.frameRegion(d.region.rMax, d.region.zMax, animate);
  else engine?.frame(undefined, animate);
}

/** The focus's objects (`hl`: of its highlight) that domain `name` draws as its own (model/domains.ts rowsInDomain);
 *  null without a focus. */
function focusIn(name: string | null, hl = highlight.peek()) {
  const h = bundle.peek()?.header;
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
