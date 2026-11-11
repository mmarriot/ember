// Application state. Components and the renderer react to these signals.
import { computed, effect, signal } from "@preact/signals";
import { Bundle, type DisplayLayer, type EventData, httpSource, kindName, REPRS, type Table, unitOf } from "../io/bundle";
import type { Legend, ThemeName } from "../render/colour";
import type { Caption } from "../render/replay";
import type { Hit, ViewName } from "../render/engine";
import { colourBy, type ColourMode, customColumns, loadCustom, withColour, withCustomColumns } from "./custom";
import { focusLevels, levelLayers, stepLevel } from "./levels";
import { modeColouring, modeRoots } from "./modes";
import { PAIR, type Pair, pairFor, pairShows } from "./pair";
import { levelsOf, type Related, relatedParts, sameRef, type Ref } from "./relations";

/** One entry of the site's index.json (written by `evdtools sync`; hand-written ones need only file and title). */
export interface Listed { file: string; title: string; campaign?: string; campaign_title?: string; events?: number; data_time?: string }
export const catalogue = signal<{ bundles: Listed[]; updated?: string }>({ bundles: [] }); // newest data first
export const following = signal(false); // Live mode (ui/live.ts): play new files as they appear

export const bundle = signal<Bundle | null>(null);
export const bundleName = signal("");
export const eventIndex = signal(0);
export const rawEvent = signal<EventData | null>(null); // as read from the file
export const event = computed(() => (rawEvent.value ? withCustomColumns(rawEvent.value, customColumns.value) : null));
export const loading = signal(false);
export const loadMs = signal(0);
export const visible = signal<Record<string, boolean>>({}); // display layer key -> ticked by the user
/** The domain looked at (header `domains`), null for all: a view, it leaves the user's ticks alone. */
export const domain = signal<string | null>(null);
/** The side-panel tab to open: a domain's, when it is chosen (a new object each time, so choosing it again reopens it). */
export const openTab = signal<{ name: string } | null>(null);
/** Whether a layer belongs in the current domain's view: its own domain's layers and those without a domain. */
export const inDomain = (d: DisplayLayer, current = domain.value) => !current || !d.domain || d.domain === current;
/** The layers drawn: ticked and in the domain's view (display layer key -> drawn). */
export const drawnLayers = computed(() => {
  const vis = visible.value, d = domain.value;
  return Object.fromEntries((bundle.value?.header.display ?? []).map((l) => [layerKey(l), !!vis[layerKey(l)] && inDomain(l, d)]));
});
export const legends = signal<Record<string, Legend>>({}); // display layer key -> legend of the drawn layer
export const shown = signal<Record<string, number>>({}); // display layer key -> objects passing the cuts
export const cuts = signal<Record<string, number>>({}); // cut group -> minimum
export const showAll = signal<Record<string, boolean>>({}); // layer key -> draw every object of an onSelection layer
export const hover = signal<(Hit & { x: number; y: number; stacked: number }) | null>(null); // stacked: objects under the cursor
export const view = signal<ViewName>("3d");
export const dialog = signal<"help" | null>(null);
export const toasts = signal<{ id: number; text: string; kind: "info" | "error" }[]>([]);
export const touring = signal(false);
export const replayCaption = signal<Caption | null>(null); // what the replay is showing now

// Colour theme: dark unless the user picked light before (remembered in this browser when storage is available).
const savedTheme = (() => { try { return localStorage.getItem("evd.theme"); } catch { return null; } })();
export const theme = signal<ThemeName>(savedTheme === "light" ? "light" : "dark");
effect(() => { document.documentElement.dataset.theme = theme.value; });
export function toggleTheme() {
  theme.value = theme.value === "dark" ? "light" : "dark";
  try { localStorage.setItem("evd.theme", theme.value); } catch { /* not remembered */ }
}

export const layerKey = (d: Pick<DisplayLayer, "table" | "repr">) => `${d.table}:${d.repr}`;
/** The (first) display layer of a table. */
export const layerOf = (table: string) => bundle.value?.header.display.find((l) => l.table === table);
/** A layer's label with the reconstruction path that made it, if the profile names one: "CLUEstering (SoA)". */
export const layerName = (d: DisplayLayer) => `${d.label}${d.source ? ` (${d.source})` : ""}`;
/** Short name of a table's kind of object: its group for a layer with a kind ("Tracksters"), else its label. */
export const kindOf = (table: string) => { const d = layerOf(table); return d ? kindName(d) : table; };
/** Name of a table for the UI: "Tracksters · CLUEstering (SoA)" for a layer with a kind, else its label. */
export const labelOf = (table: string) => {
  const d = layerOf(table);
  return !d ? table : d.kind ? `${d.group} · ${layerName(d)}` : d.label;
};
/** Whether a layer shows detector hits: drawn as cells, and not a background layer. */
export const isHitLayer = (d: DisplayLayer | undefined) => d?.repr === "cells" && !d.context;
/** The column that says how big an object of `table` is (e.g. its energy), to rank objects: its layer's cut column,
 *  else its colour column, else "energy"; undefined if the table has none of them. */
export const sizeColumn = (table: string, t: Table) => {
  const d = layerOf(table);
  return [d?.cut?.column, d?.colour, "energy"].find((c): c is string => !!c && c in t.columns);
};

// Colour modes (model/modes.ts) and the truth <-> reco pair of the selection (model/pair.ts).
/** The bundle's mode roots and how each reaches every table. */
export const modes = computed(() => {
  const h = bundle.value?.header, roots = h ? modeRoots(h) : {};
  const colouring = {
    reco: h && roots.reco ? modeColouring(h, roots.reco) : undefined,
    truth: h && roots.truth ? modeColouring(h, roots.truth) : undefined,
  };
  return { roots, colouring };
});
/** What the colours show, chosen by the user (key T, or the switch in the colour key): the reconstruction, or the
 *  truth. Not remembered: a bundle opens on the reconstruction. */
export const colourChoice = signal<"reco" | "truth">("reco");
/** Whether the bundle can colour by truth: its truth particles say which level is the particle (`particle`; bundles
 *  made before it have none, and their truth colours would follow other rules than the key describes). */
export const truthColours = computed(() => {
  const t = modes.value.roots.truth;
  return !!t && !!bundle.value?.header.display.some((d) => d.table === t && d.particle);
});
/** The colour mode: "truth" when chosen and the bundle has truth particles; otherwise "pid" when the bundle has a
 *  reconstruction root (candidates), else "layers"; also "layers" while a domain that asks for it (its `colourMode`) is
 *  looked at, e.g. the tracker, whose tracks keep their pT colours. */
export const activeMode = computed<ColourMode>(() => {
  if (colourChoice.value === "truth" && truthColours.value) return "truth";
  const d = bundle.value?.header.domains?.find((x) => x.name === domain.value);
  return modes.value.roots.reco && d?.colourMode !== "layers" ? "pid" : "layers";
});

/** A layer's display hint as drawn. In the "pid" mode, the reconstruction root (candidates) keeps its own colouring
 *  (particle type) and every reco layer it reaches takes its candidate's colour; a categorical reco layer it cannot
 *  reach is drawn by its colour column if it has one (else it keeps its own colouring, e.g. one colour per vertex);
 *  truth layers keep their own colouring (a particle is not a candidate). Then the user's choice for that layer. */
export function shownLayer(d: DisplayLayer, mode = activeMode.peek(), by = colourBy.peek()): DisplayLayer {
  const { colouring, roots } = modes.peek();
  if (mode === "truth" && !d.context && !d.truth) { // by truth: the chain to the truth particles, else one neutral colour
    const c = colouring.truth?.[d.table];
    return withColour({ ...d, colourBy: c ?? "none" }, by[layerKey(d)]);
  }
  const pid = mode === "pid" && !d.context && !d.truth;
  const c = pid && d.table !== roots.reco ? colouring.reco?.[d.table] : undefined;
  const plain = pid && !c && d.table !== roots.reco && d.colourBy && d.colour;
  return withColour(c ? { ...d, colourBy: c } : plain ? { ...d, colourBy: undefined } : d, by[layerKey(d)]);
}

/** In the "pid" and "truth" modes with something selected: its truth <-> reco pair, which colours every layer
 *  (Viewport); null when the pair has nothing to show (no candidate, and no hits of its particle). */
export const pairView = computed<Pair | null>(() => {
  const f = focus.value, b = bundle.value, ev = event.value, { roots, colouring } = modes.value;
  if (activeMode.value === "layers" || !f || !b || !ev || !roots.reco || !colouring.reco || f.row >= (ev.tables[f.table]?.n ?? 0)) return null;
  const truthLayer = roots.truth ? b.header.display.find((d) => d.table === roots.truth) : undefined;
  const pair = pairFor(ev, b.header, f, { truth: roots.truth, reco: roots.reco }, { truth: colouring.truth, reco: colouring.reco }, truthLayer);
  return pairShows(pair) ? pair : null;
});

/** A number in a few significant figures, for names, legends and charts. */
export const short = (v: number) => (Number.isInteger(v) || Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(3));
/** A value in full (3 decimals; exponent notation when very large or small), for tables of values. */
export const full = (v: number | bigint) =>
  typeof v === "bigint" ? v.toString() : Number.isInteger(v) ? v.toLocaleString() : Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(3) : v.toFixed(3);

/** A short name for one object, from its layer's `describe` hint (e.g. "π+ · 88.9 GeV"), or "" without one. */
export function describe(table: string, row: number): string {
  const b = bundle.value, t = event.value?.tables[table], hint = layerOf(table)?.describe;
  if (!b || !t || !hint || row >= t.n) return "";
  return hint.columns.filter((c) => c in t.columns).map((c) => {
    const v = Number(t.columns[c][row]), name = hint.names?.[c]?.[String(v)];
    if (name) return name;
    const unit = unitOf(b.header.tables[table]?.columns[c]?.doc);
    return `${short(v)}${unit ? ` ${unit}` : ""}`;
  }).join(" · ");
}

/** Cut groups of the profile: one slider each, shared by all layers that name the group. */
export const cutGroups = computed(() => {
  const groups = new Map<string, { unit: string; default: number; layers: DisplayLayer[] }>();
  for (const d of bundle.value?.header.display ?? []) {
    if (!d.cut) continue;
    const g = groups.get(d.cut.group) ?? { unit: d.cut.unit ?? "", default: d.cut.default ?? 0, layers: [] };
    g.layers.push(d);
    groups.set(d.cut.group, g);
  }
  return groups;
});

// Selection and focus. The selection is what the inspector describes. The focus is the object clicked from outside
// any focus (e.g. a candidate): while it lasts, it is drawn with its smallest parts (e.g. hits) and, on request, one
// level in between (see `levels`), and only its objects can be picked. Selecting one of them keeps the focus;
// selecting anything else focuses on it (the old focus is kept for "back"); clearing the selection (a click on
// nothing, Esc) ends it.
export const selection = signal<Ref | null>(null);
export const focus = signal<Ref | null>(null);
export const focusHistory = signal<Ref[]>([]); // earlier focuses, oldest first
/** The level shown between the focus and its bottom level (e.g. a candidate's tracksters), by name; null: none. It
 *  is kept while the focus moves (e.g. from one candidate to the next), and forgotten when the focus ends. */
export const focusLevel = signal<string | null>(null);

const partsOf = (ref: Ref | null) => {
  const b = bundle.value, ev = event.value;
  return b && ev && ref && ref.row < (ev.tables[ref.table]?.n ?? 0) ? relatedParts(ev, b.header, ref) : null;
};
const focusParts = computed(() => partsOf(focus.value));
/** The selection's relatives: what it is made of, what it is part of, what is linked to it (e.g. its truth particle). */
export const relatives = computed(() => (sameRef(selection.value, focus.value) ? focusParts.value : partsOf(selection.value)));
/** What is drawn highlighted: the focus, its levels and what is linked to it (e.g. its truth particle). What contains it
 *  is listed in the inspector, not highlighted: big containers would cover it. */
export const highlight = computed(() => {
  const b = bundle.value, ev = event.value, f = focus.value, parts = focusParts.value, pair = pairView.value;
  if (pair && f && b) { // the pair view: the objects of the pair, wherever they ended up, and the focus
    const hl: Related = new Map([[f.table, new Set([f.row])]]);
    // Missed layer clusters stay in the background: their hits show the same, and the many one-hit clusters of a
    // shower's halo would otherwise cover the clusters that were used (markers are drawn on top of the hits).
    const markers = new Set(b.header.display.filter((d) => d.repr === "markers").map((d) => d.table));
    for (const [t, cls] of pair.classes) {
      const rows = hl.get(t) ?? new Set<number>(), skip = markers.has(t) ? PAIR.missed : -1;
      for (let i = 0; i < cls.length; i++) if (cls[i] !== PAIR.other && cls[i] !== skip) rows.add(i);
      if (rows.size) hl.set(t, rows);
    }
    // ... and the reco objects linked to the focus (e.g. a track's vertex), which the pair may not classify.
    for (const [t, rows] of parts?.linked ?? []) if (!layerOf(t)?.truth) hl.set(t, new Set([...(hl.get(t) ?? []), ...rows]));
    return hl;
  }
  return b && ev && f && parts ? levelsOf(ev, b.header, f, parts) : null;
});
/** Objects linked to the focus through an association (its truth; a truth particle's reco objects): a click on one
 *  moves the focus there. */
export const focusLinked = computed(() => focusParts.value?.linked ?? null);
export const focusIsTruth = computed(() => !!focus.value && !!layerOf(focus.value.table)?.truth);

/** Whether an object can be picked: anything without a focus; inside one, its parts except the focus itself (it is
 *  already selected, so a click reaches what it is made of). */
export const inFocus = (table: string, row: number) => {
  const hl = highlight.peek();
  return !hl || (!!hl.get(table)?.has(row) && !sameRef(focus.peek(), { table, row }));
};

/** Focus on `ref`, keeping the current focus for back. */
export function focusOn(ref: Ref) {
  const f = focus.peek();
  if (sameRef(f, ref)) return;
  if (f) focusHistory.value = [...focusHistory.peek(), f];
  focus.value = { ...ref };
}
/** Back to the previous focus; returns it (null if there is none). */
export function focusBack(): Ref | null {
  const h = focusHistory.peek(), prev = h[h.length - 1];
  if (!prev) return null;
  focusHistory.value = h.slice(0, -1);
  focus.value = prev;
  return prev;
}
effect(() => {
  const sel = selection.value;
  if (sel && !highlight.peek()?.get(sel.table)?.has(sel.row)) focusOn(sel);
  else if (!sel) { focus.value = null; focusLevel.value = null; if (focusHistory.peek().length) focusHistory.value = []; }
});

/** The object whose levels are shown: in the pair view, the pair's candidate, so that its particle, the candidate and
 *  anything inside them give the same picture; else the focus. */
export const levelTop = computed<Ref | null>(() => {
  const pair = pairView.value;
  return pair && pair.candidate >= 0 ? { table: pair.reco, row: pair.candidate } : focus.value;
});
const topParts = computed(() => (sameRef(levelTop.value, focus.value) ? focusParts.value : partsOf(levelTop.value)));
/** The kinds of object the focus is made of, top first (see model/levels.ts); its own kind and truth are not levels. */
export const levels = computed(() => {
  const b = bundle.value, top = levelTop.value, hl = highlight.value, parts = topParts.value, pair = pairView.value;
  if (!b || !top || !hl || !parts) return [];
  // Not levels: what is only linked to the top, and in the pair view what the pair does not classify but is linked to
  // the focus (a track's vertex is not a part of its candidate, and stays drawn).
  const linked = pair ? focusParts.value?.linked : undefined;
  const unclassified = (t: string) => { const cls = pair!.classes.get(t); return [...linked!.get(t)!].every((r) => !cls || cls[r] === PAIR.other); };
  const own = (t: string) => parts.madeOf.has(t) || (!parts.linked.has(t) && !(linked?.has(t) && unclassified(t)));
  return focusLevels(b.header.display, top.table, hl, own, b.header.relations);
});
/** The chosen level, if the focus has it and it is not one drawn anyway (the bottom ones, lines); else null. */
export const shownLevel = computed(() => {
  const c = focusLevel.value;
  return levels.value.some((l) => !l.always && l.name === c) ? c : null;
});
/** Step the shown level down (+1) or up (-1); false (and nothing changes) if the focus has no levels to step through. */
export function stepFocusLevel(by: number) {
  if (!levels.peek().some((l) => !l.always)) return false;
  focusLevel.value = stepLevel(levels.peek(), focusLevel.peek(), by);
  return true;
}

// While a focus lasts, what is drawn differs from the ticks in the side panel (and the domain's view): the focus's layer, its stage (e.g. a candidate's
// track) and what is linked to it (its truth) are drawn even from hidden layers; of its levels, only the bottom ones
// and the chosen one are, even if others are ticked. The keys are joined into strings first, so the layers are only
// rebuilt when these sets change, not on every focus.
const focusKeys = computed(() => {
  const b = bundle.value, hl = highlight.value, vis = drawnLayers.value, lv = levels.value, f = focus.value;
  if (!b || !hl) return { shown: "", hidden: "" };
  // The focus's own layer is always drawn, also when its kind is a level (the pair view's levels are its candidate's).
  const ticked = (d: DisplayLayer) => !!vis[layerKey(d)], own = (d: DisplayLayer) => d.table === f?.table;
  const inLevels = new Set(lv.flatMap((l) => l.layers).filter((d) => !own(d)));
  const { draw, hide: levelHide } = levelLayers(lv, focusLevel.value, ticked), hide = levelHide.filter((d) => !own(d));
  const others = b.header.display.filter((d) => !inLevels.has(d) && !d.alternative && hl.get(d.table)?.size);
  const keys = (ds: DisplayLayer[]) => ds.map(layerKey).sort().join("|");
  return { shown: keys([...others, ...draw].filter((d) => !ticked(d))), hidden: keys(hide.filter(ticked)) };
});
const shownKeys = computed(() => focusKeys.value.shown), hiddenKeys = computed(() => focusKeys.value.hidden);
const keySet = (keys: string) => new Set(keys ? keys.split("|") : []);
/** Hidden layers drawn for the focus. */
export const focusLayers = computed(() => keySet(shownKeys.value));
/** Ticked layers not drawn while the focus lasts (levels other than the bottom and the chosen one). */
export const focusHidden = computed(() => keySet(hiddenKeys.value));

let toastId = 0;
export function toast(text: string, kind: "info" | "error" = "info") {
  const id = ++toastId;
  toasts.value = [...toasts.value, { id, text, kind }];
  setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), kind === "error" ? 8000 : 2500);
}

/** Re-read index.json, bypassing caches (it changes as new data arrive). */
export async function refreshCatalogue() {
  try {
    const r = await fetch("index.json", { cache: "no-store" });
    if (r.ok) catalogue.value = await r.json();
  } catch { /* offline or no index: keep what we have */ }
}

/** Open a bundle and show its event `start` (a shared link's event: read only that one, not event 0 first). */
export async function openBundle(name: string, open = () => httpSource(name), start = 0) {
  try {
    const b = await Bundle.open(await open());
    // A layer drawn in a way this viewer does not know (a newer bundle): left out, the rest is drawn.
    const unknown = b.header.display.filter((d) => !(REPRS as readonly string[]).includes(d.repr));
    if (unknown.length) {
      console.warn(`Not drawn, unknown representation: ${unknown.map((d) => `${d.label} (${d.table}: ${d.repr})`).join(", ")}`);
      b.header.display = b.header.display.filter((d) => !unknown.includes(d));
    }
    // A layer whose position columns are missing would be drawn at the origin: leave it out and say so.
    const placed = (d: DisplayLayer) => d.position.every((c) => c in (b.header.tables[d.table]?.columns ?? {}));
    const unplaced = b.header.display.filter((d) => !placed(d));
    if (unplaced.length) {
      toast(`Not drawn, position columns missing: ${unplaced.map((d) => `${d.label} (${d.table})`).join(", ")}`, "error");
      b.header.display = b.header.display.filter(placed);
    }
    bundle.value = b;
    colourChoice.value = "reco";
    bundleName.value = name;
    view.value = b.header.view?.start ?? "3d";
    loadCustom(b.header.profile, Object.fromEntries(b.header.display.filter((d) => d.filter).map((d) => [d.table, d.filter!])));
    visible.value = Object.fromEntries(b.header.display.map((d) => [layerKey(d), d.visible]));
    domain.value = null;
    cuts.value = Object.fromEntries([...cutGroups.value].map(([g, info]) => [g, info.default]));
    await showEvent(start);
  } catch (e) {
    toast(`Could not open ${name}: ${e}`, "error");
  }
}

export async function showEvent(i: number) {
  const b = bundle.value;
  if (!b || !b.events.length) return;
  const index = ((i % b.events.length) + b.events.length) % b.events.length;
  loading.value = true;
  const t0 = performance.now();
  try {
    const ev = await b.event(index);
    selection.value = null;
    hover.value = null;
    eventIndex.value = index;
    rawEvent.value = ev;
    loadMs.value = performance.now() - t0;
  } catch (e) {
    toast(`Could not read event ${index + 1}: ${e}`, "error");
  } finally {
    loading.value = false;
  }
}
