// The colour signals: the colour mode and each layer's display hint as drawn in it, the truth level, the truth graph,
// and each kind's truth status. The rules are in colour/modes.ts and truth/match.ts.
import { computed, signal } from "@preact/signals";
import type { DisplayLayer, EventData, Header } from "../../io/format";
import { colours, describeNoLink, type Legend, type Pal } from "../../render/colour";
import { colourBy, type ColourMode, withColour } from "../custom/settings";
import { inText } from "../event/describe";
import { truthStatus, type TruthStatus } from "../truth/match";
import { graphOf } from "../truth/graph";
import type { ColourLevel } from "../truth/levelFlags";
import { modeColouring, modeRoots, recoColourOf } from "../colour/modes";
import { bundle, event } from "./data";
import { kindOf, labelOf, layerKey, layerOf } from "./names";
import { domain } from "./view";

/** The bundle's two colour roots (the truth particles, the candidates) and how each table reaches them. */
export const modes = computed(() => {
  const h = bundle.value?.header,
    roots = h ? modeRoots(h) : {};
  const colouring = {
    reco: h && roots.reco ? modeColouring(h, roots.reco) : undefined,
    truth: h && roots.truth ? modeColouring(h, roots.truth, true) : undefined,
  };
  return { roots, colouring };
});

/** What the colours show, as the user chose (key T, or the colour key's switch). Not remembered. */
export const colourChoice = signal<"reco" | "truth">("reco");

/** The truth level the truth colours group by, as chosen in the colour key; null: the profile's `particle` bit. */
export const truthLevel = signal<ColourLevel | null>(null);

/** Whether the bundle can colour by truth: its truth particles have the `particle` hint (older bundles do not, and
 *  their colours would follow other rules than the key describes). */
export const truthColours = computed(() => {
  const t = modes.value.roots.truth;
  return !!t && !!bundle.value?.header.display.some((d) => d.table === t && d.particle);
});

/** The colour mode: "truth" when chosen and possible; else "pid" with a reconstruction root (candidates), unless the
 *  domain looked at asks for "layers" (the tracker, whose tracks keep their pT colours). */
export const activeMode = computed<ColourMode>(() => {
  if (colourChoice.value === "truth" && truthColours.value) return "truth";
  const d = bundle.value?.header.domains?.find((x) => x.name === domain.value);
  return modes.value.roots.reco && d?.colourMode !== "layers" ? "pid" : "layers";
});

/** A layer's display hint as drawn in colour mode `mode`, with the user's colour choice for it (`by`):
 *  - "truth": a reco layer takes the colour of the truth particle its chain leads to, or a neutral one;
 *  - "pid": a reco layer whose chain reaches the candidates takes its candidate's colour; one that cannot is drawn by
 *    its colour column if it has no colour of its kind, else keeps its own colouring;
 *  - truth and background layers keep their own colouring in every mode. */
export function shownLayer(d: DisplayLayer, mode = activeMode.peek(), by = colourBy.peek()): DisplayLayer {
  const { colouring, roots } = modes.peek();
  if (mode === "truth" && !d.context && !d.truth) {
    const c = colouring.truth?.[d.table];
    // A kind with no truth of its own (docs/truth.md "Where truth stops") is also faint, so it never looks matched.
    const faint = noTruth(d.table) ? { dim: Math.max(d.dim ?? 0, FAINT) } : {};
    return withColour({ ...d, colourBy: c ?? "none", fixedColour: undefined, ...faint }, by[layerKey(d)]);
  }
  const pid = mode === "pid" && !d.context && !d.truth;
  const h = bundle.peek()?.header,
    c = pid && h && colouring.reco && roots.reco ? recoColourOf(h, colouring.reco, roots.reco, d.table) : undefined;
  const plain = pid && !c && d.table !== roots.reco && d.colourBy && d.colour && !d.fixedColour; // a kind's own colour wins
  return withColour(c ? { ...d, colourBy: c } : plain ? { ...d, colourBy: undefined } : d, by[layerKey(d)]);
}

/** The truth particles as a graph (truth/graph.ts), once per event; null without them. Their vertex table is the
 *  other truth table a plain relation from them reaches. */
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

/** Each drawn table's truth status (truth/match.ts truthStatus), once per bundle. */
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

// The words under a layer drawn in one neutral colour, through a hook so that the renderer does not depend on the
// store.
describeNoLink((d) => {
  const s = activeMode.peek() === "truth" ? truthStatuses.peek().get(d.table) : undefined;
  if (s?.kind === "none") return `no CMSSW associator for ${inText(truthName(d.table))}`; // the gap: behind the key's i and in the Truth tab
  if (s?.kind === "match") return "matched to truth, not to a particle: no particle colour (its card)";
  return "one colour: no link to the colour's source";
});

/** Adds the colour root's legend (the candidate types the key lists) to `drawn`, also when the root is not drawn (the
 *  PF candidates start unticked). One pass over its rows. */
export function withRootLegend(header: Header, ev: EventData, drawn: Record<string, Legend>, pal: Pal) {
  const root = modes.peek().roots.reco,
    d = root === undefined ? undefined : layerOf(root),
    t = root === undefined ? undefined : ev.tables[root];
  if (d && t && !(layerKey(d) in drawn)) drawn[layerKey(d)] = colours(d, t, ev, header, pal).legend;
}
