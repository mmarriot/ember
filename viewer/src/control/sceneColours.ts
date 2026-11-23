// The colours of the drawn layers (control/scene.ts): per object, from the colour mode, the user's choices, the pair
// view and the truth colours' slots, with value scales shared between layers.
import { untracked } from "@preact/signals";
import type { DisplayLayer, EventData, Header, Table } from "../io/format";
import { colourBy } from "../model/custom/custom";
import { cutMin } from "../model/custom/cuts";
import { identities, type SlotRank } from "../model/event/relations";
import { madeOfSimCells } from "../model/truth/facts";
import { PAIR, type Pair, pairKey } from "../model/truth/pair";
import {
  activeMode,
  bundle,
  layerOf,
  modes,
  noTruth,
  numberOf,
  pairView,
  shownLayer,
  theme,
  truthRank,
} from "../model/store";
import { colours, hexRgb, type LayerFor, PALETTES, type Pal, type Range, valueRange } from "../render/colour";

/** What a layer's colours are computed from: its display hint as drawn, its table, and its cut values. */
export interface ColourItem {
  d: DisplayLayer;
  t: Table;
  key: string;
  cut?: Float32Array;
}

/** Each table's colouring as drawn: the colour mode's, then the user's (or the preset's) choice for its layer. */
const chosenColours =
  (header: Header): LayerFor =>
  (table) => {
    const d = header.display.find((l) => l.table === table);
    return d && shownLayer(d);
  };

/** By truth, markers of a kind with no truth of its own made of cells with simulated energy (layer clusters,
 *  superclusters) are drawn small, rimless and under the hits: as grey rings over the hits they hid the hits' truth
 *  colours. Also in the pair view, whatever order the pair and the colour mode came in (the pair only recolours). */
export const underHits = (d: DisplayLayer) => {
  const h = bundle.peek()?.header;
  return activeMode.peek() === "truth" && d.repr === "markers" && noTruth(d.table) && !!h && madeOfSimCells(h, d.table);
};

/** Colours for `items`, mixed towards the background by their `dim`. Layers that share a cut group and colour column
 *  (e.g. SoA and legacy rechit energies) share one value scale, from the objects of `pool` that pass the cuts and
 *  filters, so equal values get equal colours in every layer. */
export function colourEntries(
  items: ColourItem[],
  ev: EventData,
  header: Header,
  cuts: Record<string, number>,
  pal: Pal,
  pool: ColourItem[] = items,
) {
  const scale = (e: Pick<ColourItem, "d" | "key">) => `${e.d.cut?.group ?? e.key}|${e.d.colour}`;
  const samples = new Map<string, number[]>();
  for (const e of pool) {
    const { d, t, cut } = e,
      col = d.colour ? t.columns[d.colour] : undefined;
    if (!col || d.colourBy) continue; // categorical layers keep their own colours
    const min = cutMin(d, cut, cuts),
      step = Math.max(1, Math.floor(t.n / 20000)); // a sample is enough for the range
    const values = samples.get(scale(e)) ?? [];
    for (let i = 0; i < t.n; i += step) if (!cut || cut[i] >= min) values.push(Number(col[i]));
    samples.set(scale(e), values);
  }
  const ranges = new Map<string, Range>([...samples].map(([k, values]) => [k, valueRange(values)]));
  const layerFor = chosenColours(header),
    pair = pairView.peek(),
    classRgb = pal.pair.map(hexRgb),
    chosen = colourBy.peek();
  const bg = [(pal.background >> 16) & 255, (pal.background >> 8) & 255, pal.background & 255].map((v) => v / 255);
  return items.map((e) => {
    const cls = e.d.context || chosen[e.key] ? undefined : pair?.classes.get(e.d.table); // a layer's own choice wins
    const out = cls
        ? pairColours(cls, classRgb)
        : colours(e.d, e.t, ev, header, pal, {
            range: ranges.get(scale(e)),
            layerFor,
            rank: truthRank.peek(),
            numberOf: (t, r) => untracked(() => numberOf(t, r)),
          }),
      dim = e.d.dim;
    if (dim) for (let i = 0; i < out.rgb.length; i++) out.rgb[i] += (bg[i % 3] - out.rgb[i]) * dim;
    if (underHits(e.d)) out.emphasis = new Uint8Array(e.t.n); // small and rimless
    return out;
  });
}

export const pairKeyOf = (p: Pair | null) => (p ? pairKey(p) : null);

/** The truth colours' slots under `rank`, as a string ("" without identity colours on the truth particles): the
 *  layers' colours change only when it does. */
export function slotsKey(header: Header, ev: EventData, rank: SlotRank) {
  const root = modes.peek().roots.truth,
    d0 = root ? layerOf(root) : undefined,
    t = root ? ev.tables[root] : undefined;
  if (!d0 || !t || rank.classes) return ""; // a class level has no slots: a selection never recolours
  const d = shownLayer(d0);
  if (d.colourBy !== "identity") return "";
  const r = identities(d, t, ev, header, PALETTES[theme.peek()].identity.length, rank);
  return `${r.top.join(",")}|${r.preferred}|${JSON.stringify(r.rule)}`;
}

/** The pair view's colours: one per class (model/truth/pair.ts); objects outside the pair drawn small. */
function pairColours(cls: Uint8Array, classRgb: readonly (readonly number[])[]) {
  const rgb = new Float32Array(3 * cls.length),
    emphasis = new Uint8Array(cls.length);
  for (let i = 0; i < cls.length; i++) {
    rgb.set(classRgb[cls[i]], 3 * i);
    emphasis[i] = cls[i] === PAIR.other ? 0 : 1;
  }
  return { rgb, emphasis, legend: { kind: "category" as const, text: "truth ↔ reco pair (colour key)" } };
}
