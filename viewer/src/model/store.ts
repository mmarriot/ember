// Application state. Components and the renderer react to these signals.
import { batch, computed, effect, signal } from "@preact/signals";
import { around, blobSource, Bundle, httpSource, type Source } from "../io/bundle";
import { type DisplayLayer, type EventData, type Header, kindName, REPRS, type Table, unitOf } from "../io/format";
import { describeNoLink, type Legend, type ThemeName } from "../render/colour";
import type { Caption } from "../render/replay";
import type { Hit, ViewName } from "../render/engine";
import { drawsLayer, sharedDomains, startDomain } from "./domains";
import { colourBy, type ColourMode, customColumns, loadCustom, withColour, withCustomColumns } from "./custom";
import { focusLevels, levelLayers, mergeAcrossDomains, scopeLevels, stepLevel } from "./levels";
import { modeColouring, modeRoots, recoColourOf } from "./modes";
import { opensPair, truthStatus, type TruthStatus } from "./match";
import { PAIR, type Pair, pairFor, pairShows } from "./pair";
import { levelsOf, type Related, relatedParts, sameRef, type Ref } from "./relations";
import { matchClass, recoLadder, recoOfTruth } from "./chain";
import {
  cleanList,
  describeFailure,
  type Failure,
  forgetRecent,
  type Listed,
  locate,
  mine,
  NameError,
  noteRecent,
  ownerOf,
  readIndex,
  titleOf,
} from "./library";

export type { Listed };
/** The site's shared data sets (index.json): test stands, reference samples. A person's own are in `mine` (library.ts). */
export const catalogue = signal<{ bundles: Listed[]; updated?: string }>({ bundles: [] }); // newest data first
/** The data set open: its title and index entry where a list has it (the site's, mine, or its owner's); `local`: a
 *  file from this computer, which no link can reach; `external`: an address on another site, which this site's
 *  lists, publishers and expiry say nothing about. */
export interface Opened {
  file: string;
  title: string;
  local: boolean;
  external: boolean;
  entry?: Listed;
}
/** How `bundleName` was opened (set with it, in one batch); `theirs`: its entry in its owner's index, for a data set
 *  from a link that no list of mine has. */
const openedAs = signal<{ local: boolean; external: boolean; theirs?: Listed }>({ local: false, external: false });
/** The name of the data set being opened (the last one asked for), until it shows or fails. */
export const opening = signal<string | null>(null);
/** Why the last data set did not open, while nothing else is shown instead (ui/Start.tsx). */
export const openFailure = signal<Failure | null>(null);
/** Start-up is over: the lists were read and the first data set, if any, was asked for. */
export const started = signal(false);
export const following = signal(false); // Live mode (ui/live.ts): play new files as they appear

export const bundle = signal<Bundle | null>(null);
export const bundleName = signal("");
/** Named from the lists as they are now: a link's data set opens before they are read, and takes its title then. */
export const opened = computed<Opened | null>(() => {
  const file = bundleName.value,
    { local, external, theirs } = openedAs.value;
  if (!file || !bundle.value) return null;
  const entry =
    local || external
      ? undefined
      : (catalogue.value.bundles.find((x) => x.file === file) ?? mine.value.find((x) => x.file === file) ?? theirs);
  return { file, local, external, entry, title: entry?.title ?? (local ? file : titleOf(file)) };
});
export const eventIndex = signal(0);
export const rawEvent = signal<EventData | null>(null); // as read from the file
/** The bundle of the event shown: for a moment after another bundle opens, still the previous one. */
const shownOf = signal<Bundle | null>(null);
/** The index entry (run, event, ...) of the event shown, once it is the open bundle's: until a newly opened bundle's
 *  first event is read, `eventIndex` is the previous bundle's (or 0, while a link's event 30 is on its way) and names
 *  an event that is not the one on screen, nor the one coming. */
export const shownEntry = computed(() =>
  bundle.value && shownOf.value === bundle.value ? bundle.value.events[eventIndex.value] : undefined,
);
export const event = computed(() => (rawEvent.value ? withCustomColumns(rawEvent.value, customColumns.value) : null));
export const loading = signal(false);
export const loadMs = signal(0);
export const visible = signal<Record<string, boolean>>({}); // display layer key -> ticked by the user
/** The domain looked at (header `domains`), null for all: a view, it leaves the user's ticks alone. */
export const domain = signal<string | null>(null);
/** The side-panel tab to open: a domain's, when it is chosen (a new object each time, so choosing it again reopens it). */
export const openTab = signal<{ name: string } | null>(null);
/** The domains whose layers every domain draws (header `domains[].shared`, e.g. the physics objects). */
export const shared = computed(() => sharedDomains(bundle.value?.header));
/** The side-panel tab that lists a domain's layers: its own for a shared domain, else Detector (bundles with domains:
 *  the Detector tab follows the domain bar). */
export const tabOfDomain = (h: Pick<Header, "domains">, name: string) =>
  h.domains?.find((d) => d.name === name)?.shared ? name : DETECTOR;
export const DETECTOR = "Detector";
/** Whether a layer belongs in the current domain's view: its own domain's layers, those without a domain and those of
 *  a shared domain. */
export const inDomain = (d: DisplayLayer, current = domain.value) => drawsLayer(d, current, shared.value);
/** One kind of object looked at alone (its heading's "only", e.g. the tracks, the jets), as `soloKey` names it: only
 *  its collections are drawn, whatever the part of the detector looked at; null: everything ticked. A view, like
 *  `domain`: the ticks are kept, and a selection still draws its own objects of other kinds (its parts, its truth). */
export const solo = signal<string | null>(null);
/** A side-panel heading: a kind in one part of the detector ("HGCal|Hits" is not "Calo|Hits"). */
export const soloKey = (d: Pick<DisplayLayer, "domain" | "group">) => `${d.domain ?? ""}|${d.group}`;
/** The layers drawn: ticked and in the domain's view (display layer key -> drawn); with a kind alone (`solo`), its
 *  ticked collections, or with none ticked those of its preferred reconstruction path. */
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
      only ? alone.includes(l) && (ticked ? !!vis[layerKey(l)] : !l.alternative) : !!vis[layerKey(l)] && inDomain(l, d),
    ]),
  );
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
/** Labels on the leading objects (layer hint `labels`) and the focus (key L). */
export const labelsOn = signal(true);
export const replayCaption = signal<Caption | null>(null); // what the replay is showing now

// Colour theme: dark unless the user picked light before (remembered in this browser when storage is available).
const savedTheme = (() => {
  try {
    return localStorage.getItem("evd.theme");
  } catch {
    return null;
  }
})();
export const theme = signal<ThemeName>(savedTheme === "light" ? "light" : "dark");
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

export const layerKey = (d: Pick<DisplayLayer, "table" | "repr">) => `${d.table}:${d.repr}`;
/** The (first) display layer of a table. */
export const layerOf = (table: string) => bundle.value?.header.display.find((l) => l.table === table);
/** A layer's label with the reconstruction path that made it, if the profile names one: "CLUEstering (SoA)". */
export const layerName = (d: DisplayLayer) => `${d.label}${d.source ? ` (${d.source})` : ""}`;
/** Short name of a table's kind of object: its group for a layer with a kind ("Tracksters"), else its label. */
export const kindOf = (table: string) => {
  const d = layerOf(table);
  return d ? kindName(d) : table;
};
/** Name of a table for the UI: "Tracksters · CLUEstering (SoA)" for a layer with a kind, else its label. */
export const labelOf = (table: string) => {
  const d = layerOf(table);
  return !d ? table : d.kind ? `${d.group} · ${layerName(d)}` : d.label;
};
/** A table's kind, with its layer's name only where the kind has several collections ("PF clusters · ECAL"). */
export const stepName = (table: string) => {
  const all = bundle.value?.header.display.filter((l) => !l.alternative && kindOf(l.table) === kindOf(table)) ?? [];
  return new Set(all.map((l) => l.table)).size > 1 ? `${kindOf(table)} · ${layerOf(table)?.label}` : kindOf(table);
};
/** Rows of `table`, largest first by its size column (e.g. energy), if it has one. */
export function largestFirst(table: string, rows: number[]) {
  const t = event.value?.tables[table],
    c = t && sizeColumn(table, t),
    key = c ? t!.columns[c] : undefined;
  return key ? [...rows].sort((a, b) => Number(key[b]) - Number(key[a])) : rows;
}
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
  const h = bundle.value?.header,
    roots = h ? modeRoots(h) : {};
  const colouring = {
    reco: h && roots.reco ? modeColouring(h, roots.reco) : undefined,
    truth: h && roots.truth ? modeColouring(h, roots.truth, true) : undefined,
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
 *  (particle type) and every reco layer whose colouring chain reaches it takes its candidate's colour; a categorical reco
 *  layer it cannot reach is drawn by its colour column if it has one and no colour of its kind (`fixedColour`), else it
 *  keeps its own colouring (e.g. one colour per vertex, a muon's kind colour);
 *  truth layers keep their own colouring (a particle is not a candidate). Then the user's choice for that layer. */
export function shownLayer(d: DisplayLayer, mode = activeMode.peek(), by = colourBy.peek()): DisplayLayer {
  const { colouring, roots } = modes.peek();
  if (mode === "truth" && !d.context && !d.truth) {
    // by truth: the chain to the truth particles, else one neutral colour
    const c = colouring.truth?.[d.table];
    // A kind with no truth of its own (docs/truth.md "Where truth stops") is also faint, so it never looks matched.
    const faint = noTruth(d.table) ? { dim: Math.max(d.dim ?? 0, FAINT) } : {};
    return withColour({ ...d, colourBy: c ?? "none", fixedColour: undefined, ...faint }, by[layerKey(d)]);
  }
  const pid = mode === "pid" && !d.context && !d.truth;
  // Only a chain that reaches the candidates: one that ends elsewhere (e.g. calorimeter hits through PF clusters to PF
  // candidates) would show another table's categories under a key that describes candidate types.
  const h = bundle.peek()?.header,
    c = pid && h && colouring.reco && roots.reco ? recoColourOf(h, colouring.reco, roots.reco, d.table) : undefined;
  const plain = pid && !c && d.table !== roots.reco && d.colourBy && d.colour && !d.fixedColour; // a kind's own colour wins
  return withColour(c ? { ...d, colourBy: c } : plain ? { ...d, colourBy: undefined } : d, by[layerKey(d)]);
}

/** How far a kind with no truth is mixed towards the background in truth mode. */
export const FAINT = 0.6;
/** Each drawn table's truth status (model/match.ts), once per bundle. */
export const truthStatuses = computed(() => {
  const b = bundle.value,
    out = new Map<string, TruthStatus>();
  if (!b) return out;
  for (const d of b.header.display) {
    const s = truthStatus(b.header, d.table, modes.value.colouring.truth);
    if (s) out.set(d.table, s);
  }
  return out;
});
/** The name truth statements use for `table`: its kind ("Jets"), or its layer's name where layers of one kind differ
 *  in truth ("PF clusters · HCAL forward" has none, the ECAL ones are matched). */
export function truthName(table: string) {
  const d = layerOf(table),
    st = truthStatuses.peek(),
    kind = kindOf(table);
  const same = (bundle.peek()?.header.display ?? [])
    .filter((l) => kindOf(l.table) === kind)
    .every((l) => st.get(l.table)?.kind === st.get(table)?.kind);
  return d && !same ? labelOf(table) : kind;
}
/** Whether `table` is a kind with no truth of its own (status none). */
export const noTruth = (table: string) => truthStatuses.peek().get(table)?.kind === "none";
// The words under a layer drawn in one neutral colour: by truth, why it has none (docs/truth.md "Where truth stops").
describeNoLink((d) => {
  const s = activeMode.peek() === "truth" ? truthStatuses.peek().get(d.table) : undefined;
  if (s?.kind === "none")
    return `no truth for ${truthName(d.table)
      .split(" ")
      .map((w) => (/^[A-Z][a-z]/.test(w) ? w.toLowerCase() : w))
      .join(" ")}${s.gap !== undefined ? ` (gap ${s.gap})` : ""}`;
  if (s?.kind === "match") return "matched to truth, not to a particle: no particle colour (its card)";
  return "one colour: no link to the colour's source";
});

/** In the "pid" and "truth" modes with something selected: its truth <-> reco pair, which colours every layer
 *  (Viewport); null when the pair has nothing to show (no candidate, and no hits of its particle), and for a kind with
 *  no truth of its own (a jet never opens a pair; its constituents may). */
export const pairView = computed<Pair | null>(() => {
  const f = focus.value,
    b = bundle.value,
    ev = event.value,
    { roots, colouring } = modes.value;
  if (
    activeMode.value === "layers" ||
    !f ||
    !b ||
    !ev ||
    !roots.reco ||
    !colouring.reco ||
    f.row >= (ev.tables[f.table]?.n ?? 0)
  )
    return null;
  if (!opensPair(b.header, f.table, colouring.truth, colouring.reco)) return null;
  const truthLayer = roots.truth ? b.header.display.find((d) => d.table === roots.truth) : undefined;
  const pair = pairFor(
    ev,
    b.header,
    f,
    { truth: roots.truth, reco: roots.reco },
    { truth: colouring.truth, reco: colouring.reco },
    truthLayer,
  );
  return pairShows(pair) ? pair : null;
});

/** A number in a few significant figures, for names, legends and charts. */
export const short = (v: number) => (Number.isInteger(v) || Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(3));
/** A value in full (3 decimals; exponent notation when very large or small), for tables of values. */
export const full = (v: number | bigint) =>
  typeof v === "bigint"
    ? v.toString()
    : Number.isInteger(v)
      ? v.toLocaleString()
      : Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 1e-3)
        ? v.toExponential(3)
        : v.toFixed(3);

/** A short name for one object, from its layer's `describe` hint (e.g. "π+ · 88.9 GeV"), or "" without one. `skip`:
 *  columns to leave out (shown next to it anyway, e.g. in object rows). */
export function describe(table: string, row: number, skip: string[] = []): string {
  const b = bundle.value,
    t = event.value?.tables[table],
    hint = layerOf(table)?.describe;
  if (!b || !t || !hint || row >= t.n) return "";
  return hint.columns
    .filter((c) => c in t.columns && !skip.includes(c))
    .map((c) => {
      const v = Number(t.columns[c][row]),
        name = hint.names?.[c]?.[String(v)];
      if (name) return name;
      const unit = unitOf(b.header.tables[table]?.columns[c]?.doc);
      return `${short(v)}${unit ? ` ${unit}` : ""}`;
    })
    .join(" · ");
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

// Selection and focus. The selection is what the card (ui/Navigator.tsx) describes. The focus is the object clicked from outside
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
  const b = bundle.value,
    ev = event.value;
  return b && ev && ref && ref.row < (ev.tables[ref.table]?.n ?? 0) ? relatedParts(ev, b.header, ref) : null;
};
const focusParts = computed(() => partsOf(focus.value));
/** The selection's relatives: what it is made of, what it is part of, what is linked to it (e.g. its truth particle). */
export const relatives = computed(() =>
  sameRef(selection.value, focus.value) ? focusParts.value : partsOf(selection.value),
);

// Looking at an object from another's card (ui/Navigator.tsx): a click on an object in the card selects it, so the
// view shows it as any selection (with its parts, its pair), while the card stays on the object it was opened for,
// the `anchor`. Any other selection (a click in the view, a list, N) ends it: the card follows the selection again,
// and the way back is the card's object, shown as it was (in its own focus), never the object looked at.
export const anchor = signal<Ref | null>(null);
let looking: Ref | null = null; // the selection made by `look`, which keeps the anchor
let anchorFocus: Ref | null = null; // the focus the card's object was shown in: itself, or what it is a part of
/** The object the card describes: the anchor while another is looked at, else the selection. */
export const subject = computed(() => anchor.value ?? selection.value);
/** Look at `ref` in the view, keeping the card on its object; on the card's own object, back to it. */
export function look(ref: Ref) {
  const a = anchor.peek(),
    sel = selection.peek();
  if (sameRef(sel, ref)) return;
  if (sameRef(a, ref)) return unlook();
  batch(() => {
    // the focus moves there without history: "back" is the card's object
    if (!a && sel) {
      anchor.value = sel;
      anchorFocus = focus.peek();
    }
    looking = { ...ref };
    focus.value = looking;
    selection.value = looking;
  });
}
/** Back to the card's own object, in the focus it was shown in. */
export function unlook() {
  const a = anchor.peek(),
    f = anchorFocus ?? a;
  if (!a) return;
  batch(() => {
    anchor.value = null;
    looking = null;
    anchorFocus = null;
    focus.value = f;
    selection.value = a;
  });
}
/** Open the card of `ref` (the object looked at, or another): the card's object so far is kept for "back". */
export function openCard(ref: Ref) {
  const a = anchor.peek(),
    home = anchorFocus ?? a;
  batch(() => {
    if (home) {
      focusHistory.value = [...focusHistory.peek(), home];
      anchor.value = null;
      looking = null;
      anchorFocus = null;
    }
    if (!sameRef(selection.peek(), ref)) {
      if (!a) focusOn(ref);
      else focus.value = { ...ref };
      selection.value = { ...ref };
    }
  });
}
const subjectParts = computed(() => (anchor.value ? partsOf(anchor.value) : relatives.value));
/** The ladder of the card's object (model/chain.ts): for a reco object, what it is part of, itself and what it is made
 *  of, each step with its link to the truth; null for a truth object. */
export const ladder = computed(() => {
  const b = bundle.value,
    ev = event.value,
    sel = subject.value,
    parts = subjectParts.value;
  if (!b || !ev || !sel || !parts || layerOf(sel.table)?.truth) return null;
  return recoLadder(ev, b.header, sel, parts, truthStatuses.value, modes.value.roots.truth);
});
/** What the CMSSW associator says of a reco object of a matched kind: clean, impure or unmatched (model/chain.ts
 *  matchClass); undefined for any other kind. The colour of its name in lists. */
export function matchOf(table: string, row: number) {
  const b = bundle.value,
    ev = event.value,
    s = truthStatuses.value.get(table);
  return b && ev && s?.kind === "match" ? matchClass(ev, b.header, s.relation, row) : undefined;
}
/** For a truth object in the card: what was reconstructed from it, per reco kind, and the hits it left (model/chain.ts). */
export const reconstructed = computed(() => {
  const b = bundle.value,
    ev = event.value,
    sel = subject.value;
  if (!b || !ev || !sel || !layerOf(sel.table)?.truth || sel.row >= (ev.tables[sel.table]?.n ?? 0)) return null;
  return recoOfTruth(ev, b.header, sel);
});
/** What is drawn highlighted: the focus, its levels and what is linked to it (e.g. its truth particle). What contains it
 *  is listed in the inspector, not highlighted: big containers would cover it. */
export const highlight = computed(() => {
  const b = bundle.value,
    ev = event.value,
    f = focus.value,
    parts = focusParts.value,
    pair = pairView.value;
  if (pair && f && b) {
    // the pair view: the objects of the pair, wherever they ended up, and the focus
    const hl: Related = new Map([[f.table, new Set([f.row])]]);
    // Missed layer clusters stay in the background: their hits show the same, and the many one-hit clusters of a
    // shower's halo would otherwise cover the clusters that were used (markers are drawn on top of the hits).
    const markers = new Set(b.header.display.filter((d) => d.repr === "markers").map((d) => d.table));
    for (const [t, cls] of pair.classes) {
      const rows = hl.get(t) ?? new Set<number>(),
        skip = markers.has(t) ? PAIR.missed : -1;
      for (let i = 0; i < cls.length; i++) if (cls[i] !== PAIR.other && cls[i] !== skip) rows.add(i);
      if (rows.size) hl.set(t, rows);
    }
    // ... and the reco objects linked to the focus (e.g. a track's vertex), which the pair may not classify.
    for (const [t, rows] of parts?.linked ?? [])
      if (!layerOf(t)?.truth) hl.set(t, new Set([...(hl.get(t) ?? []), ...rows]));
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
  const f = focus.peek(),
    from = anchor.peek() ? (anchorFocus ?? anchor.peek()) : f; // while looking: back is the card's object
  if (sameRef(f, ref)) return;
  if (from) focusHistory.value = [...focusHistory.peek(), from];
  focus.value = { ...ref };
}
/** Back to the previous focus; returns it (null if there is none). */
export function focusBack(): Ref | null {
  const h = focusHistory.peek(),
    prev = h[h.length - 1];
  if (!prev) return null;
  focusHistory.value = h.slice(0, -1);
  focus.value = prev;
  return prev;
}
effect(() => {
  const sel = selection.value,
    a = anchor.peek();
  if (a && !sameRef(sel, looking)) {
    // a selection made elsewhere ends the look; the card's object is kept for "back"
    const home = anchorFocus ?? a,
      h = focusHistory.peek(),
      inView = !!sel && !!highlight.peek()?.get(sel.table)?.has(sel.row);
    anchor.value = null;
    looking = null;
    anchorFocus = null;
    if (sel && !sameRef(sel, a) && !sameRef(h.at(-1) ?? null, home)) focusHistory.value = [...h, home];
    if (sameRef(sel, a)) focus.value = home;
    else if (sel && !inView) focus.value = { ...sel }; // not through focusOn, which would keep the object looked at for back
    if (sel) return;
  }
  if (sel && !highlight.peek()?.get(sel.table)?.has(sel.row)) focusOn(sel);
  else if (!sel) {
    focus.value = null;
    focusLevel.value = null;
    if (focusHistory.peek().length) focusHistory.value = [];
  }
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
  const b = bundle.value,
    top = levelTop.value,
    hl = highlight.value,
    parts = topParts.value,
    pair = pairView.value;
  if (!b || !top || !hl || !parts) return [];
  // Not levels: what is only linked to the top, and in the pair view what the pair does not classify but is linked to
  // the focus (a track's vertex is not a part of its candidate, and stays drawn).
  const linked = pair ? focusParts.value?.linked : undefined;
  const unclassified = (t: string) => {
    const cls = pair!.classes.get(t);
    return [...linked!.get(t)!].every((r) => !cls || cls[r] === PAIR.other);
  };
  const own = (t: string) => parts.madeOf.has(t) || (!parts.linked.has(t) && !(linked?.has(t) && unclassified(t)));
  const lv = focusLevels(b.header.display, top.table, hl, own, b.header.relations);
  // Looking at everything in a bundle with parts of the detector: same-depth levels of different parts become one.
  return !domain.value && (b.header.domains?.length ?? 0) >= 2 ? mergeAcrossDomains(lv, shared.value) : lv;
});
/** The levels ↓ ↑ step through and the card's chain offers to show: those the current domain draws as its own or
 *  shares (model/levels.ts scopeLevels). */
export const focusBar = computed(() => scopeLevels(levels.value, domain.value, shared.value));
/** The chosen level, if the focus has it and it is not one drawn anyway (the bottom ones, lines); else null. */
export const shownLevel = computed(() => {
  const c = focusLevel.value;
  return levels.value.some((l) => !l.always && l.name === c) ? c : null;
});
/** Step the shown level down (+1) or up (-1) among the current domain's (focusBar); false (and nothing changes) if it has none to step
 *  through. */
export function stepFocusLevel(by: number) {
  const bar = focusBar.peek(); // the levels of the current domain (and the shared ones)
  if (!bar.some((l) => !l.always)) return false;
  focusLevel.value = stepLevel(bar, focusLevel.peek(), by);
  return true;
}

// While a focus lasts, what is drawn differs from the ticks in the side panel (and the domain's view): the focus's layer, its stage (e.g. a candidate's
// track) and what is linked to it (its truth) are drawn even from hidden layers; of its levels, only the bottom ones
// and the chosen one are, even if others are ticked. The keys are joined into strings first, so the layers are only
// rebuilt when these sets change, not on every focus.
const focusKeys = computed(() => {
  const b = bundle.value,
    hl = highlight.value,
    vis = drawnLayers.value,
    lv = levels.value,
    f = focus.value;
  if (!b || !hl) return { shown: "", hidden: "" };
  // The focus's own layer is always drawn, also when its kind is a level (the pair view's levels are its candidate's).
  const ticked = (d: DisplayLayer) => !!vis[layerKey(d)],
    own = (d: DisplayLayer) => d.table === f?.table;
  const inLevels = new Set(lv.flatMap((l) => l.layers).filter((d) => !own(d)));
  const { draw, hide: levelHide } = levelLayers(lv, focusLevel.value, ticked),
    hide = levelHide.filter((d) => !own(d));
  const others = b.header.display.filter((d) => !inLevels.has(d) && !d.alternative && hl.get(d.table)?.size);
  const keys = (ds: DisplayLayer[]) => ds.map(layerKey).sort().join("|");
  return { shown: keys([...others, ...draw].filter((d) => !ticked(d))), hidden: keys(hide.filter(ticked)) };
});
const shownKeys = computed(() => focusKeys.value.shown),
  hiddenKeys = computed(() => focusKeys.value.hidden);
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

/** Re-read index.json, bypassing caches (it changes as new data arrive). Its entries are kept only where they are
 *  entries (library.ts cleanList); an index that says it was not rewritten (`updated`) changes nothing, so nothing
 *  that depends on the list re-runs every poll. */
export async function refreshCatalogue() {
  try {
    const r = await fetch("index.json", { cache: "no-store" });
    const index = r.ok ? await r.json() : null,
      bundles = cleanList(index?.bundles);
    if (!bundles || (typeof index.updated === "string" && index.updated === catalogue.peek().updated)) return;
    catalogue.value = { bundles, updated: typeof index.updated === "string" ? index.updated : undefined };
  } catch {
    /* offline or no index: keep what we have */
  }
}

/** Name the data set just opened (open number `id`). One that no list of mine has came from a link: it goes to the
 *  recent ones (from which a list that arrives later takes it back, library.ts pruneRecent), with its title from its
 *  owner's index (read once, in the background), where its expiry is too. An address on another site is neither
 *  looked up nor remembered. */
async function describeOpened(id: number, name: string, local: boolean, external: boolean, index = readIndex) {
  if (local) return noteRecent({ file: name, title: name, local: true });
  if (external || opened.peek()?.entry) return;
  const owner = ownerOf(name),
    theirs = owner ? (await index(owner))?.find((x) => x.file === name) : undefined;
  if (id !== opens) return; // another one was asked for meanwhile
  if (theirs) openedAs.value = { local, external, theirs };
  if (!opened.peek()?.entry || opened.peek()?.entry === theirs)
    noteRecent({ file: name, title: theirs?.title ?? titleOf(name) });
}

let opens = 0; // how many opens were asked for: each knows its number, and only the last one may show anything
/** Open a bundle and show its event `start` (a shared link's event: read only that one, not event 0 first). `local`:
 *  a file from this computer (`open` reads it), which the address bar and the recent list cannot open again.
 *  `name`, when not local, is a file of this site or an address elsewhere (library.ts locate); anything else is
 *  refused. Opens overlap (a slow link and a choice made meanwhile, Live, two quick picks): the last one asked for
 *  wins, whatever order they finish in; one that was overtaken changes nothing and says nothing. Returns whether
 *  this open is the one on screen, with its event read (then a link's view and selection can be applied). */
export async function openBundle(
  name: string,
  open?: () => Promise<Source>,
  start = 0,
  local = false,
  index = readIndex,
): Promise<boolean> {
  const id = ++opens,
    overtaken = () => id !== opens;
  const place = local ? null : locate(name),
    external = place?.kind === "external";
  opening.value = name;
  try {
    if (place?.kind === "bad") throw new NameError(name);
    const source = await (open ?? (() => httpSource(place?.kind === "external" ? place.url : name)))();
    if (overtaken()) return false;
    const b = await Bundle.open(source);
    if (overtaken()) return false;
    // A layer drawn in a way this viewer does not know (a newer bundle): left out, the rest is drawn.
    const unknown = b.header.display.filter((d) => !(REPRS as readonly string[]).includes(d.repr));
    if (unknown.length) {
      console.warn(
        `Not drawn, unknown representation: ${unknown.map((d) => `${d.label} (${d.table}: ${d.repr})`).join(", ")}`,
      );
      b.header.display = b.header.display.filter((d) => !unknown.includes(d));
    }
    // A layer whose position columns are missing would be drawn at the origin: leave it out and say so.
    const placed = (d: DisplayLayer) => d.position.every((c) => c in (b.header.tables[d.table]?.columns ?? {}));
    const unplaced = b.header.display.filter((d) => !placed(d));
    if (unplaced.length) {
      toast(
        `Not drawn, position columns missing: ${unplaced.map((d) => `${d.label} (${d.table})`).join(", ")}`,
        "error",
      );
      b.header.display = b.header.display.filter(placed);
    }
    batch(() => {
      // one change for whoever watches: the address is never written for a name with the previous one's kind
      bundle.value = b;
      solo.value = null;
      colourChoice.value = "reco";
      bundleName.value = name;
      openedAs.value = { local, external };
      openFailure.value = null;
    });
    void describeOpened(id, name, local, external, index);
    const first = startDomain(b.header); // the domain it opens on (e.g. the physics objects), in its view
    view.value = b.header.domains?.find((d) => d.name === first)?.view ?? b.header.view?.start ?? "3d";
    loadCustom(
      b.header.profile,
      Object.fromEntries(b.header.display.filter((d) => d.filter).map((d) => [d.table, d.filter!])),
      !external,
    );
    visible.value = Object.fromEntries(b.header.display.map((d) => [layerKey(d), d.visible]));
    domain.value = first;
    if (first) openTab.value = { name: tabOfDomain(b.header, first) };
    cuts.value = Object.fromEntries([...cutGroups.value].map(([g, info]) => [g, info.default]));
    opening.value = null; // shown from here on: the event's own progress bar
    await showEvent(start);
    return !overtaken() && shownOf.peek() === b;
  } catch (e) {
    if (overtaken()) return false;
    const failure = describeFailure(name, e, local);
    if (failure.kind === "gone") forgetRecent(name);
    // With a data set on screen it stays, and a message says why the other did not open; with nothing to show (a link
    // followed to a file that is gone), the page says so in full.
    if (bundle.peek()) toast(`${failure.title}: ${failure.text}`, "error");
    else openFailure.value = failure;
    return false;
  } finally {
    if (!overtaken()) opening.value = null;
  }
}

/** Keep the data set on screen, chosen again while another was opening: that open is overtaken, as by a new one. */
export function keepShown() {
  opens++;
  opening.value = null;
}

/** Open a file from this computer (dropped on the page, or picked): read where it is, never uploaded. */
export const openLocal = (file: File) => openBundle(file.name, async () => blobSource(file), 0, true);

let wanted = 0; // the event asked for last: shown, or still to be read
let reading: Bundle | null = null; // the bundle whose event is being read: one read at a time
/** The event `d` after the one asked for last (← / →), so presses while an event is read each move on one event. */
export const stepEvent = (d: number) => showEvent(wanted + d);
/** Show event `i` (wrapping around), then read the next one in the direction of travel ahead (io/bundle.ts around).
 *  One event is read at a time: asked for others meanwhile, the read goes on to the last one asked for, skipping
 *  those in between (holding → at PU200 never has more than one 35 MB read in flight). */
export async function showEvent(i: number) {
  const b = bundle.value;
  if (!b || !b.events.length) return;
  const n = b.events.length;
  wanted = ((i % n) + n) % n;
  if (reading === b) return; // the read in flight goes on to `wanted`
  reading = b;
  loading.value = true;
  let index = wanted;
  try {
    for (;;) {
      const t0 = performance.now(),
        ev = await b.event(index);
      if (bundle.peek() !== b) return; // another bundle opened meanwhile
      if (index !== wanted) {
        index = wanted;
        continue;
      }
      const from = shownOf.peek() === b ? eventIndex.peek() : index;
      selection.value = null;
      hover.value = null;
      eventIndex.value = index;
      rawEvent.value = ev;
      shownOf.value = b;
      loadMs.value = performance.now() - t0;
      const { keep, next } = around(index, from, n);
      b.keep(keep);
      if (next !== null) b.event(next).catch(() => {}); // a failed read ahead is tried again when that event is shown
      return;
    }
  } catch (e) {
    if (bundle.peek() === b) {
      wanted = eventIndex.peek();
      toast(`Could not read event ${index + 1}: ${e}`, "error");
    }
  } finally {
    if (reading === b) {
      reading = null;
      loading.value = false;
    }
  }
}
