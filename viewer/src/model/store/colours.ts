// What the colours show: the colour mode (particle type, each layer its own, or truth) and, per layer, the display
// hint as drawn in that mode; and what the truth graph says of each kind of object (docs/truth.md), in the words the
// colour key and the cards use. The rules are in model/modes.ts and model/match.ts; this file holds the signals.
import { computed, signal } from "@preact/signals";
import type { DisplayLayer } from "../../io/format";
import { describeNoLink } from "../../render/colour";
import { colourBy, type ColourMode, withColour } from "../custom";
import { truthStatus, type TruthStatus } from "../match";
import { modeColouring, modeRoots, recoColourOf } from "../modes";
import { bundle } from "./data";
import { kindOf, labelOf, layerKey, layerOf } from "./names";
import { domain } from "./view";

/** The bundle's two colour roots (the truth particles, the candidates) and how each table reaches them
 *  (model/modes.ts). Computed once per bundle. */
export const modes = computed(() => {
  const h = bundle.value?.header,
    roots = h ? modeRoots(h) : {};
  const colouring = {
    reco: h && roots.reco ? modeColouring(h, roots.reco) : undefined,
    truth: h && roots.truth ? modeColouring(h, roots.truth, true) : undefined,
  };
  return { roots, colouring };
});

/** What the colours show, as the user chose (key T, or the switch in the colour key): the reconstruction, or the
 *  truth. Not remembered: a bundle opens on the reconstruction. */
export const colourChoice = signal<"reco" | "truth">("reco");

/** Whether the bundle can colour by truth: its truth particles say which level is "the particle" (display hint
 *  `particle`). Bundles made before that hint have none, and their truth colours would follow other rules than the
 *  key describes. */
export const truthColours = computed(() => {
  const t = modes.value.roots.truth;
  return !!t && !!bundle.value?.header.display.some((d) => d.table === t && d.particle);
});

/** The colour mode: "truth" when chosen and the bundle has truth particles; otherwise "pid" when the bundle has a
 *  reconstruction root (candidates), else "layers". Also "layers" while a domain that asks for it (its `colourMode`)
 *  is looked at, e.g. the tracker, whose tracks keep their pT colours. */
export const activeMode = computed<ColourMode>(() => {
  if (colourChoice.value === "truth" && truthColours.value) return "truth";
  const d = bundle.value?.header.domains?.find((x) => x.name === domain.value);
  return modes.value.roots.reco && d?.colourMode !== "layers" ? "pid" : "layers";
});

/** A layer's display hint as drawn in colour mode `mode`, then with the user's colour choice for it (`by`).
 *  - "truth": every reco layer takes the colour of the truth particle its chain leads to, or one neutral colour; a
 *    kind with no truth of its own is also faint.
 *  - "pid": the reconstruction root (candidates) keeps its own colouring (particle type), and every reco layer whose
 *    colouring chain reaches it takes its candidate's colour. A categorical reco layer that cannot reach it is drawn by
 *    its colour column if it has one and no colour of its kind (`fixedColour`), else keeps its own colouring (e.g. one
 *    colour per vertex, a muon's kind colour).
 *  - Truth and background layers keep their own colouring in every mode (a particle is not a candidate). */
export function shownLayer(d: DisplayLayer, mode = activeMode.peek(), by = colourBy.peek()): DisplayLayer {
  const { colouring, roots } = modes.peek();
  if (mode === "truth" && !d.context && !d.truth) {
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

/** How far a kind with no truth is mixed towards the background in the truth mode. */
export const FAINT = 0.6;

/** Each drawn table's truth status (model/match.ts truthStatus). Computed once per bundle. */
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

/** Whether `table` is a kind with no truth of its own (status "none"). */
export const noTruth = (table: string) => truthStatuses.peek().get(table)?.kind === "none";

// The words under a layer drawn in one neutral colour. render/colour.ts asks for them through this hook, so that the
// renderer does not depend on the store. In the truth mode they say why the kind has no truth (docs/truth.md "Where
// truth stops").
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
