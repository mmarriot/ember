// What the engine draws, kept in step with the store. startScene creates the engine and effects that re-run when a
// signal they read changes:
// - the event, theme, colour mode or choices, filters or truth level: every layer is rebuilt (stopLayers);
// - ticks, the domain or the focus change which layers are drawn: only those are built or freed (stopForced);
// - a cut sets a uniform per layer (stopCuts), the focus a byte per object (stopFocus), and both rebuild the layers
//   drawn only for the selection, which upload only its rows.
// The layers drawn now are `entries`; replayEvent and growTables animate them (the replay, the tour).
import { effect, signal } from "@preact/signals";
import { Color, LinearSRGBColorSpace } from "three";
import type { DisplayLayer, EventData, Header, Table } from "../io/format";
import { colourBy, filterMask, filters } from "../model/custom/settings";
import { cutMin, cutValues, rescued } from "../model/custom/cuts";
import { showUnclustered, unclusteredHidden } from "../model/event/clustered";
import {
  activeMode,
  bundle,
  cuts,
  domain,
  drawnLayers,
  event,
  focus,
  focusLayers,
  focusRowsKey,
  highlight,
  hover,
  inDomain,
  layerKey,
  layerOf,
  legends,
  lookAlone,
  pairView,
  rawEvent,
  replayCaption,
  rest,
  selection,
  showAll,
  shown,
  shownLayer,
  shownLevel,
  theme,
  touring,
  truthLevel,
  truthRank,
  view,
  withRootLegend,
} from "../model/store";
import { type Legend, type Pal, PALETTES } from "../render/colour";
import { Engine, MIN_RADIUS } from "../render/engine";
import { builders, type Layer } from "../render/layers";
import { REST_FADE, restUniform } from "../render/layers/layer";
import { growIn, planReplay, type Parts, type Plan } from "../render/replay";
import { colourEntries, pairKeyOf, slotsKey, underHits } from "./sceneColours";
import { bypassing, dress, nothingDrawn, onlyFor, outline, relationOf, replayOnly, truthOutline } from "./sceneFocus";

/** The engine, once the view's canvas exists (startScene). */
export let engine: Engine | null = null;

/** A layer drawn now, with what it was built from. */
interface Entry {
  d: DisplayLayer; // its display hint as drawn, with the colour mode's and the user's colours (shownLayer)
  t: Table;
  key: string; // layerKey(d)
  cut?: Float32Array; // per row, the value compared with the cut (model/custom/cuts.ts cutValues)
  keep: Float32Array | null; // its filter, per row (null: no filter)
  clustered?: Uint8Array; // while the hits in no cluster are hidden, which of its hits a cluster lists
  rescued: string; // the focus's rows that the filter or the cluster rule hides but that are drawn anyway (cuts.ts rescued)
  rgb: Float32Array; // colour per row
  emphasis?: Uint8Array; // per row, 0 for an object drawn small (outside the truth <-> reco pair)
  layer: Layer;
  uncoloured?: boolean; // nothing of it is drawn yet (truth particles before a selection): its colours wait
  limited?: boolean; // built with only the focus's rows: showing them all again rebuilds it
}
let entries: Entry[] = [];

let plan: Plan | null = null;
/** A replay runs: the layers of every reconstruction stage are drawn (the earlier ones start hidden), so the replay can
 *  walk through them; afterwards only the visible layers are rebuilt. */
const replaying = signal(false);

/** Replay how the shown event built up (render/replay.ts); returns the plan, with its phase times (s of replay;
 *  `pace`: real seconds per second of replay). */
export function replayEvent(pace = 1): Plan | null {
  if (!engine) return null;
  engine.stopReplay(); // a running replay ends first (its end resets `replaying`), so the rebuild below sticks
  lookAlone(null); // the replay builds the whole event up, not one kind
  replaying.value = true; // rebuilds the layers at once (stopLayers), with the hidden stages
  if (!entries.length) {
    replaying.value = false; // nothing to replay, so no replay's end will reset it
    return null;
  }
  hover.value = null;
  // The phases follow the bundle's display hints, not the colours drawn: a colour mode that colours hits through a
  // relation (e.g. "Particle type") must not make them appear with the clusters.
  const header = bundle.peek()?.header,
    hints = new Map(header?.display.map((d) => [layerKey(d), d]));
  const items = entries.filter((e) => !e.d.context).map((e) => ({ ...e, d: hints.get(e.key) ?? e.d }));
  const ev = event.peek(),
    parts: Parts = (name) => {
      const r = header?.relations[name],
        rel = ev?.relations[name],
        to = r && layerOf(r.to);
      return r && rel
        ? {
            to: r.to,
            offsets: rel.offsets,
            indices: rel.indices,
            name: to ? (to.kind ? to.group : to.label).toLowerCase() : undefined,
          }
        : undefined;
    };
  plan = planReplay(items, header?.replay, parts);
  // The parts drawn whole only for the replay shrink away at its end, rather than vanishing at the rebuild.
  for (const e of entries)
    if (replayOnly(e.d, e.key, highlight.peek(), /* replaying: set above */ true)) e.layer.setRetire(plan.linkEnd);
  engine.replay(plan.seconds, undefined, pace);
  if (import.meta.env.DEV) Object.assign(window, { emberPlan: plan }); // for the e2e tests
  return plan;
}

/** The tour: grow in the drawn layers of these tables over `seconds` (render/replay.ts growIn; times `pace` in real
 *  seconds), the others staying as they are. Nothing is rebuilt: the tour has drawn the layers it shows. */
export function growTables(tables: Set<string>, seconds: number, pace = 1) {
  if (!engine) return;
  engine.stopReplay(); // the previous step's objects in their final state
  plan = null; // no replay captions: the tour has its own
  const layers = entries.filter((e) => tables.has(e.d.table)).map((e) => e.layer);
  if (!layers.length) return;
  growIn(layers, seconds);
  engine.replay(seconds + 0.6, layers, pace); // + the last objects' growth (render/layers/: 0.5 s)
}

/** Create the engine on `canvas` and keep what it draws in step with the store. Returns the function that stops the
 *  effects. */
export function startScene(canvas: HTMLCanvasElement): () => void {
  const eng = (engine = new Engine(canvas));
  if (import.meta.env.DEV) Object.assign(window, { emberEngine: eng }); // for the e2e tests
  eng.onReplayTick = (t) => {
    // the caption changes text at most once per frame
    const c = t === null ? null : (plan?.caption(t) ?? null),
      cur = replayCaption.peek();
    if (c?.title !== cur?.title || c?.detail !== cur?.detail) replayCaption.value = c;
    if (t === null) replaying.value = false; // back to the visible layers only
  };
  let lastEvent: unknown = null;

  // Cuts hide objects (one uniform per layer) and, with `recolour`, reset the value scales to what passes them;
  // categorical colours do not depend on the cuts.
  const applyCuts = (recolour: boolean) => {
    const b = bundle.peek(),
      ev = event.peek(),
      c = cuts.peek(),
      counts: Record<string, number> = {};
    for (const e of entries) counts[e.key] = e.layer.setCut(cutMin(e.d, e.cut, c));
    shown.value = counts;
    if (recolour && b && ev)
      recolourInPlace(
        entries.filter((e) => !e.d.colourBy),
        ev,
        b.header,
        PALETTES[theme.peek()],
      );
    eng.requestRender();
  };
  // Rebuilds the layers whose rows depend on the focus: those drawn only for its objects (on every focus, as they are
  // small, and with `cutsOnly` on a cut, which hides some of their objects' parents), those going back to all their
  // rows ("only for the selection" unticked), and the filtered ones whose rescued focus rows changed.
  const rebuildForFocus = (cutsOnly: boolean) => {
    const hl = highlight.peek(),
      f = filters.peek(),
      pal = PALETTES[theme.peek()],
      b = bundle.peek(),
      all = replaying.peek();
    for (const e of entries) {
      const only = onlyFor(e.d, e.key, hl, all),
        focusRows = bypassing(e.d, f, hl),
        own = hl?.get(e.d.table),
        again = rescued(e.keep, focusRows, e.clustered, own);
      if (cutsOnly ? !only : !only && !e.limited && again === e.rescued) continue;
      const cut = cutValues(e.d, e.t, f[e.d.table], only, focusRows, e.clustered, own),
        ev = event.peek();
      if (e.uncoloured && b && ev && !nothingDrawn(cut)) {
        // its first rows: its colours now
        const [{ rgb, emphasis, legend }] = colourEntries([{ ...e, cut }], ev, b.header, cuts.peek(), pal, entries);
        Object.assign(e, { rgb, emphasis, uncoloured: false });
        legends.value = { ...legends.peek(), [e.key]: legend };
      }
      const next = builders[e.d.repr]({
        key: e.key,
        d: e.d,
        t: e.t,
        pal,
        rgb: e.rgb,
        emphasis: e.emphasis,
        behind: underHits(e.d),
        cut,
        field: b?.header.field,
        relation: relationOf(b?.header, event.peek()),
      });
      eng.replaceLayer(e.layer, next);
      dress(next, hl); // as drawn before
      next.setHighlightMix(1);
      e.layer = next;
      e.cut = cut;
      e.rescued = again;
      e.limited = !!only;
    }
    pinSelection();
  };
  // A slider sends many inputs per frame: the cut applies to each, the colour scales and the focus's layers are
  // redone once per frame.
  let recolourFrame = 0;
  const stopCuts = effect(() => {
    cuts.value;
    applyCuts(false);
    recolourFrame ||= requestAnimationFrame(() => {
      recolourFrame = 0;
      if (highlight.peek()) rebuildForFocus(true);
      applyCuts(true);
    });
  });
  // The smallest radius framed: that of the focus's domain (a vertex in the tracker), else of the domain looked at,
  // else the bundle's.
  const stopRadius = effect(() => {
    const h = bundle.value?.header,
      f = focus.value,
      at = (name?: string | null) => h?.domains?.find((d) => d.name === name)?.minRadius;
    eng.minRadius = at(f && layerOf(f.table)?.domain) ?? at(domain.value) ?? h?.view?.minRadius ?? MIN_RADIUS;
  });
  // The selected object is drawn whatever the cut (e.g. a track below the pT cut, picked in the inspector).
  const stopPin = effect(() => {
    selection.value;
    pinSelection();
    applyCuts(false);
  });

  // The layers to draw: the visible ones, those drawn for the focus's rows (store/selection.ts focusRows), and in a
  // replay every reconstruction stage.
  const wanted = (header: Header, ev: EventData) => {
    const vis = drawnLayers.peek(),
      forced = focusLayers.peek(),
      all = replaying.peek();
    const draw = (k: string, d: DisplayLayer) =>
      vis[k] || forced.has(k) || (all && d.stage !== undefined && inDomain(d));
    return header.display.filter((d) => draw(layerKey(d), d) && ev.tables[d.table]?.n);
  };
  // Builds the given layers, adding their legends to `drawn`; colour scales are shared with the layers in `pool`.
  const build = (
    layers: DisplayLayer[],
    header: Header,
    ev: EventData,
    drawn: Record<string, Legend>,
    pool: Entry[] = [],
  ): Entry[] => {
    const f = filters.peek(),
      hide = !showUnclustered.peek(),
      hl = highlight.peek(),
      pal = PALETTES[theme.peek()],
      all = replaying.peek();
    const items = layers.map((d0) => {
      const key = layerKey(d0),
        d = shownLayer(d0),
        t = ev.tables[d.table],
        keep = filterMask(t, f[d.table]),
        clustered = unclusteredHidden(t, hide),
        focusRows = bypassing(d, f, hl),
        own = hl?.get(d.table),
        only = onlyFor(d, key, hl, all);
      return {
        d,
        t,
        key,
        keep,
        clustered,
        rescued: rescued(keep, focusRows, clustered, own),
        cut: cutValues(d, t, f[d.table], only, focusRows, clustered, own),
        limited: !!only,
      };
    });
    // A layer with nothing drawn yet (truth particles before a selection: identity colours of 100k particles cost
    // ~20-50 ms per event) is coloured when it gets rows (rebuildForFocus); the truth colours always need its legend.
    const later = (s: (typeof items)[number]) => nothingDrawn(s.cut) && activeMode.peek() !== "truth";
    const now = items.filter((s) => !later(s)),
      done = colourEntries(now, ev, header, cuts.peek(), pal, [...pool, ...items]);
    const coloured = new Map(now.map((s, i) => [s, done[i]]));
    return items.map((s) => {
      const c = coloured.get(s),
        rgb = c?.rgb ?? new Float32Array(3 * s.t.n),
        emphasis = c?.emphasis;
      if (c) drawn[s.key] = c.legend;
      return {
        ...s,
        rgb,
        emphasis,
        uncoloured: !c,
        layer: builders[s.d.repr]({
          ...s,
          pal,
          rgb,
          emphasis,
          behind: underHits(s.d),
          field: header.field,
          relation: relationOf(header, ev),
        }),
      };
    });
  };

  let builtFor: EventData | null = null; // the event the layers were built for
  let outlinesFor: unknown[] = []; // the bundle and palette the detector outlines were drawn for
  let lastPair = pairKeyOf(pairView.peek()); // the pair whose colours the layers have
  let lastRank = ""; // the truth colours' slots the layers have (slotsKey)
  // What every layer was built with: a change rebuilds them all. Which layers are drawn is not in it: those changes
  // only build or free the layers concerned (stopForced).
  const settings = () => [
    bundle.peek(),
    event.peek(),
    theme.peek(),
    colourBy.peek(),
    activeMode.peek(),
    filters.peek(),
    showUnclustered.peek(),
    replaying.peek(),
    truthLevel.peek(),
  ];
  let builtWith: unknown[] = [];
  const stopLayers = effect(() => {
    const b = bundle.value,
      ev = event.value,
      pal = PALETTES[theme.value];
    colourBy.value;
    activeMode.value;
    filters.value;
    showUnclustered.value; // hides or shows the hits in no cluster, as a filter does
    truthLevel.value; // the truth particles drawn before a selection, and every truth colour
    replaying.value;
    builtWith = settings();
    if (!b || !ev) return;
    eng.setBackground(pal.background);
    if (outlinesFor[0] !== b || outlinesFor[1] !== pal) {
      eng.setOutlines(
        b.header.outlines ?? [],
        new Color().setStyle(pal.unassigned, LinearSRGBColorSpace),
        new Color().setHex(pal.background, LinearSRGBColorSpace),
      );
      outlinesFor = [b, pal];
    }
    const drawn: Record<string, Legend> = {};
    entries = build(wanted(b.header, ev), b.header, ev, drawn);
    withRootLegend(b.header, ev, drawn, pal);
    builtFor = ev;
    lastPair = pairKeyOf(pairView.peek());
    lastRank = slotsKey(b.header, ev, truthRank.peek());
    legends.value = drawn;
    eng.setLayers(entries.map((e) => e.layer));
    applyCuts(false);
    const raw = rawEvent.peek(); // not `ev`: adding a custom column makes a new event object for the same event
    if (raw !== lastEvent && !touring.peek()) eng.frame(); // the tour flies there itself
    lastEvent = raw;
    pinSelection();
    showFocus(0);
  });

  // Ticks, the domain and the focus change which layers are drawn: a domain hides the others' layers, and a focus
  // draws its rows of the layers the view leaves out (store/selection.ts focusRows). Only those are built or freed;
  // the others keep their buffers.
  const stopForced = effect(() => {
    focusLayers.value;
    drawnLayers.value;
    const b = bundle.peek(),
      ev = event.peek();
    // Something every layer depends on changed too (e.g. a domain with its own colour mode): stopLayers rebuilds them.
    if (!b || !ev || ev !== builtFor || settings().some((v, i) => v !== builtWith[i])) return;
    // A layer drawn for the focus's rows only that now draws all of them, or the reverse (a shared part's layer when
    // the overlay is turned on or off): rebuilt.
    const hl = highlight.peek();
    if (entries.some((e) => e.limited !== !!onlyFor(e.d, e.key, hl, replaying.peek()))) rebuildForFocus(false);
    const keep = new Set(wanted(b.header, ev).map(layerKey)),
      have = new Set(entries.map((e) => e.key));
    const gone = entries.filter((e) => !keep.has(e.key)),
      added = b.header.display.filter((d) => keep.has(layerKey(d)) && !have.has(layerKey(d)));
    if (!gone.length && !added.length) return;
    const drawn = { ...legends.peek() };
    for (const e of gone) {
      eng.removeLayer(e.layer);
      delete drawn[e.key];
    }
    entries = entries.filter((e) => keep.has(e.key));
    const fresh = build(added, b.header, ev, drawn, entries),
      truth = truthOutline();
    for (const { layer } of fresh) {
      eng.addLayer(layer);
      dress(layer, hl, truth);
      layer.setHighlightMix(1);
    }
    entries = [...entries, ...fresh];
    pinSelection();
    withRootLegend(b.header, ev, drawn, PALETTES[theme.peek()]); // the root's layer may be among those just unticked
    legends.value = drawn;
    applyCuts(false);
  });

  // A new focus: the layers drawn only for its objects are rebuilt (they are small), and so are the filtered layers
  // whose rescued focus rows changed; the others keep their buffers. Then every layer fades to the new highlight.
  const stopFocus = effect(() => {
    const b = bundle.peek(),
      ev = event.peek();
    highlight.value;
    showAll.value;
    pairView.value;
    focusRowsKey.value; // the selected object moving within an unticked layer, or such a layer ticked or unticked
    // A new truth <-> reco pair (or none any more): every layer is recoloured in place.
    const key = pairKeyOf(pairView.peek()),
      changed = key !== lastPair;
    lastPair = key;
    if (changed && b && ev && ev === builtFor) {
      const list = entries.filter((e) => !e.d.context);
      recolourInPlace(list, ev, b.header, PALETTES[theme.peek()]);
      for (const e of list) e.uncoloured = false;
    }
    rebuildForFocus(false);
    applyCuts(false);
    showFocus(touring.peek() ? 900 : 250);
  });
  // The truth colours' slots follow the domain and the selection (store truthRank): when they change, every layer is
  // recoloured in place, as for a new pair.
  const stopRank = effect(() => {
    const rank = truthRank.value,
      b = bundle.peek(),
      ev = event.peek();
    if (!b || !ev || ev !== builtFor) return;
    const key = slotsKey(b.header, ev, rank);
    if (key === lastRank) return; // e.g. a new selection whose particles hold no other slots
    lastRank = key;
    recolourInPlace(
      entries.filter((e) => !e.d.context && !e.uncoloured),
      ev,
      b.header,
      PALETTES[theme.peek()],
    );
    eng.requestRender();
  });
  // A level shown inside the focus turns the focus into an outline around it.
  const stopEnvelope = effect(() => {
    shownLevel.value;
    domain.value;
    const truth = truthOutline();
    for (const { layer } of entries) outline(layer, truth);
    eng.requestRender();
  });
  const stopView = effect(() => eng.setView(view.value, highlight.peek() ?? undefined));
  // How the rest of the event is drawn around a selection: one uniform shared by every layer.
  const stopRest = effect(() => {
    restUniform.value = REST_FADE[rest.value];
    eng.requestRender();
  });
  return () => {
    cancelAnimationFrame(recolourFrame);
    stopRadius();
    stopPin();
    stopLayers();
    stopForced();
    stopCuts();
    stopFocus();
    stopEnvelope();
    stopRank();
    stopView();
    stopRest();
  };
}

/** Recolour these entries in place (a buffer upload each, no rebuild), with their legends. */
function recolourInPlace(list: Entry[], ev: EventData, header: Header, pal: Pal) {
  const drawn = { ...legends.peek() };
  colourEntries(list, ev, header, cuts.peek(), pal).forEach(({ rgb, legend }, i) => {
    list[i].layer.setColours(rgb);
    list[i].rgb = rgb;
    drawn[list[i].key] = legend;
  });
  legends.value = drawn;
}

/** Pin the selected object in its layer (drawn whatever the cut); unpin elsewhere. */
function pinSelection() {
  const sel = selection.peek();
  for (const { layer } of entries) layer.setPinned(sel?.table === layer.table ? sel.row : -1);
  engine?.requestRender();
}

/** Highlight the focus and what belongs to it on every layer, faded in over `ms` (0: at once, e.g. for freshly built
 *  layers). */
function showFocus(ms: number) {
  const hl = highlight.peek(),
    truth = truthOutline();
  for (const { layer } of entries) dress(layer, hl, truth);
  engine?.setFocused(!!hl);
  if (ms > 0) engine?.fadeHighlight(ms);
  else for (const { layer } of entries) layer.setHighlightMix(1);
  engine?.requestRender();
}
