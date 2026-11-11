// The 3D view. Layers are rebuilt when the event, visibility, theme, colour choices or filters change; a cut only
// sets a uniform per layer, and the focus a byte per object (plus a rebuild of the small onSelection layers, and
// building or freeing the hidden layers it has objects in).
// Hover shows a tooltip, click selects, double-click zooms to the selection.
import { effect, signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { type DisplayLayer, type EventData, type Header, type Table, unitOf } from "../io/bundle";
import { colourBy, filters } from "../model/custom";
import { cutMin, cutValues } from "../model/cuts";
import { colours, type LayerFor, type Legend, PALETTES, valueRange, type Pal, type Range } from "../render/colour";
import { Engine, MIN_RADIUS } from "../render/engine";
import { builders, type ColourStage, type Layer } from "../render/layers";
import { planReplay, type Plan } from "../render/replay";
import { back, jump } from "./navigate";
import {
  activeMode, bundle, colourFirst, cuts, describe, event, focus, focusHistory, focusIsTruth, focusLayers, focusLinked, following, highlight, hover,
  inFocus, isHitLayer, kindOf, labelOf, layerKey, layerOf, legends, rawEvent, replayCaption, selection, short, showAll, shown, shownLayer,
  theme, touring, view, visible,
} from "../model/store";
import { relationInto, type Ref } from "../model/relations";
import { stopTour } from "./tour";

export let engine: Engine | null = null;

interface Entry { d: DisplayLayer; t: Table; key: string; cut?: Float32Array; rgb: Float32Array; emphasis?: Uint8Array; layer: Layer }
let entries: Entry[] = []; // what is drawn now

let plan: Plan | null = null;
// While a replay runs, the layers of every reconstruction stage are drawn (the earlier ones start hidden), so the
// replay can walk through them; afterwards only the visible layers are rebuilt.
const replaying = signal(false);

/** Replay how the shown event built up (see render/replay.ts); returns the plan, with its phase times. */
export function replayEvent(): Plan | null {
  if (!engine) return null;
  engine.stopReplay(); // a running replay ends first (its end resets `replaying`), so the rebuild below sticks
  replaying.value = true; // rebuilds the layers at once (an effect), including the hidden stages
  if (!entries.length) return null;
  hover.value = null;
  plan = planReplay(entries.filter((e) => !e.d.context), bundle.peek()?.header.replay); // background stays as it is
  stageColours(plan);
  engine.replay(plan.seconds);
  return plan;
}

/** Grouped layers (e.g. layer clusters) take the colours of each stage in turn: the objects of that stage that
 *  contain them, through a relation from the stage's table, if there is one. Not in the truth and reco colour
 *  modes: there a colour stays one object's for the whole replay. */
function stageColours(p: Plan) {
  const b = bundle.peek(), ev = event.peek(), pal = PALETTES[theme.peek()];
  if (!b || !ev || activeMode.peek() !== "layers") return;
  for (const e of entries) {
    if (!(typeof e.d.colourBy === "object" && "relation" in e.d.colourBy) || !e.layer.setColourStages) continue;
    const keys: ColourStage[] = [];
    for (const st of p.stages) {
      const rel = relationInto(b.header, st.tables, e.d.table, ev);
      if (!rel) continue;
      const c = colours({ ...e.d, colourBy: { relation: rel } }, e.t, ev, b.header, pal);
      keys.push({ t: st.start, rgb: c.rgb, emphasis: c.emphasis });
    }
    e.layer.setColourStages(keys);
  }
}

export function Viewport() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const eng = (engine = new Engine(canvas.current!));
    if (import.meta.env.DEV) Object.assign(window, { evdEngine: eng }); // for the e2e tests
    eng.onInteract = stopTour;
    eng.onReplayTick = (t) => { // the caption changes text at most once per frame
      const c = t === null ? null : plan?.caption(t) ?? null, cur = replayCaption.peek();
      if (c?.title !== cur?.title || c?.detail !== cur?.detail) replayCaption.value = c;
      if (t === null) replaying.value = false; // back to the visible layers only
    };
    let lastEvent: unknown = null;

    // Cuts hide objects (one uniform per layer) and reset the value scales to what passes them; categorical colours
    // do not depend on the cuts.
    const applyCuts = (recolour: boolean) => {
      const b = bundle.peek(), ev = event.peek(), c = cuts.peek(), counts: Record<string, number> = {};
      for (const e of entries) counts[e.key] = e.layer.setCut(cutMin(e.d, e.cut, c));
      shown.value = counts;
      if (recolour && b && ev) {
        const ramps = entries.filter((e) => !e.d.colourBy), drawn = { ...legends.peek() };
        colourEntries(ramps, ev, b.header, c, PALETTES[theme.peek()]).forEach(({ rgb, legend }, i) => {
          ramps[i].layer.setColours(rgb);
          ramps[i].rgb = rgb;
          drawn[ramps[i].key] = legend;
        });
        legends.value = drawn;
      }
      eng.requestRender();
    };
    // A slider sends many inputs per frame: the cut applies to each, the colour scales are redone once per frame.
    let recolourFrame = 0;
    const stopCuts = effect(() => {
      cuts.value;
      applyCuts(false);
      recolourFrame ||= requestAnimationFrame(() => { recolourFrame = 0; applyCuts(true); });
    });

    // The layers to draw: the visible ones, the hidden ones the focus has objects in, and in a replay every
    // reconstruction stage.
    const wanted = (header: Header, ev: EventData) => {
      const vis = visible.peek(), forced = focusLayers.peek(), all = replaying.peek();
      return header.display.filter((d) => (vis[layerKey(d)] || forced.has(layerKey(d)) || (all && d.stage !== undefined)) && ev.tables[d.table]?.n);
    };
    // Builds the given layers, adding their legends to `drawn`; colour scales are shared with the layers in `pool`.
    const build = (layers: DisplayLayer[], header: Header, ev: EventData, drawn: Record<string, Legend>, pool: Entry[] = []): Entry[] => {
      const f = filters.peek(), hl = highlight.peek(), pal = PALETTES[theme.peek()];
      const items = layers.map((d0) => {
        const key = layerKey(d0), d = shownLayer(d0), t = ev.tables[d.table];
        return { d, t, key, cut: cutValues(d, t, f[d.table], onlyFor(d, key, hl)) };
      });
      const coloured = colourEntries(items, ev, header, cuts.peek(), pal, [...pool, ...items]);
      return items.map((s, i) => {
        const { rgb, emphasis, legend } = coloured[i];
        drawn[s.key] = legend;
        return { ...s, rgb, emphasis, layer: builders[s.d.repr]({ ...s, pal, rgb, emphasis }) };
      });
    };

    let builtFor: EventData | null = null; // the event the layers were built for
    let lastFirst = colourFirst.peek(); // the selection's colours the layers have (recoloured when it changes)
    const stopLayers = effect(() => {
      const b = bundle.value, ev = event.value, pal = PALETTES[theme.value];
      visible.value; colourBy.value; activeMode.value; filters.value; replaying.value; // any change rebuilds every layer
      if (!b || !ev) return;
      eng.setBackground(pal.background);
      eng.minRadius = b.header.view?.minRadius ?? MIN_RADIUS;
      const drawn: Record<string, Legend> = {};
      entries = build(wanted(b.header, ev), b.header, ev, drawn);
      builtFor = ev;
      lastFirst = colourFirst.peek(); // built with these
      legends.value = drawn;
      eng.setLayers(entries.map((e) => e.layer));
      applyCuts(false);
      const raw = rawEvent.peek(); // not `ev`: adding a custom column makes a new event object for the same event
      if (raw !== lastEvent && !touring.peek() && !following.peek()) eng.frame(); // tour and Live fly there themselves
      lastEvent = raw;
      showFocus(0);
    });

    // A focus draws the hidden layers it has objects in (e.g. a candidate's tracksters): only those are built, or
    // freed when it ends; the other layers keep their buffers.
    const stopForced = effect(() => {
      focusLayers.value;
      const b = bundle.peek(), ev = event.peek();
      if (!b || !ev || ev !== builtFor) return; // a new event: stopLayers builds everything
      const keep = new Set(wanted(b.header, ev).map(layerKey)), have = new Set(entries.map((e) => e.key));
      const gone = entries.filter((e) => !keep.has(e.key)), added = b.header.display.filter((d) => keep.has(layerKey(d)) && !have.has(layerKey(d)));
      if (!gone.length && !added.length) return;
      const drawn = { ...legends.peek() };
      for (const e of gone) { eng.removeLayer(e.layer); delete drawn[e.key]; }
      entries = entries.filter((e) => keep.has(e.key));
      const fresh = build(added, b.header, ev, drawn, entries), hl = highlight.peek(), outline = focusIsTruth.peek();
      for (const { layer } of fresh) {
        eng.addLayer(layer);
        layer.setHighlight(hl ? hl.get(layer.table) ?? new Set() : null);
        layer.setOutline?.(outline);
        layer.setHighlightMix(1);
      }
      entries = [...entries, ...fresh];
      legends.value = drawn;
      applyCuts(false);
    });

    // A new focus: the layers that show only its objects (e.g. truth particles, candidate tracks) are rebuilt, which is
    // cheap as they are small (the big layers keep their buffers); then every layer fades to the new highlight.
    const stopFocus = effect(() => {
      const hl = highlight.value, f = filters.peek(), pal = PALETTES[theme.peek()], b = bundle.peek(), ev = event.peek();
      showAll.value; colourFirst.value;
      // In the truth and reco modes the focus's own particles or candidate take the first colours: the categorical
      // layers are recoloured in place (a buffer upload each, no rebuild).
      const first = colourFirst.peek(), changed = first !== lastFirst;
      lastFirst = first;
      if (changed && activeMode.peek() !== "layers" && b && ev && ev === builtFor) {
        const recolour = entries.filter((e) => e.d.colourBy), drawn = { ...legends.peek() };
        colourEntries(recolour, ev, b.header, cuts.peek(), pal).forEach(({ rgb, legend }, i) => {
          recolour[i].layer.setColours(rgb);
          recolour[i].rgb = rgb;
          drawn[recolour[i].key] = legend;
        });
        legends.value = drawn;
      }
      for (const e of entries) {
        if (!e.d.onSelection) continue;
        const cut = cutValues(e.d, e.t, f[e.d.table], onlyFor(e.d, e.key, hl));
        const next = builders[e.d.repr]({ key: e.key, d: e.d, t: e.t, pal, rgb: e.rgb, emphasis: e.emphasis, cut });
        eng.replaceLayer(e.layer, next);
        e.layer = next;
        e.cut = cut;
      }
      applyCuts(false);
      showFocus(touring.peek() ? 900 : 250);
    });
    const stopView = effect(() => eng.setView(view.value, highlight.peek() ?? undefined));
    // The inspector covers the right of the view while something is selected: framing leaves that part free.
    const stopInset = effect(() => {
      selection.value;
      const panel = document.querySelector(".inspector") as HTMLElement | null, box = canvas.current!.getBoundingClientRect();
      eng.insetRight = selection.peek() ? Math.max(0, box.right - (panel?.getBoundingClientRect().left ?? box.right - 372)) : 0;
    });
    return () => { cancelAnimationFrame(recolourFrame); stopLayers(); stopForced(); stopCuts(); stopFocus(); stopView(); stopInset(); };
  }, []);

  // A press that moves more than a few pixels is a rotate/pan, not a click: it must not change the selection.
  let pending = 0, down: { x: number; y: number } | null = null, dragged = false;
  const setCursor = (c: string) => { if (canvas.current) canvas.current.style.cursor = c; };
  const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; dragged = false; hover.value = null; };
  const onUp = () => { down = null; setCursor(hover.value ? "pointer" : "grab"); };
  const onMove = (e: PointerEvent) => {
    if (down) {
      if (!dragged && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { dragged = true; setCursor("grabbing"); }
      return;
    }
    if (pending || engine?.replaying) return; // objects of a replay are not all drawn yet
    pending = requestAnimationFrame(() => {
      pending = 0;
      const hits = engine?.pickAll(e.clientX, e.clientY, inFocus) ?? [];
      const r = canvas.current!.getBoundingClientRect();
      hover.value = hits.length ? { ...hits[0], x: e.clientX - r.left, y: e.clientY - r.top, stacked: hits.length } : null;
      setCursor(hits.length ? "pointer" : "grab");
    });
  };
  // Several objects can be stacked under the cursor (a candidate, its tracksters, a hit, a truth line): clicking
  // again on the same spot selects the next one. A click on nothing ends the focus (and the selection).
  let lastClick: { x: number; y: number } | null = null;
  const onClick = (e: MouseEvent) => {
    if (e.detail > 1 || dragged) return;
    const hits = engine?.pickAll(e.clientX, e.clientY, inFocus) ?? [];
    const again = lastClick && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 6, cur = selection.value;
    lastClick = { x: e.clientX, y: e.clientY };
    const at = again && cur ? hits.findIndex((h) => h.table === cur.table && h.row === cur.row) : -1;
    const hit = hits[(at + 1) % Math.max(hits.length, 1)];
    // An object linked to the focus (its truth particle; a truth particle's reco objects), other than single hits:
    // the focus moves there, keeping the way back.
    if (hit && !isHitLayer(layerOf(hit.table)) && focusLinked.peek()?.get(hit.table)?.has(hit.row)) return jump({ table: hit.table, row: hit.row });
    selection.value = hit ? { table: hit.table, row: hit.row } : null;
  };
  const onDoubleClick = (e: MouseEvent) => {
    if (dragged) return;
    // The first click already selected (and focused) the object: zoom to it, conservatively.
    if (!selection.value) {
      const hit = engine?.pick(e.clientX, e.clientY, inFocus);
      if (!hit) return;
      selection.value = { table: hit.table, row: hit.row };
    }
    engine?.frame(highlight.value ?? undefined, true, 700);
  };

  return (
    <div class="viewport">
      <canvas ref={canvas} onPointerDown={onDown} onPointerUp={onUp} onPointerMove={onMove} onPointerLeave={() => (hover.value = null)} onClick={onClick} onDblClick={onDoubleClick} />
      <Tooltip />
      <FocusBar />
      <ReplayCaption />
      <div class="hintbar">Drag to rotate · right-drag to pan · scroll to zoom · click to inspect · double-click to zoom in · <kbd>?</kbd> help</div>
    </div>
  );
}

/** What the view is focused on, the way back, and how to leave. */
function FocusBar() {
  const f = focus.value, prev = focusHistory.value.at(-1);
  if (!f) return null;
  const name = (r: Ref) => {
    const n = describe(r.table, r.row);
    return `${kindOf(r.table)}${n ? ` · ${n}` : ` #${r.row}`}`;
  };
  return (
    <div class="focusbar" role="status" title="All its parts are shown, and only they can be clicked">
      {prev && <button class="link" onClick={back} title={`Back to ${name(prev)}`}>← {name(prev)}</button>}
      <span class="muted">Focus</span> <b>{name(f)}</b>
      <button class="link" onClick={() => (selection.value = null)}>leave (Esc)</button>
    </div>
  );
}

function ReplayCaption() {
  const c = replayCaption.value;
  return c ? <div class="caption" aria-live="polite"><b>{c.title}</b>{c.detail && <small>{c.detail}</small>}</div> : null;
}

function Tooltip() {
  const h = hover.value, ev = event.value, b = bundle.value;
  if (!h || !ev || !b || !ev.tables[h.table]) return null;
  const d0 = layerOf(h.table), d = d0 && shownLayer(d0, activeMode.value, colourBy.value);
  const t = ev.tables[h.table], name = describe(h.table, h.row);
  const value = d?.colour && t.columns[d.colour] ? Number(t.columns[d.colour][h.row]) : null;
  return (
    <div class="tooltip" style={{ left: h.x + 14, top: h.y + 14 }}>
      <b>{labelOf(h.table)}</b> #{h.row}{name && ` · ${name}`}
      {h.stacked > 1 && <div class="muted">{h.stacked} objects here · click again for the next</div>}
      {value !== null && <div>{d!.colour}: {short(value)} {unitOf(b.header.tables[h.table].columns[d!.colour!]?.doc)}</div>}
    </div>
  );
}

/** For a layer that shows only the focus's objects: the rows to keep (none without a focus); else undefined. */
const onlyFor = (d: DisplayLayer, key: string, hl: Map<string, Set<number>> | null) =>
  !d.onSelection || showAll.peek()[key] ? undefined : hl?.get(d.table) ?? new Set<number>();

type Item = Pick<Entry, "d" | "t" | "key" | "cut">;
/** Each table's colouring as drawn: the colour mode's, then the user's (or the preset's) choice for its layer. */
const chosenColours = (header: Header): LayerFor => (table) => {
  const d = header.display.find((l) => l.table === table);
  return d && shownLayer(d);
};
/** Colours for the given layers, mixed towards the background by their `dim`. Layers that share a cut group and
 *  colour column (e.g. SoA and legacy rechit energies) share one colour scale, computed from the objects of the
 *  layers in `pool` that pass the cuts and filters, so equal values get equal colours in every layer. */
function colourEntries(items: Item[], ev: EventData, header: Header, c: Record<string, number>, pal: Pal, pool: Item[] = items) {
  const scale = (e: Pick<Entry, "d" | "key">) => `${e.d.cut?.group ?? e.key}|${e.d.colour}`;
  const pools = new Map<string, number[]>();
  for (const e of pool) {
    const { d, t, cut } = e, col = d.colour ? t.columns[d.colour] : undefined;
    if (!col || d.colourBy) continue; // categorical layers keep their own colours
    const min = cutMin(d, cut, c), step = Math.max(1, Math.floor(t.n / 20000)); // a sample is enough for the range
    const pool = pools.get(scale(e)) ?? [];
    for (let i = 0; i < t.n; i += step) if (!cut || cut[i] >= min) pool.push(Number(col[i]));
    pools.set(scale(e), pool);
  }
  const ranges = new Map<string, Range>([...pools].map(([k, pool]) => [k, valueRange(pool)]));
  const layerFor = chosenColours(header);
  const bg = [(pal.background >> 16) & 255, (pal.background >> 8) & 255, pal.background & 255].map((v) => v / 255);
  return items.map((e) => {
    const out = colours(e.d, e.t, ev, header, pal, { range: ranges.get(scale(e)), layerFor, first: colourFirst.peek() }), dim = e.d.dim;
    if (dim) for (let i = 0; i < out.rgb.length; i++) out.rgb[i] += (bg[i % 3] - out.rgb[i]) * dim;
    return out;
  });
}

/** Highlight the focus and what belongs to it on every layer (outlines for reco objects when the focus is a
 *  truth particle), faded in over `ms` (0: at once, e.g. for freshly built layers). */
function showFocus(ms: number) {
  const hl = highlight.peek(), outline = focusIsTruth.peek();
  for (const { layer } of entries) {
    layer.setHighlight(hl ? hl.get(layer.table) ?? new Set() : null);
    layer.setOutline?.(outline);
  }
  if (ms > 0) engine?.fadeHighlight(ms);
  else for (const { layer } of entries) layer.setHighlightMix(1);
  engine?.requestRender();
}
