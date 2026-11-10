// Application state. Components and the renderer react to these signals.
import { computed, effect, signal } from "@preact/signals";
import { Bundle, type DisplayLayer, type EventData, httpSource } from "../io/bundle";
import type { Legend, ThemeName } from "../render/colour";
import type { Caption } from "../render/replay";
import type { Hit, ViewName } from "../render/engine";
import { customColumns, loadCustom, withCustomColumns } from "./custom";
import { related, type Ref } from "./relations";

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
export const selection = signal<Ref | null>(null);
export const hover = signal<(Hit & { x: number; y: number }) | null>(null);
export const view = signal<ViewName>("3d");
export const dialog = signal<"help" | "about" | null>(null);
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
/** Name of a table for the UI: "Tracksters · CLUEstering (SoA)" for a layer with a kind, else its label. */
export const labelOf = (table: string) => {
  const d = bundle.value?.header.display.find((l) => l.table === table);
  if (!d) return table;
  return d.kind ? `${d.group} · ${d.label}${d.source ? ` (${d.source})` : ""}` : d.label;
};

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

export const highlight = computed(() => {
  const b = bundle.value, ev = event.value, sel = selection.value;
  return b && ev && sel ? related(ev, b.header, sel) : null;
});

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

export async function openBundle(name: string, open = () => httpSource(name)) {
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
    loadCustom(b.header.profile);
    visible.value = Object.fromEntries(b.header.display.map((d) => [layerKey(d), d.visible]));
    cuts.value = Object.fromEntries([...cutGroups.value].map(([g, info]) => [g, info.default]));
    await showEvent(0);
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
