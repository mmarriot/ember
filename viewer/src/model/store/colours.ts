// What the colours show: the colour mode (particle type, each layer its own, or truth) and, per layer, the display
// hint as drawn in that mode; and what the truth graph says of each kind of object (docs/truth.md), in the words the
// colour key and the cards use. The rules are in model/colour/modes.ts and model/truth/match.ts; this file holds the signals.
import { computed, signal } from "@preact/signals";
import type { DisplayLayer, EventData, Header } from "../../io/format";
import { colours, describeNoLink, type Legend, type Pal } from "../../render/colour";
import { colourBy, type ColourMode, withColour } from "../custom/settings";
import { inText } from "../event/describe";
import { facts } from "../truth/facts";
import { truthStatus, type TruthStatus } from "../truth/match";
import { type ColourLevel, graphOf } from "../truth/truth";
import { modeColouring, modeRoots, recoColourOf } from "../colour/modes";
import { bundle, event } from "./data";
import { kindOf, labelOf, layerKey, layerOf } from "./names";
import { domain } from "./view";

/** The bundle's two colour roots (the truth particles, the candidates) and how each table reaches them
 *  (model/colour/modes.ts). Computed once per bundle. */
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

/** The truth level the truth colours group the particles by (model/truth/truth.ts COLOUR_LEVELS), as chosen in the colour
 *  key; null: the profile's (the truth particles' `particle` bit). */
export const truthLevel = signal<ColourLevel | null>(null);

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

/** The domain looked at is a calorimeter's: it records simulated energy in hits drawn as cells (HGCal, Calo; not a
 *  muon system's chamber deposits). Truth particles are then named by their energy, elsewhere by pT and η (names.ts
 *  truthText). */
export const caloView = computed(() => {
  const dom = domain.value,
    h = bundle.value?.header;
  return (
    !!dom &&
    !!h &&
    facts(h).some((f) => {
      const l = h.display.find((x) => x.table === f.to);
      return l?.domain === dom && l.repr === "cells";
    })
  );
});

/** The truth particles as a graph (model/truth/truth.ts): parents, children and vertices, once per event; null without truth
 *  particles. Their vertex table is the other truth table a plain relation from them reaches. */
export const truthGraph = computed(() => {
  const b = bundle.value,
    ev = event.value,
    root = modes.value.roots.truth,
    t = root ? ev?.tables[root] : undefined;
  if (!b || !ev || !root || !t) return null;
  const rels = Object.entries(b.header.relations).filter(
      ([n, r]) => r.from === root && !r.association && ev.relations[n],
    ),
    kids = rels.find(([, r]) => r.to === root),
    vtx = rels.find(([, r]) => r.to !== root && b.header.display.some((d) => d.table === r.to && d.truth))?.[1].to;
  return {
    graph: graphOf(t, kids && ev.relations[kids[0]], vtx ? ev.tables[vtx] : undefined),
    particles: root,
    vertices: vtx,
  };
});

/** How far a kind with no truth is mixed towards the background in the truth mode. */
export const FAINT = 0.6;

/** Each drawn table's truth status (model/truth/match.ts truthStatus). Computed once per bundle. */
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
  if (s?.kind === "none") return `no CMSSW associator for ${inText(truthName(d.table))}`; // the gap: behind the key's i and in the Truth tab
  if (s?.kind === "match") return "matched to truth, not to a particle: no particle colour (its card)";
  return "one colour: no link to the colour's source";
});

/** Adds to the legends `drawn` (layer key -> legend) the colour root's (the candidate types the key lists), also when
 *  that layer is not drawn: the PF candidates start unticked, and a preset can untick them again. One pass over its
 *  rows, under a millisecond for 10k PF candidates. */
export function withRootLegend(header: Header, ev: EventData, drawn: Record<string, Legend>, pal: Pal) {
  const root = modes.peek().roots.reco,
    d = root === undefined ? undefined : layerOf(root),
    t = root === undefined ? undefined : ev.tables[root];
  if (d && t && !(layerKey(d) in drawn)) drawn[layerKey(d)] = colours(d, t, ev, header, pal).legend;
}
