// The 3D view: layers follow the event and visibility, cuts and selection only update uniforms/masks.
// Hover shows a tooltip, click selects, double-click flies to the object and everything related to it.
import { effect, signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { DisplayLayer, EventData, Header, Table } from "../io/bundle";
import { colourBy, filters, evaluate, withColour } from "../model/custom";
import { colours, PALETTES, toF32, valueRange, type Legend, type Pal, type Range } from "../render/colour";
import { Engine } from "../render/engine";
import { builders, type ColourStage, type Layer } from "../render/layers";
import { planReplay, type Plan } from "../render/replay";
import { jump, back } from "./navigate";
import { bundle, cuts, describe, event, focus, focusHistory, focusLayers, focusLinked, following, inFocus, highlight, hover, labelOf, layerKey, legends, rawEvent, replayCaption, selection, showAll, shown, theme, touring, view, visible } from "../model/store";
import { stopTour } from "./tour";

export let engine: Engine | null = null;
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
  // Background layers stay as they are through the replay.
  plan = planReplay(entries.filter((e) => !e.d.context).map((e) => ({ layer: e.layer!, d: e.d, t: e.t, emphasis: e.emphasis })), bundle.peek()?.header.replay);
  stageColours(plan);
  engine.replay(plan.seconds);
  return plan;
}

/** Grouped layers (e.g. layer clusters) take the colours of each stage in turn: the objects of that stage that
 *  contain them, through a relation from the stage's table, if there is one. */
function stageColours(p: Plan) {
  const b = bundle.peek(), ev = event.peek(), pal = PALETTES[theme.peek()];
  if (!b || !ev) return;
  for (const e of entries) {
    if (!(typeof e.d.colourBy === "object" && "relation" in e.d.colourBy) || !e.layer?.setColourStages) continue;
    const keys: ColourStage[] = [];
    for (const st of p.stages) {
      const rel = Object.entries(b.header.relations).find(([n, r]) => st.tables.includes(r.from) && r.to === e.d.table && ev.relations[n])?.[0];
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
    engine = new Engine(canvas.current!);
    if (import.meta.env.DEV) Object.assign(window, { evdEngine: engine }); // for the e2e tests
    engine.onInteract = stopTour;
    engine.onReplayTick = (t) => { // the caption changes text at most once per frame
      const c = t === null ? null : plan?.caption(t) ?? null, cur = replayCaption.peek();
      if (c?.title !== cur?.title || c?.detail !== cur?.detail) replayCaption.value = c;
      if (t === null) replaying.value = false; // back to the visible layers only
    };
    let lastEvent: unknown = null;

    // Cuts hide objects (one uniform per layer) and reset the shared colour scales to what passes them.
    const applyCuts = (recolour: boolean) => {
      const b = bundle.peek(), ev = event.peek(), c = cuts.peek(), counts: Record<string, number> = {};
      for (const e of entries) counts[e.layer!.key] = e.layer!.setCut(cutMin(e, c));
      shown.value = counts;
      if (recolour && b && ev) { // only value scales depend on the cuts; categorical colours stay
        const ramps = entries.filter((e) => !e.d.colourBy), drawn: Record<string, Legend> = {}, pal = PALETTES[theme.peek()];
        colourEntries(ramps, ev, b.header, c, pal).forEach(({ rgb, legend }, i) => { ramps[i].layer!.setColours(dimmed(rgb, ramps[i].d.dim, pal)); drawn[ramps[i].key] = legend; });
        legends.value = { ...legends.peek(), ...drawn };
      }
      engine?.requestRender();
    };
    // A slider sends many inputs per frame: the cut applies to each, the colour scales are redone once per frame.
    let recolourFrame = 0;
    const onCutChange = () => {
      applyCuts(false);
      recolourFrame ||= requestAnimationFrame(() => { recolourFrame = 0; applyCuts(true); });
    };
    // Rebuilt when the event, visibility, theme, colour choices or filters change (cuts only update uniforms).
    const stopLayers = effect(() => {
      const b = bundle.value, ev = event.value, vis = visible.value, pal = PALETTES[theme.value], by = colourBy.value, f = filters.value;
      const all = replaying.value, forced = new Set(focusLayers.value.split("|")); // the focus's hidden levels
      if (!b || !ev) return;
      engine!.setBackground(pal.background);
      engine!.minRadius = b.header.view?.minRadius ?? 70;
      entries = b.header.display
        .filter((d) => (vis[layerKey(d)] || forced.has(layerKey(d)) || (all && d.stage !== undefined)) && ev.tables[d.table]?.n)
        .map((d0) => {
          const key = layerKey(d0), d = withColour(d0, by[key]), t = ev.tables[d.table];
          const e: Entry = { d, t, key };
          e.cutValues = cutValues(d, t, f[d.table], onlyFor(e, highlight.peek()));
          return e;
        });
      const drawn: Record<string, Legend> = {};
      colourEntries(entries, ev, b.header, cuts.peek(), pal).forEach(({ rgb, legend, emphasis }, i) => {
        dimmed(rgb, entries[i].d.dim, pal);
        const e = entries[i];
        drawn[e.key] = legend;
        e.emphasis = emphasis;
        e.rgb = rgb;
        e.layer = builders[e.d.repr]({ key: e.key, d: e.d, t: e.t, pal, rgb, emphasis, cut: e.cutValues });
      });
      legends.value = drawn;
      engine!.setLayers(entries.map((e) => e.layer!));
      applyCuts(false);
      const raw = rawEvent.peek(); // not `ev`: adding a custom column makes a new event object for the same event
      if (raw !== lastEvent && !touring.peek() && !following.peek()) engine!.frame(); // tour and Live fly there themselves
      lastEvent = raw;
      applyHighlight(entries.map((e) => e.layer!), highlight.peek(), 0);
    });
    const stopCuts = effect(() => { cuts.value; onCutChange(); });
    // Layers that show only the selection's objects (e.g. MC truth, candidate tracks) are rebuilt when it changes:
    // they are small, so this is cheap, and the big layers keep their buffers.
    const stopSelectionLayers = effect(() => {
      const hl = highlight.value, all = showAll.value, pal = PALETTES[theme.peek()], f = filters.peek();
      for (const e of entries) {
        if (!e.d.onSelection || !e.layer || !e.rgb) continue;
        const cutVals = cutValues(e.d, e.t, f[e.d.table], all[e.key] ? undefined : onlyFor(e, hl));
        const next = builders[e.d.repr]({ key: e.key, d: e.d, t: e.t, pal, rgb: e.rgb, emphasis: e.emphasis, cut: cutVals });
        engine!.replaceLayer(e.layer, next);
        e.layer = next;
        const fo = focus.peek();
        next.setOutline?.(!!fo && !!bundle.peek()?.header.display.find((l) => l.table === fo.table)?.truth);
        e.cutValues = cutVals;
      }
      applyCuts(false);
    });
    const stopHighlight = effect(() => {
      applyHighlight(entries.map((e) => e.layer!), highlight.value, touring.peek() ? 900 : 250);
      // Focused on a truth particle: the reco objects matched to it are drawn as outlines around its hits and lines.
      const f = focus.value, truthFocus = !!f && !!bundle.peek()?.header.display.find((l) => l.table === f.table)?.truth;
      for (const e of entries) e.layer?.setOutline?.(truthFocus);
    });
    const stopView = effect(() => engine!.setView(view.value, highlight.peek() ?? undefined));
    // The inspector covers the right of the view while something is selected: framing leaves that part free.
    const stopInset = effect(() => {
      selection.value;
      const panel = document.querySelector(".inspector") as HTMLElement | null, view = canvas.current!.getBoundingClientRect();
      engine!.insetRight = selection.peek() ? Math.max(0, view.right - (panel?.getBoundingClientRect().left ?? view.right - 372)) : 0;
    });
    return () => { cancelAnimationFrame(recolourFrame); stopLayers(); stopCuts(); stopSelectionLayers(); stopHighlight(); stopView(); stopInset(); };
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
  // Several objects can be stacked under the cursor (a candidate, its interpretation and tracksters, a hit, a truth
  // line): clicking again on the same spot selects the next one. Inside a focus only its parts can be picked; a click
  // on nothing ends the focus (and the selection).
  let lastClick: { x: number; y: number } | null = null;
  const onClick = (e: MouseEvent) => {
    if (e.detail > 1 || dragged) return;
    const hits = engine?.pickAll(e.clientX, e.clientY, inFocus) ?? [];
    const again = lastClick && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 6, cur = selection.value;
    lastClick = { x: e.clientX, y: e.clientY };
    const at = again && cur ? hits.findIndex((h) => h.table === cur.table && h.row === cur.row) : -1;
    const hit = hits[(at + 1) % Math.max(hits.length, 1)];
    // An object linked to the focus (its truth particle; a truth particle's reco objects), other than single hits:
    // jump there, keeping the way back.
    const repr = hit && bundle.peek()?.header.display.find((l) => l.table === hit.table)?.repr;
    if (hit && repr !== "cells" && focusLinked.peek()?.get(hit.table)?.has(hit.row)) return jump({ table: hit.table, row: hit.row });
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

/** What the view is focused on, and how to leave. */
function FocusBar() {
  const f = focus.value;
  if (!f) return null;
  const name = describe(f.table, f.row), h = focusHistory.value, prev = h[h.length - 1];
  const title = (r: { table: string; row: number }) => {
    const g = bundle.value?.header.display.find((l) => l.table === r.table)?.group ?? r.table, n = describe(r.table, r.row);
    return n ? `${g} · ${n}` : `${g} #${r.row}`;
  };
  return (
    <div class="focusbar" role="status" title="All its parts are shown, and only they can be clicked">
      {prev && <button class="link" onClick={back} title={`Back to ${title(prev)}`}>← {title(prev)}</button>}
      <span class="muted">Focus</span> <b>{bundle.value?.header.display.find((l) => l.table === f.table)?.group ?? f.table}{name ? ` · ${name}` : ` #${f.row}`}</b>
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
  const d0 = b.header.display.find((l) => l.table === h.table);
  const d = d0 && withColour(d0, colourBy.value[layerKey(d0)]);
  const t = ev.tables[h.table];
  const value = d?.colour && t.columns[d.colour] ? Number(t.columns[d.colour][h.row]) : null;
  const unit = d?.colour ? b.header.tables[h.table].columns[d.colour]?.doc.match(/\[([^\]]+)\]/)?.[1] ?? "" : "";
  return (
    <div class="tooltip" style={{ left: h.x + 14, top: h.y + 14 }}>
      <b>{labelOf(h.table)}</b> #{h.row}{describe(h.table, h.row) && ` · ${describe(h.table, h.row)}`}
      {h.stacked > 1 && <div class="muted">{h.stacked} objects here · click again for the next</div>}
      {value !== null && <div>{d!.colour}: {value.toPrecision(3)} {unit}</div>}
    </div>
  );
}

interface Entry { d: DisplayLayer; t: Table; key: string; cutValues?: Float32Array; emphasis?: Uint8Array; rgb?: Float32Array; layer?: Layer }

/** For a layer that shows only the selection's objects: the rows to keep (empty without a selection); else undefined. */
function onlyFor(e: Entry, hl: Map<string, Set<number>> | null): Set<number> | undefined {
  if (!e.d.onSelection || showAll.peek()[e.key]) return undefined;
  return hl?.get(e.d.table) ?? new Set();
}

// A filtered-out row gets a cut value below any threshold, so it is hidden by the same comparison as the cut
// (in the shader and in passes()). Layers with a filter but no cut use a threshold just above it.
const HIDDEN = -3e38, NO_CUT = -1e30;

/** Colours mixed towards the background by `dim` (0..1), in place: for background layers. */
function dimmed(rgb: Float32Array, dim: number | undefined, pal: Pal) {
  if (!dim) return rgb;
  const bg = [(pal.background >> 16) & 255, (pal.background >> 8) & 255, pal.background & 255].map((v) => v / 255);
  for (let i = 0; i < rgb.length; i++) rgb[i] += (bg[i % 3] - rgb[i]) * dim;
  return rgb;
}

// Objects drawn because they relate to the selection pass every cut: what you clicked is linked to them.
const SHOWN = 3e38;

export function cutValues(d: DisplayLayer, t: Table, filter?: string, only?: Set<number>): Float32Array | undefined {
  if (only) {
    const out = new Float32Array(t.n).fill(HIDDEN);
    for (const i of only) out[i] = SHOWN;
    return out;
  }
  const base = d.cut && t.columns[d.cut.column] ? toF32(t.columns[d.cut.column], t.n) : undefined;
  const r = filter ? evaluate(t, filter) : null, keep = r && !("error" in r) ? r.values : null;
  if (!keep && !only) return base;
  const out = base ? Float32Array.from(base) : new Float32Array(t.n); // a copy: `base` may be the event's own column
  for (let i = 0; i < t.n; i++) if (keep && !keep[i]) out[i] = HIDDEN;
  return out;
}

export const cutMin = (e: Pick<Entry, "d" | "cutValues">, c: Record<string, number>) => (e.d.cut ? c[e.d.cut.group] ?? 0 : e.cutValues ? NO_CUT : -Infinity);

/** Colours for all drawn layers. Layers that share a cut group and colour column (e.g. SoA and legacy rechit
 *  energies) share one colour scale, computed from the objects that pass the cuts and filters, so equal values get
 *  equal colours in every layer. */
function colourEntries(entries: Entry[], ev: EventData, header: Header, c: Record<string, number>, pal: Pal) {
  const scale = (e: Entry) => `${e.d.cut?.group ?? e.key}|${e.d.colour}`;
  const pools = new Map<string, number[]>();
  for (const e of entries) {
    const { d, t, cutValues } = e, col = d.colour ? t.columns[d.colour] : undefined;
    if (!col || d.colourBy) continue; // categorical layers keep their own colours
    const min = cutMin(e, c), step = Math.max(1, Math.floor(t.n / 20000));
    const pool = pools.get(scale(e)) ?? [];
    for (let i = 0; i < t.n; i += step) if (!cutValues || cutValues[i] >= min) pool.push(Number(col[i]));
    pools.set(scale(e), pool);
  }
  const ranges = new Map<string, Range>([...pools].map(([k, pool]) => [k, valueRange(pool)]));
  return entries.map((e) => colours(e.d, e.t, ev, header, pal, ranges.get(scale(e))));
}

/** Show the selection and what is related to it, faded in over `ms` (0: at once, e.g. for freshly built layers). */
function applyHighlight(layers: Layer[], hl: Map<string, Set<number>> | null, ms: number) {
  for (const l of layers) l.setHighlight(hl ? hl.get(l.table) ?? new Set() : null);
  if (ms > 0) engine?.fadeHighlight(ms);
  else for (const l of layers) l.setHighlightMix(1);
  engine?.requestRender();
}
