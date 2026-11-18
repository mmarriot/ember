// What the view draws and how, as the user sets it (the side panel's ticks, the domain, the cuts, the view preset),
// and the state of the page around the view (pointer, pop-ups, messages, theme). openBundle (open.ts) resets most of
// it for each bundle; the components change it as the user acts.
import { computed, effect, signal } from "@preact/signals";
import type { DisplayLayer, Header, ViewName } from "../../io/format";
import type { Legend, ThemeName } from "../../render/colour";
import type { Hit } from "../../render/picking";
import type { Caption } from "../../render/replay";
import { drawsLayer, sharedDomains } from "../domains";
import { bundle } from "./data";
import { layerKey } from "./names";

// ---- What is drawn

/** Per display layer key: ticked in the side panel. Set to the bundle's defaults (`visible`) when it opens. */
export const visible = signal<Record<string, boolean>>({});

/** The domain looked at (header `domains`), null for all of them. A view: choosing one leaves the user's ticks alone. */
export const domain = signal<string | null>(null);
/** The domains whose layers every domain draws (header `domains[].shared`, e.g. the physics objects). */
export const shared = computed(() => sharedDomains(bundle.value?.header));
/** Whether a layer belongs in the current domain's view: its own domain's layers, those without a domain and those of
 *  a shared domain. */
export const inDomain = (d: DisplayLayer, current = domain.value) => drawsLayer(d, current, shared.value);

/** The side-panel tab to open: a domain's, when it is chosen. A new object each time, so that choosing the same domain
 *  again reopens its tab. */
export const openTab = signal<{ name: string } | null>(null);
/** The side-panel tab that lists the layers of the domains that are not shared. */
export const DETECTOR = "Detector";
/** The side-panel tab that lists a domain's layers: its own for a shared domain, else Detector (in bundles with
 *  domains, the Detector tab follows the domain bar). */
export const tabOfDomain = (h: Pick<Header, "domains">, name: string) =>
  h.domains?.find((d) => d.name === name)?.shared ? name : DETECTOR;

/** One kind of object looked at alone (its heading's "only", e.g. the tracks, the jets), as `soloKey` names it: only
 *  its collections are drawn, whatever part of the detector is looked at; null: everything ticked. A view, like
 *  `domain`: the ticks are kept, and a selection still draws its own objects of other kinds (its parts, its truth). */
export const solo = signal<string | null>(null);
/** A side-panel heading: a kind in one part of the detector ("HGCal|Hits" is not "Calo|Hits"). */
export const soloKey = (d: Pick<DisplayLayer, "domain" | "group">) => `${d.domain ?? ""}|${d.group}`;

/** Per display layer key: drawn. A layer is drawn when it is ticked and in the domain's view; with a kind looked at
 *  alone (`solo`), when it is one of that kind's ticked collections, or, with none of them ticked, all of its
 *  collections. The focus changes this further (selection.ts focusLayers). */
export const drawnLayers = computed(() => {
  const vis = visible.value,
    d = domain.value,
    only = solo.value,
    all = bundle.value?.header.display ?? [];
  const alone = only ? all.filter((l) => soloKey(l) === only) : [],
    ticked = alone.some((l) => vis[layerKey(l)]);
  return Object.fromEntries(
    all.map((l) => [
      layerKey(l),
      only ? alone.includes(l) && (!ticked || !!vis[layerKey(l)]) : !!vis[layerKey(l)] && inDomain(l, d),
    ]),
  );
});

/** Cut groups of the profile (display hint `cut`): one slider each, shared by all the layers that name the group. */
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
/** Per cut group: the slider's minimum. */
export const cuts = signal<Record<string, number>>({});
/** Per display layer key of an `onSelection` layer: draw every object, not only the selection's. */
export const showAll = signal<Record<string, boolean>>({});

/** Per display layer key: the legend of the layer as drawn (written by control/scene.ts). */
export const legends = signal<Record<string, Legend>>({});
/** Per display layer key: how many objects pass the cuts (written by control/scene.ts). */
export const shown = signal<Record<string, number>>({});

/** The camera preset. */
export const view = signal<ViewName>("3d");
/** Labels on the leading objects (layer hint `labels`) and on the focus (key L). */
export const labelsOn = signal(true);

// ---- The page around the view

/** The object under the pointer, where the pointer is, and how many objects are stacked under it. */
export const hover = signal<(Hit & { x: number; y: number; stacked: number }) | null>(null);
/** The dialog open, if any. */
export const dialog = signal<"help" | null>(null);
/** The guided tour is running. */
export const touring = signal(false);
/** What the replay is showing now (its caption). */
export const replayCaption = signal<Caption | null>(null);

/** Short messages shown over the page; each goes after a few seconds (see toast). */
export const toasts = signal<{ id: number; text: string; kind: "info" | "error" }[]>([]);
let toastId = 0;
/** Show a message for 2.5 s (an error for 8 s). */
export function toast(text: string, kind: "info" | "error" = "info") {
  const id = ++toastId;
  toasts.value = [...toasts.value, { id, text, kind }];
  setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), kind === "error" ? 8000 : 2500);
}

// The colour theme: dark unless the user picked light before (remembered in this browser when storage is available,
// under a key that keeps its "evd." prefix: see model/library.ts).
const savedTheme = (() => {
  try {
    return localStorage.getItem("evd.theme");
  } catch {
    return null;
  }
})();
export const theme = signal<ThemeName>(savedTheme === "light" ? "light" : "dark");
// The page's CSS follows the theme through <html data-theme>.
effect(() => {
  document.documentElement.dataset.theme = theme.value;
});
export function toggleTheme() {
  theme.value = theme.value === "dark" ? "light" : "dark";
  try {
    localStorage.setItem("evd.theme", theme.value);
  } catch {
    /* not remembered */
  }
}
