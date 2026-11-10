// Application state. Components and the renderer react to these signals.
import { computed, effect, signal } from "@preact/signals";
import { Bundle, type DisplayLayer, type EventData, httpSource, kindName, type Table, unitOf } from "../io/bundle";
import type { Legend, ThemeName } from "../render/colour";
import type { Caption } from "../render/replay";
import type { Hit, ViewName } from "../render/engine";
import { customColumns, loadCustom, withCustomColumns } from "./custom";
import { levelsOf, relatedParts, sameRef, type Ref } from "./relations";

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
export const visible = signal<Record<string, boolean>>({}); // display layer key -> shown
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
// any focus (e.g. a candidate): while it lasts, everything it is made of is drawn (all levels, even hidden layers)
// and only those objects can be picked. Selecting one of them keeps the focus; selecting anything else focuses on it
// (the old focus is kept for "back"); clearing the selection (a click on nothing, Esc) ends it.
export const selection = signal<Ref | null>(null);
export const focus = signal<Ref | null>(null);
export const focusHistory = signal<Ref[]>([]); // earlier focuses, oldest first

const partsOf = (ref: Ref | null) => {
  const b = bundle.value, ev = event.value;
  return b && ev && ref && ref.row < (ev.tables[ref.table]?.n ?? 0) ? relatedParts(ev, b.header, ref) : null;
};
const focusParts = computed(() => partsOf(focus.value));
/** The selection's relatives: what it is made of, what it is part of, what is linked to it (e.g. MC truth). */
export const relatives = computed(() => (sameRef(selection.value, focus.value) ? focusParts.value : partsOf(selection.value)));
/** What is drawn highlighted: the focus, its levels and what is linked to it (e.g. its MC truth). What contains it
 *  is listed in the inspector, not highlighted: big containers would cover it. */
export const highlight = computed(() => {
  const b = bundle.value, ev = event.value, f = focus.value, parts = focusParts.value;
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
  else if (!sel) { focus.value = null; if (focusHistory.peek().length) focusHistory.value = []; }
});

// Hidden layers the focus has objects in (e.g. a candidate's tracksters) are drawn while it lasts. The keys are
// joined into a string first, so the layers are only rebuilt when the set changes, not on every focus.
const focusLayerKeys = computed(() => {
  const b = bundle.value, hl = highlight.value, vis = visible.value;
  if (!b || !hl) return "";
  return b.header.display.filter((d) => !d.alternative && !vis[layerKey(d)] && hl.get(d.table)?.size).map(layerKey).sort().join("|");
});
export const focusLayers = computed(() => new Set(focusLayerKeys.value ? focusLayerKeys.value.split("|") : []));

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
    // A layer whose position columns are missing would be drawn at the origin: leave it out and say so.
    const placed = (d: DisplayLayer) => d.position.every((c) => c in (b.header.tables[d.table]?.columns ?? {}));
    const unplaced = b.header.display.filter((d) => !placed(d));
    if (unplaced.length) {
      toast(`Not drawn, position columns missing: ${unplaced.map((d) => `${d.label} (${d.table})`).join(", ")}`, "error");
      b.header.display = b.header.display.filter(placed);
    }
    bundle.value = b;
    bundleName.value = name;
    view.value = b.header.view?.start ?? "3d";
    loadCustom(b.header.profile, Object.fromEntries(b.header.display.filter((d) => d.filter).map((d) => [d.table, d.filter!])));
    visible.value = Object.fromEntries(b.header.display.map((d) => [layerKey(d), d.visible]));
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
