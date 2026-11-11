// The 3D view. Layers are rebuilt when the event, theme, colour mode or choices, or filters change; ticking a layer or
// choosing a domain builds or frees only the layers concerned; a cut only sets a uniform per layer, and the focus a
// byte per object (plus a rebuild of the onSelection layers, which upload only the focus's rows, and building or
// freeing the layers its levels show or hide).
// Hover shows a tooltip, click selects, double-click zooms to the selection.
import { effect, signal } from "@preact/signals";
import { Color, LinearSRGBColorSpace } from "three";
import { useEffect, useRef } from "preact/hooks";
import { type DisplayLayer, type EventData, type Header, type Table, unitOf } from "../io/bundle";
import { colourBy, filterMask, filters } from "../model/custom";
import { cutMin, cutValues, HIDDEN, rescued } from "../model/cuts";
import { colours, type LayerFor, type Legend, PALETTES, valueRange, type Pal, type Range } from "../render/colour";
import { Engine, MIN_RADIUS, type ViewName } from "../render/engine";
import { builders, type Layer } from "../render/layers";
import { planReplay, type Parts, type Plan } from "../render/replay";
import { back, chooseDomain, jump } from "./navigate";
import {
  activeMode, bundle, cuts, describe, domain, drawnLayers, event, focus, focusBar, focusHidden, focusHistory, focusIsTruth, focusLayers, focusLevel, focusLinked, following,
  highlight, hover, inDomain, noTruth, inFocus, isHitLayer, kindOf, labelOf, layerKey, layerOf, legends, levelTop, pairView, rawEvent, replayCaption, selection, short,
  showAll, shown, shownLayer, shownLevel, theme, touring, view,
} from "../model/store";
import { PAIR } from "../model/pair";
import type { Ref } from "../model/relations";
import { stopTour } from "./tour";
import { Labels } from "./Labels";

export let engine: Engine | null = null;

/** `keep`: the layer's filter (null: none); `rescued`: the focus's rows it hides, drawn anyway (see cutValues). */
/** `uncoloured`: nothing of it is drawn yet (e.g. truth particles before a selection), so its colours wait (see build). */
/** `limited`: built with only the focus's rows (an onSelection layer), so showing them all again rebuilds it. */
interface Entry { d: DisplayLayer; t: Table; key: string; cut?: Float32Array; keep: Float32Array | null; rescued: string; rgb: Float32Array; emphasis?: Uint8Array; layer: Layer; uncoloured?: boolean; limited?: boolean }
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
  // The phases follow the bundle's display hints, not the colours drawn: a colour mode or choice that colours hits
  // through a relation (e.g. "Particle type") must not make them appear with the clusters.
  const header = bundle.peek()?.header, hints = new Map(header?.display.map((d) => [layerKey(d), d]));
  const items = entries.filter((e) => !e.d.context).map((e) => ({ ...e, d: hints.get(e.key) ?? e.d })); // background stays as it is
  const ev = event.peek(), parts: Parts = (name) => {
    const r = header?.relations[name], rel = ev?.relations[name], to = r && layerOf(r.to);
    return r && rel ? { to: r.to, offsets: rel.offsets, indices: rel.indices, name: to ? (to.kind ? to.group : to.label).toLowerCase() : undefined } : undefined;
  };
  plan = planReplay(items, header?.replay, parts);
  // The parts drawn whole only for the replay shrink away at its end, rather than vanishing when the layers are rebuilt.
  for (const e of entries) if (replayOnly(e.d, e.key, highlight.peek())) e.layer.setRetire(plan.linkEnd);
  engine.replay(plan.seconds);
  if (import.meta.env.DEV) Object.assign(window, { evdPlan: plan }); // for the e2e tests
  return plan;
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
    // The layers whose rows depend on the focus: those that show only its objects (e.g. track hits), rebuilt on every
    // focus (they are small) and, with `cutsOnly`, on a cut (they leave out the objects of what the cut hides); and
    // the filtered layers whose rows hidden by the default filter but in the focus changed.
    const rebuildForFocus = (cutsOnly: boolean) => {
      const hl = highlight.peek(), f = filters.peek(), pal = PALETTES[theme.peek()], b = bundle.peek();
      for (const e of entries) {
        const only = onlyFor(e.d, e.key, hl), focusRows = bypassing(e.d, f, hl), again = rescued(e.keep, focusRows);
        // Rebuilt: a layer of the focus's rows (on a new focus, or a cut), one that goes back to all its rows ("only for
        // the selection" unticked), and a filtered one whose rescued focus rows changed.
        if (cutsOnly ? !only : !only && !e.limited && again === e.rescued) continue;
        const cut = cutValues(e.d, e.t, f[e.d.table], only, focusRows), ev = event.peek();
        if (e.uncoloured && b && ev && !nothingDrawn(cut)) { // its first rows: its colours now
          const [{ rgb, emphasis, legend }] = colourEntries([{ ...e, cut }], ev, b.header, cuts.peek(), pal, entries);
          Object.assign(e, { rgb, emphasis, uncoloured: false });
          legends.value = { ...legends.peek(), [e.key]: legend };
        }
        const next = builders[e.d.repr]({ key: e.key, d: e.d, t: e.t, pal, rgb: e.rgb, emphasis: e.emphasis, cut, field: b?.header.field, relation: relationOf(b?.header, event.peek()) });
        eng.replaceLayer(e.layer, next);
        next.setHighlight(hl ? hl.get(next.table) ?? new Set() : null);
        next.setOutline?.(truthOutline() || sharedOutline(next) || faintOutline(next), isEnvelope(next)); // as drawn before
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
      recolourFrame ||= requestAnimationFrame(() => { recolourFrame = 0; if (highlight.peek()) rebuildForFocus(true); applyCuts(true); });
    });
    // The smallest radius framed: that of the focus's domain (a vertex in the tracker), else of the domain looked at,
    // else the bundle's.
    const stopRadius = effect(() => {
      const h = bundle.value?.header, f = focus.value, at = (name?: string | null) => h?.domains?.find((d) => d.name === name)?.minRadius;
      eng.minRadius = at(f && layerOf(f.table)?.domain) ?? at(domain.value) ?? h?.view?.minRadius ?? MIN_RADIUS;
    });
    // The selected object is drawn whatever the cut (e.g. a track below the pT cut, picked in the inspector).
    const stopPin = effect(() => { selection.value; pinSelection(); applyCuts(false); });

    // The layers to draw: the visible ones but the levels a focus hides, the hidden ones it shows, and in a replay
    // every visible layer and reconstruction stage.
    const wanted = (header: Header, ev: EventData) => {
      const vis = drawnLayers.peek(), forced = focusLayers.peek(), hidden = focusHidden.peek(), all = replaying.peek();
      const draw = (k: string, d: DisplayLayer) => (vis[k] && (all || !hidden.has(k))) || forced.has(k) || (all && d.stage !== undefined && inDomain(d));
      return header.display.filter((d) => draw(layerKey(d), d) && ev.tables[d.table]?.n);
    };
    // Builds the given layers, adding their legends to `drawn`; colour scales are shared with the layers in `pool`.
    const build = (layers: DisplayLayer[], header: Header, ev: EventData, drawn: Record<string, Legend>, pool: Entry[] = []): Entry[] => {
      const f = filters.peek(), hl = highlight.peek(), pal = PALETTES[theme.peek()];
      const items = layers.map((d0) => {
        const key = layerKey(d0), d = shownLayer(d0), t = ev.tables[d.table], keep = filterMask(t, f[d.table]), focusRows = bypassing(d, f, hl);
        const only = onlyFor(d, key, hl);
        return { d, t, key, keep, rescued: rescued(keep, focusRows), cut: cutValues(d, t, f[d.table], only, focusRows), limited: !!only };
      });
      // A layer with nothing drawn yet (truth particles before a selection: identity colours of 100k particles cost
      // ~20-50 ms per event) is coloured when it gets rows (rebuildForFocus); the truth colours always need its legend.
      const later = (s: (typeof items)[number]) => nothingDrawn(s.cut) && activeMode.peek() !== "truth";
      const now = items.filter((s) => !later(s)), done = colourEntries(now, ev, header, cuts.peek(), pal, [...pool, ...items]);
      const coloured = new Map(now.map((s, i) => [s, done[i]]));
      return items.map((s) => {
        const c = coloured.get(s), rgb = c?.rgb ?? new Float32Array(3 * s.t.n), emphasis = c?.emphasis;
        if (c) drawn[s.key] = c.legend;
        return { ...s, rgb, emphasis, uncoloured: !c, layer: builders[s.d.repr]({ ...s, pal, rgb, emphasis, field: header.field, relation: relationOf(header, ev) }) };
      });
    };

    let builtFor: EventData | null = null; // the event the layers were built for
    let outlinesFor: unknown[] = []; // the bundle and palette the detector outlines were drawn for
    let lastPair = pairView.peek(); // the pair whose colours the layers have (recoloured when it changes)
    // What every layer was built with: a change rebuilds them all. Which layers are drawn (ticks, domain, focus) is not
    // in it: those changes only build or free the layers concerned (stopForced).
    const settings = () => [bundle.peek(), event.peek(), theme.peek(), colourBy.peek(), activeMode.peek(), filters.peek(), replaying.peek()];
    let builtWith: unknown[] = [];
    const stopLayers = effect(() => {
      const b = bundle.value, ev = event.value, pal = PALETTES[theme.value];
      colourBy.value; activeMode.value; filters.value; replaying.value; // any change rebuilds every layer
      builtWith = settings();
      if (!b || !ev) return;
      eng.setBackground(pal.background);
      if (outlinesFor[0] !== b || outlinesFor[1] !== pal) { // their geometry: once per bundle and theme
        eng.setOutlines(b.header.outlines ?? [], new Color().setStyle(pal.unassigned, LinearSRGBColorSpace), new Color().setHex(pal.background, LinearSRGBColorSpace));
        outlinesFor = [b, pal];
      }
      const drawn: Record<string, Legend> = {};
      entries = build(wanted(b.header, ev), b.header, ev, drawn);
      builtFor = ev;
      lastPair = pairView.peek(); // built with its colours
      legends.value = drawn;
      eng.setLayers(entries.map((e) => e.layer));
      applyCuts(false);
      const raw = rawEvent.peek(); // not `ev`: adding a custom column makes a new event object for the same event
      if (raw !== lastEvent && !touring.peek() && !following.peek()) eng.frame(); // tour and Live fly there themselves
      lastEvent = raw;
      showFocus(0);
    });

    // Ticks, the domain and the focus change which layers are drawn: a focus draws some hidden layers (e.g. a
    // candidate's tracksters, when that level is chosen) and hides some ticked ones (e.g. its layer clusters, until
    // chosen); a domain hides the others' layers. Only those are built or freed; the others keep their buffers (going
    // from the Tracker view back to All builds the calorimeter layers, not the tracker's again).
    const stopForced = effect(() => {
      focusLayers.value; focusHidden.value; drawnLayers.value;
      const b = bundle.peek(), ev = event.peek();
      // Something every layer depends on changed too (e.g. a domain with its own colour mode): stopLayers rebuilds them.
      if (!b || !ev || ev !== builtFor || settings().some((v, i) => v !== builtWith[i])) return;
      const keep = new Set(wanted(b.header, ev).map(layerKey)), have = new Set(entries.map((e) => e.key));
      const gone = entries.filter((e) => !keep.has(e.key)), added = b.header.display.filter((d) => keep.has(layerKey(d)) && !have.has(layerKey(d)));
      if (!gone.length && !added.length) return;
      const drawn = { ...legends.peek() };
      for (const e of gone) { eng.removeLayer(e.layer); delete drawn[e.key]; }
      entries = entries.filter((e) => keep.has(e.key));
      const fresh = build(added, b.header, ev, drawn, entries), hl = highlight.peek(), outline = truthOutline();
      for (const { layer } of fresh) {
        eng.addLayer(layer);
        layer.setHighlight(hl ? hl.get(layer.table) ?? new Set() : null);
        layer.setOutline?.(outline || sharedOutline(layer) || faintOutline(layer), isEnvelope(layer));
        layer.setHighlightMix(1);
      }
      entries = [...entries, ...fresh];
      legends.value = drawn;
      applyCuts(false);
    });

    // A new focus: the layers that show only its objects (e.g. truth particles, track hits) are rebuilt, which is cheap
    // as they are small, and so are the filtered layers whose rows hidden by the filter but in the focus changed (a
    // candidate's track from another vertex); the other layers keep their buffers. Then every layer fades to the new
    // highlight.
    const stopFocus = effect(() => {
      const pal = PALETTES[theme.peek()], b = bundle.peek(), ev = event.peek();
      highlight.value; showAll.value; pairView.value;
      // A new truth <-> reco pair (or none any more): every layer is recoloured in place (a buffer upload each, no
      // rebuild).
      const pair = pairView.peek(), changed = pair?.particle !== lastPair?.particle || pair?.candidate !== lastPair?.candidate;
      lastPair = pair;
      if (changed && b && ev && ev === builtFor) {
        const recolour = entries.filter((e) => !e.d.context), drawn = { ...legends.peek() };
        colourEntries(recolour, ev, b.header, cuts.peek(), pal).forEach(({ rgb, legend }, i) => {
          recolour[i].layer.setColours(rgb);
          recolour[i].rgb = rgb;
          recolour[i].uncoloured = false;
          drawn[recolour[i].key] = legend;
        });
        legends.value = drawn;
      }
      rebuildForFocus(false);
      applyCuts(false);
      showFocus(touring.peek() ? 900 : 250);
    });
    // A level shown inside the focus turns the focus into an outline around it (see isEnvelope).
    const stopEnvelope = effect(() => {
      shownLevel.value; domain.value;
      const outline = truthOutline();
      for (const { layer } of entries) layer.setOutline?.(outline || sharedOutline(layer) || faintOutline(layer), isEnvelope(layer));
      eng.requestRender();
    });
    const stopView = effect(() => eng.setView(view.value, highlight.peek() ?? undefined));
    // The inspector covers the right of the view while something is selected: framing leaves that part free.
    const stopInset = effect(() => {
      selection.value;
      const panel = document.querySelector(".inspector") as HTMLElement | null, box = canvas.current!.getBoundingClientRect();
      eng.insetRight = selection.peek() ? Math.max(0, box.right - (panel?.getBoundingClientRect().left ?? box.right - 372)) : 0;
    });
    return () => { cancelAnimationFrame(recolourFrame); stopRadius(); stopPin(); stopLayers(); stopForced(); stopCuts(); stopFocus(); stopEnvelope(); stopView(); stopInset(); };
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
      <Labels />
      <Tooltip />
      <FocusBar />
      <ReplayCaption />
      {(bundle.value?.header.domains?.length ?? 0) >= 2 && <Views />}
      <div class="hintbar">Drag to rotate · right-drag to pan · scroll to zoom · click to inspect · double-click to zoom in · <kbd>?</kbd> help</div>
    </div>
  );
}

const VIEWS: [ViewName, string, string][] = [["3d", "3D", "1"], ["front", "Front", "2"], ["side", "Side", "3"], ["rz", "ρ–z", "4"]];
/** The views (3D, front, side, ρ–z): on the canvas for a bundle with a domain bar (which takes their place in the top
 *  bar), else in the top bar. */
export function Views() {
  return (
    <div class="segmented views" role="group" aria-label="View">
      {VIEWS.map(([v, name, key]) => (
        <button class={view.value === v ? "on" : ""} title={`${name} view (${key})`} onClick={() => (view.value = v)}>{name}</button>
      ))}
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
    <div class="focusbar" role="status">
      <div class="row" title="It is shown with its smallest parts; only its parts can be clicked">
        {prev && <button class="link" onClick={back} title={`Back to ${name(prev)}`}>← {name(prev)}</button>}
        <span class="muted">Focus</span> <b>{name(f)}</b>
        <button class="link" onClick={() => (selection.value = null)}>leave (Esc)</button>
      </div>
      <Levels />
    </div>
  );
}

/** The kinds of object the focus is made of, top first: the last ones (its smallest objects, e.g. hits) are always
 *  shown, one of the others on request (a click, or ↓ ↑), so they do not cover each other. With parts of the detector,
 *  the levels of the domain looked at (and the shared ones), and a chip for each other part the focus has objects in:
 *  a click there looks at that part, keeping the focus. */
function Levels() {
  const { bar: lv, chips } = focusBar.value, chosen = focusLevel.value;
  if (!lv.some((l) => !l.always) && !chips.length) return null;
  return (
    <div class="row levels" title="What it is made of, from the largest objects down: click one to show it as well (↓ ↑)">
      {pairView.value && <span class="muted" title="Counts: the pair's objects (its candidate's, and its particle's in other candidates or none)">truth ↔ reco pair:</span>}
      {lv.map((l, i) => {
        const last = l.always, on = last || l.name === chosen;
        return (
          <>
            {i > 0 && <span class="muted" aria-hidden="true">›</span>}
            <button class={on ? "level on" : "level"} disabled={last} aria-pressed={on}
              onClick={() => (focusLevel.value = on ? null : l.name)}>{l.name} <span class="count">{l.count.toLocaleString()}</span></button>
          </>
        );
      })}
      {chips.length > 0 && <span class="muted chipsin">{lv.length ? "· in" : "in"}</span>}
      {chips.map(({ domain: name, level }) => (
        <button class="level part" title={`Look at it in ${name}, keeping the focus (D): its ${level.name.toLowerCase()} and what they are made of`}
          onClick={() => chooseDomain(name)}>{name} <span class="count">{level.count.toLocaleString()}</span></button>
      ))}
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

/** The focus's rows that the layer's filter does not hide: all of them while the filter is the profile's default (a
 *  candidate's track from another vertex); none once the user set or changed it (a filter they chose applies to the
 *  focus too, and a click never rebuilds a big layer they filtered). */
const bypassing = (d: DisplayLayer, f: Record<string, string>, hl: Map<string, Set<number>> | null) =>
  d.filter && f[d.table] === d.filter ? hl?.get(d.table) : undefined;

/** Whether a layer that shows only the focus's objects is drawn whole only because a replay of the whole event builds
 *  paths from its objects (display hint `grow` on a drawn layer), so the building can be seen. */
const replayOnly = (d: DisplayLayer, key: string, hl: Map<string, Set<number>> | null) => {
  const h = bundle.peek()?.header, drawn = drawnLayers.peek();
  return !!d.onSelection && !showAll.peek()[key] && replaying.peek() && !hl
    && !!h?.display.some((p) => p.grow && drawn[layerKey(p)] && inDomain(p) && h.relations[p.grow.parts]?.to === d.table);
};

/** For a layer that shows only the focus's objects: the rows to keep (none without a focus), less those reached only
 *  from objects a cut hides (the hits and truth of a vertex's tracks below the pT cut); else undefined. */
const onlyFor = (d: DisplayLayer, key: string, hl: Map<string, Set<number>> | null) => {
  if (!d.onSelection || showAll.peek()[key] || replayOnly(d, key, hl)) return undefined;
  const rows = hl?.get(d.table);
  if (!rows) return new Set<number>();
  const cut = belowCut(d.table, hl!);
  return cut.size ? new Set([...rows].filter((r) => !cut.has(r))) : rows;
};

/** The focus's objects of `table` reached only from focus objects of a layer with a cut that they fail (not the
 *  selected one): across every relation into `table` from such a layer. */
function belowCut(table: string, hl: Map<string, Set<number>>) {
  const h = bundle.peek()?.header, ev = event.peek(), c = cuts.peek(), sel = selection.peek(), hidden = new Set<number>(), kept = new Set<number>();
  for (const [name, r] of Object.entries(h?.relations ?? {})) {
    const p = layerOf(r.from), rel = ev?.relations[name], from = hl.get(r.from), col = p?.cut && ev?.tables[r.from]?.columns[p.cut.column];
    if (r.to !== table || r.from === table || !p?.cut || !rel || !from || !col) continue;
    const min = c[p.cut.group] ?? 0;
    for (const f of from) {
      const into = Number(col[f]) >= min || (sel?.table === r.from && sel.row === f) ? kept : hidden;
      for (let k = rel.offsets[f]; k < rel.offsets[f + 1]; k++) into.add(rel.indices[k]);
    }
  }
  for (const r of kept) hidden.delete(r);
  return hidden;
}

/** A layer's cut values hide every row (a layer drawn only for a selection, without one). */
const nothingDrawn = (cut?: Float32Array) => !!cut && !cut.some((v) => v > HIDDEN);

/** An event's relation with its `to` table, for layers drawn through one (e.g. a polyline's points). */
const relationOf = (header: Header | undefined, ev: EventData | null) => (name: string) => {
  const info = header?.relations[name], rel = ev?.relations[name], to = info && ev?.tables[info.to];
  return rel && to ? { offsets: rel.offsets, indices: rel.indices, to } : undefined;
};

/** Pin the selected object in its layer (drawn whatever the cut); unpin elsewhere. */
function pinSelection() {
  const sel = selection.peek();
  for (const { layer } of entries) layer.setPinned(sel?.table === layer.table ? sel.row : -1);
  engine?.requestRender();
}

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
  const layerFor = chosenColours(header), pair = pairView.peek(), classRgb = pal.pair.map(hexRgb), chosen = colourBy.peek();
  const bg = [(pal.background >> 16) & 255, (pal.background >> 8) & 255, pal.background & 255].map((v) => v / 255);
  return items.map((e) => {
    const cls = e.d.context || chosen[e.key] ? undefined : pair?.classes.get(e.d.table); // a layer's own choice wins
    const out = cls ? pairColours(cls, classRgb) : colours(e.d, e.t, ev, header, pal, { range: ranges.get(scale(e)), layerFor }), dim = e.d.dim;
    if (dim) for (let i = 0; i < out.rgb.length; i++) out.rgb[i] += (bg[i % 3] - out.rgb[i]) * dim;
    return out;
  });
}

/** The pair view's colours: one per class (model/pair.ts); objects outside the pair drawn small. */
function pairColours(cls: Uint8Array, classRgb: number[][]) {
  const rgb = new Float32Array(3 * cls.length), emphasis = new Uint8Array(cls.length);
  for (let i = 0; i < cls.length; i++) { rgb.set(classRgb[cls[i]], 3 * i); emphasis[i] = cls[i] === PAIR.other ? 0 : 1; }
  return { rgb, emphasis, legend: { kind: "category" as const, text: "truth ↔ reco pair (colour key)" } };
}
const hexRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** Reco objects drawn as outlines: when the focus is a truth particle, except in the pair view, which looks the same
 *  from either side. */
const truthOutline = () => focusIsTruth.peek() && !pairView.peek();

/** A layer of a shared domain (header `domains[i].shared`, e.g. physics objects) seen from another domain's view (a
 *  detector's) is drawn as an outline (cones: their rim), so it does not cover that detector's objects. */
const sharedOutline = (layer: Layer) => {
  const d = layerOf(layer.table), current = domain.peek(), domains = bundle.peek()?.header.domains;
  return !!d?.domain && !!current && d.domain !== current && !!domains?.find((x) => x.name === d.domain && x.shared);
};
/** By truth, a kind with no truth of its own drawn as cones (jets) is an outline, so it never looks like a matched
 *  object (docs/truth.md "Where truth stops"). */
const faintOutline = (layer: Layer) => activeMode.peek() === "truth" && layerOf(layer.table)?.repr === "cones" && noTruth(layer.table);

/** While a level is shown inside the focus (e.g. a candidate's tracksters), the focus's layer draws it as a
 *  full-size outline around them: the largest object, without covering what is inside. */
const isEnvelope = (layer: Layer) => !!shownLevel.peek() && layer.table === levelTop.peek()?.table;

/** Highlight the focus and what belongs to it on every layer (outlines: see truthOutline and isEnvelope), faded in
 *  over `ms` (0: at once, e.g. for freshly built layers). */
function showFocus(ms: number) {
  const hl = highlight.peek(), outline = truthOutline();
  for (const { layer } of entries) {
    layer.setHighlight(hl ? hl.get(layer.table) ?? new Set() : null);
    layer.setOutline?.(outline || sharedOutline(layer) || faintOutline(layer), isEnvelope(layer));
  }
  if (ms > 0) engine?.fadeHighlight(ms);
  else for (const { layer } of entries) layer.setHighlightMix(1);
  engine?.requestRender();
}
