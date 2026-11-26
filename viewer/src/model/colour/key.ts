// The colour key as data: what each colour in the view means, the colour mode's group first, then each drawn layer's
// own scale that the mode does not explain. The side panel (ui/sidebar/Key.tsx) and a saved picture
// (render/overlay.ts) both draw it, so a picture's key always says what the screen's says.
import { computed } from "@preact/signals";
import type { DisplayLayer, Header } from "../../io/format";
import { PALETTES, type Legend, type Pal } from "../../render/colour";
import { colourBy } from "../custom/settings";
import { PAIR, type PairClass } from "../truth/pair";
import { cached } from "../event/cache";
import { colourLevel } from "../truth/levelFlags";
import {
  activeMode,
  bundle,
  drawnLayers,
  event,
  layerKey,
  layerOf,
  legends,
  modes,
  pairView,
  short,
  shown,
  shownLayer,
  theme,
  truthColours,
  truthLevel,
  truthStatuses,
  truthText,
} from "../store";

/** One line of the key: one colour, a few colours of one kind, or a value ramp (`ramp`, low to high). `small`: drawn
 *  small in the view (pile-up, no truth). `ref`: the truth particle it names. */
export interface KeyEntry {
  label: string;
  colours: readonly string[];
  ramp?: boolean;
  small?: boolean;
  ref?: { table: string; row: number };
}
/** A group of lines under a title. `id`: what it is ("truth", "pair", "pid", "kinds", or a layer's key), so a user's
 *  edits of it (ui/dialogs/Picture.tsx) hold from event to event. `about`: said after the title (the pair's particle). */
export interface KeyGroup {
  id: string;
  title: string;
  about?: string;
  entries: KeyEntry[];
}

/** The pair view's classes (truth/pair.ts): class, plain name, definition (behind the ⓘ). */
export const CLASSES: [Exclude<PairClass, 0>, string, string][] = [
  [PAIR.matched, "found", "the particle's (its branch's) hits and objects, in its match"],
  [PAIR.split, "in another object", "the particle's, in another object of the kind compared (split off)"],
  [PAIR.missed, "in no object", "the particle's, in no object of the kind compared (missed)"],
  [PAIR.contamination, "not from it", "in its match, but from other particles or from none (contamination)"],
  [PAIR.reco, "part of its match", "part of a matched object, with no truth of its own (e.g. layer clusters)"],
  [PAIR.branch, "rest of its branch", "other particles of the branch that left hits (e.g. an interaction's products)"],
  [PAIR.uncompared, "not compared", "the particle's hits where no reco kind has an association (HF, HO)"],
];

/** The colour level the truth colours use: the one chosen in the key, else the profile's `particle` bit. */
export function truthLevelOf(header: Header) {
  const root = modes.value.roots.truth,
    d = root ? header.display.find((l) => l.table === root) : undefined;
  return truthLevel.value ?? colourLevel(2 ** (d?.particle?.bit ?? 2));
}

/** The colour mode's group; null without a key (no candidates or truth). Colouring layer by layer has a title and no
 *  lines: each layer's own scale says it. */
export const modeKey = computed<KeyGroup | null>(() => {
  const pair = pairView.value,
    pal = PALETTES[theme.value],
    mode = activeMode.value,
    b = bundle.value,
    { roots } = modes.value;
  if (!b || (!truthColours.value && mode !== "pid")) return null;
  const legendOf = (table?: string) => {
    const d = table ? layerOf(table) : undefined,
      l = d ? legends.value[layerKey(d)] : undefined;
    return l?.kind === "category" ? (l.items ?? []) : [];
  };
  const none = (label: string): KeyEntry => ({ label, colours: [pal.unassigned], small: true });
  if (pair) {
    const shown = new Set([...pair.classes.values()].flatMap((cls) => [...cls]));
    return {
      id: "pair",
      title: "truth ↔ reco pair",
      entries: [
        ...CLASSES.filter(([c]) => shown.has(c)).map(([c, name]) => ({
          label: c === PAIR.reco && pair.particle < 0 ? "no particle: nothing confirmed" : name,
          colours: [pal.pair[c]],
        })),
        none("everything else"),
      ],
    };
  }
  if (mode === "truth") {
    const level = truthLevelOf(b.header),
      ev = event.value,
      d = roots.truth ? layerOf(roots.truth) : undefined,
      first = d?.particle?.first ? ev?.tables[d.table]?.columns[d.particle.first] : undefined,
      pileup = !!first && cached(ev!, `pileup|${d!.table}`, () => first.some((v) => !Number(v)));
    return {
      id: "truth",
      title: `${level.name} (truth)`,
      entries: [
        ...legendOf(roots.truth).map((it) => ({
          label: (it.ref && truthText(it.ref.table, it.ref.row)) || it.label,
          colours: [it.colour],
          ref: it.ref,
        })),
        // A class level's legend names every class drawn, the rest and pile-up among them.
        ...(level.classes
          ? []
          : [
              level.only
                ? { label: `outside the ${level.name} level`, colours: [pal.other], small: true }
                : { label: "other signal", colours: [pal.other] },
              ...(pileup ? [{ label: "pile-up", colours: [pal.pileup], small: true }] : []),
            ]),
        none(`${level.classes ? "no in-time truth" : "no simulated energy"}, or not cleanly matched`),
      ],
    };
  }
  if (mode === "pid")
    return {
      id: "pid",
      title: "candidate type (reco)",
      entries: [
        ...legendOf(roots.reco).map((it) => ({ label: it.label, colours: [it.colour] })),
        none("in no candidate"),
      ],
    };
  return { id: "layers", title: "each layer's own", entries: [] };
});

/** Whether the mode's key explains the layer's colours, so its own legend would only repeat it. In the truth colours,
 *  a kind with no associator is the key's one "faint" line, not a line under each of its collections. */
export function explainedByKey(d: DisplayLayer) {
  const mode = activeMode.value;
  if (mode === "layers" || d.context || colourBy.value[layerKey(d)]) return false;
  if (pairView.value?.classes.has(d.table)) return true;
  if (mode === "truth") {
    const c = shownLayer(d).colourBy;
    return (
      d.table === modes.value.roots.truth ||
      truthStatuses.value.get(d.table)?.kind === "none" ||
      (c !== d.colourBy && c !== "none")
    );
  }
  return !d.truth && (d.table === modes.value.roots.reco || shownLayer(d).colourBy !== d.colourBy);
}

/** A layer's own colours as key lines: its categories, a few of its colours and what they stand for, or its value
 *  ramp with its range (`column`: and its column). */
export function layerEntries(d: DisplayLayer, legend: Legend, pal: Pal, column = true): KeyEntry[] {
  const shownD = shownLayer(d, activeMode.value, colourBy.value);
  if (legend.kind === "ramp") {
    const [lo, hi] = [legend.range.lo, legend.range.hi].map((v) => short(legend.range.scale === "log" ? 10 ** v : v));
    const label = `${column && legend.column ? `${legend.column} ` : ""}${lo} – ${hi} ${legend.unit}`.trim();
    return [{ label, colours: pal.ramps[legend.palette], ramp: true }];
  }
  // Named categories, and a kind's own colour (one item: its name), which is drawn also over "none"
  if (legend.items && !legend.items.some((it) => it.ref))
    return legend.items.map((it) => ({ label: it.label, colours: [it.colour] }));
  if (shownD.colourBy === "none") return [{ label: legend.text, colours: [pal.unassigned] }];
  // Identity colours (directly, or taken along a chain in the colour mode) show the identity palette.
  const identity =
    shownD.colourBy === "identity" || (typeof shownD.colourBy === "object" && shownD.colourBy !== d.colourBy);
  const label = `${legend.text}${legend.note ? `; ${legend.note}` : ""}`;
  return [{ label, colours: (identity ? pal.identity : pal.categories).slice(0, 5) }];
}

/** A layer's name standing alone: its label, after its kind's where the label does not say it ("Jets: AK4 PUPPI (raw,
 *  no JEC)"; but "Electrons (HGCal)"). */
export const layerTitle = (d: DisplayLayer) =>
  d.label.toLowerCase().includes(d.group.toLowerCase()) ? d.label : `${d.group}: ${d.label}`;

/** The whole key of the view as drawn now, for a picture: the mode's group where something drawn takes its colours,
 *  then each drawn layer whose colours the mode does not explain. Layers in one colour of their kind share one
 *  untitled group ("● Jets ● Muons"). */
export const viewKey = computed<KeyGroup[]>(() => {
  const pal = PALETTES[theme.value],
    pair = pairView.value,
    mode = modeKey.value,
    kinds: KeyGroup = { id: "kinds", title: "", entries: [] },
    own: KeyGroup[] = [];
  let used = false; // something drawn takes the mode's colours
  for (const d of bundle.value?.header.display ?? []) {
    const key = layerKey(d),
      legend = legends.value[key],
      drawn = shown.value[key] ?? event.value?.tables[d.table]?.n ?? 0;
    if (!drawnLayers.value[key] || !drawn) continue;
    if (explainedByKey(d)) used = true;
    if (!legend || explainedByKey(d)) continue;
    const entries = layerEntries(d, legend, pal);
    if (entries.length === 1 && entries[0].label === d.label)
      kinds.entries.push({ ...entries[0], label: layerTitle(d) });
    else own.push({ id: key, title: layerTitle(d), entries });
  }
  const about = pair && pair.particle >= 0 ? truthText(pair.truth, pair.particle) : undefined;
  return [used && mode ? { ...mode, about } : null, kinds, ...own].filter((g): g is KeyGroup => !!g?.entries.length);
});
