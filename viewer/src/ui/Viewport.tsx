// The 3D view: the canvas (the engine draws on it: scene.ts) and what is drawn over it: labels, the tooltip, the replay
// and tour captions, the note while one kind is drawn alone, the views' buttons and a hint. The pointer: hovering an
// object shows its tooltip, a click selects it (again on the same spot: the next object under the pointer), a
// double click zooms to the selection, and a drag rotates or pans without changing the selection.
import { effect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { unitOf } from "../io/format";
import { colourBy } from "../model/custom";
import {
  activeMode,
  anchor,
  bundle,
  describe,
  event,
  focusLinked,
  highlight,
  hover,
  inFocus,
  isHitLayer,
  labelOf,
  layerOf,
  replayCaption,
  selection,
  short,
  shownLayer,
  unlook,
  view,
} from "../model/store";
import type { ViewName } from "../io/format";
import { Labels } from "./Labels";
import { Hint } from "./Hint";
import { TitleBox } from "./TitleBox";
import { jump } from "../control/navigate";
import { engine, startScene } from "../control/scene";
import { stopTour, tourCaption } from "../control/tour";

export function Viewport() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const stop = startScene(canvas.current!);
    const eng = engine!;
    eng.onInteract = stopTour;
    // The inspector covers the right of the view while something is selected: framing leaves that part free.
    const stopInset = effect(() => {
      selection.value;
      const panel = document.querySelector(".inspector") as HTMLElement | null,
        box = canvas.current!.getBoundingClientRect();
      eng.insetRight = selection.peek()
        ? Math.max(0, box.right - (panel?.getBoundingClientRect().left ?? box.right - 372))
        : 0;
    });
    return () => {
      stop();
      stopInset();
    };
  }, []);

  // A press that moves more than a few pixels is a rotate/pan, not a click: it must not change the selection.
  let pending = 0,
    down: { x: number; y: number } | null = null,
    dragged = false;
  const setCursor = (c: string) => {
    if (canvas.current) canvas.current.style.cursor = c;
  };
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY };
    dragged = false;
    hover.value = null;
  };
  const onUp = () => {
    down = null;
    setCursor(hover.value ? "pointer" : "grab");
  };
  const onMove = (e: PointerEvent) => {
    if (down) {
      if (!dragged && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) {
        dragged = true;
        setCursor("grabbing");
      }
      return;
    }
    if (pending || engine?.replaying) return; // objects of a replay are not all drawn yet
    pending = requestAnimationFrame(() => {
      pending = 0;
      const hits = engine?.pickAll(e.clientX, e.clientY, inFocus) ?? [];
      const r = canvas.current!.getBoundingClientRect();
      hover.value = hits.length
        ? { ...hits[0], x: e.clientX - r.left, y: e.clientY - r.top, stacked: hits.length }
        : null;
      setCursor(hits.length ? "pointer" : "grab");
    });
  };
  // Several objects can be stacked under the cursor (a candidate, its tracksters, a hit, a truth line): clicking
  // again on the same spot selects the next one. A click on nothing ends the focus (and the selection).
  let lastClick: { x: number; y: number } | null = null;
  const onClick = (e: MouseEvent) => {
    if (e.detail > 1 || dragged) return;
    const hits = engine?.pickAll(e.clientX, e.clientY, inFocus) ?? [];
    const again = lastClick && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 6,
      cur = selection.value;
    lastClick = { x: e.clientX, y: e.clientY };
    const at = again && cur ? hits.findIndex((h) => h.table === cur.table && h.row === cur.row) : -1;
    const hit = hits[(at + 1) % Math.max(hits.length, 1)];
    // An object linked to the focus (its truth particle; a truth particle's reco objects), other than single hits:
    // the focus moves there, keeping the way back.
    if (hit && !isHitLayer(layerOf(hit.table)) && focusLinked.peek()?.get(hit.table)?.has(hit.row))
      return jump({ table: hit.table, row: hit.row });
    // A click on nothing while another object is looked at from a card: back to the card's object, which is not lost.
    if (!hit && anchor.peek()) return unlook();
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
      <canvas
        ref={canvas}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerMove={onMove}
        onPointerLeave={() => (hover.value = null)}
        onClick={onClick}
        onDblClick={onDoubleClick}
      />
      <Labels />
      <Tooltip />
      <ReplayCaption />
      <TitleBox />
      {(bundle.value?.header.domains?.length ?? 0) >= 2 && <Views />}
      <Hint />
    </div>
  );
}

export const VIEWS: [ViewName, string, string][] = [
  ["3d", "3D", "1"],
  ["front", "Front", "2"],
  ["side", "Side", "3"],
  ["rz", "ρ–z", "4"],
];
/** The views (3D, front, side, ρ–z): on the canvas for a bundle with a domain bar (which takes their place in the top
 *  bar), else in the top bar. */
export function Views() {
  return (
    <div class="segmented views" role="group" aria-label="View">
      {VIEWS.map(([v, name, key]) => (
        <button
          class={view.value === v ? "on" : ""}
          title={`${name} view (${key})`}
          disabled={!bundle.value}
          onClick={() => (view.value = v)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

function ReplayCaption() {
  const tour = tourCaption.value,
    c = tour ?? replayCaption.value;
  return c ? (
    <div class={tour ? "caption tour" : "caption"} aria-live="polite">
      <b>{c.title}</b>
      {c.detail && <small>{c.detail}</small>}
    </div>
  ) : null;
}

function Tooltip() {
  const h = hover.value,
    ev = event.value,
    b = bundle.value;
  if (!h || !ev || !b || !ev.tables[h.table]) return null;
  const d0 = layerOf(h.table),
    d = d0 && shownLayer(d0, activeMode.value, colourBy.value);
  const t = ev.tables[h.table],
    name = describe(h.table, h.row);
  const value = d?.colour && t.columns[d.colour] ? Number(t.columns[d.colour][h.row]) : null;
  return (
    <div class="tooltip" style={{ left: h.x + 14, top: h.y + 14 }}>
      <b>{labelOf(h.table)}</b> #{h.row}
      {name && ` · ${name}`}
      {h.stacked > 1 && <div class="muted">{h.stacked} objects here · click again for the next</div>}
      {value !== null && (
        <div>
          {d!.colour}: {short(value)} {unitOf(b.header.tables[h.table].columns[d!.colour!]?.doc)}
        </div>
      )}
    </div>
  );
}
