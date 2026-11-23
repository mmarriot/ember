// The 3D view: the canvas (control/scene.ts draws on it) and what goes over it: labels, tooltip, captions, title, the
// views' buttons, chips and hint. Hover shows a tooltip, a click selects (again on the same spot: the next object
// under the pointer), a double click zooms to the selection, a drag rotates or pans.
import { effect, signal, untracked } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { unitOf } from "../../io/format";
import { colourBy } from "../../model/custom/settings";
import { sameRef } from "../../model/event/relations";
import {
  activeMode,
  anchor,
  bundle,
  event,
  focus,
  focusBar,
  focusLevel,
  focusLinked,
  hover,
  inFocus,
  isHitLayer,
  layerOf,
  nameOf,
  replayCaption,
  selection,
  short,
  shownLayer,
  shownLevel,
  subject,
  touring,
  unlook,
} from "../../model/store";
import { frameFocus, jump } from "../../control/navigate";
import { engine, startScene } from "../../control/scene";
import { stopTour, tourCaption } from "../../control/tour";
import type { Caption } from "../../render/replay";
import { Hint } from "./Hint";
import { cardBox, Labels } from "./Labels";
import { TitleBox } from "./TitleBox";
import { hasDomainBar, OverlayChip, RestChoice, Views } from "./ViewControls";

/** What ↓ / ↑ (or a chain step's "show") just drew, shown for a moment (stepCaptions). */
const stepCaption = signal<Caption | null>(null);

/** Caption each level stepped to within the same focus: its name, count and place among the focus's steps. Not for a
 *  level set with its focus (a link sets both at once); a new focus clears it. Returns the function that stops it. */
function stepCaptions() {
  let last = focus.peek(),
    since = 0, // when the focus last changed (ms)
    timer = 0;
  const stop = effect(() => {
    const chosen = focusLevel.value,
      f = focus.value;
    if (!sameRef(f, last)) {
      last = f;
      since = performance.now();
      stepCaption.value = null;
      return;
    }
    if (!f || touring.peek() || performance.now() - since < 100) return;
    if (chosen === null) return void (stepCaption.value = null); // back to the focus's default level
    const steps = untracked(() => focusBar.value).filter((l) => !l.always),
      i = steps.findIndex((l) => l.name === untracked(() => shownLevel.value));
    if (i < 0) return;
    stepCaption.value = {
      title: `Drawing: ${steps[i].name} · ${steps[i].count}`,
      detail: `step ${i + 1} of ${steps.length} · ↓ ↑ to step`,
    };
    clearTimeout(timer);
    timer = window.setTimeout(() => (stepCaption.value = null), 2500);
  });
  return () => {
    stop();
    clearTimeout(timer);
  };
}

/** The card's width and right margin (styles/card.css .inspector), for framing before it is drawn. */
const CARD = 384 + 12;

export function Viewport() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const stop = startScene(canvas.current!);
    const eng = engine!;
    eng.onInteract = stopTour;
    // Framing leaves the card's part of the view free: measured at each framing (one layout read), or where
    // styles/card.css puts it when the card is not drawn yet (framing in the same step as the selection).
    eng.cover = () => {
      if (!subject.peek()) return null;
      const box = canvas.current!.getBoundingClientRect();
      return cardBox(box) ?? { x0: box.width - CARD, y0: 12, x1: box.width - 12, y1: box.height - 12 };
    };
    const stopSteps = stepCaptions();
    return () => {
      stop();
      stopSteps();
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
  // A click again on the same spot selects the next of the objects stacked under the cursor. A click on nothing ends
  // the selection.
  let lastClick: { x: number; y: number } | null = null;
  const onClick = (e: MouseEvent) => {
    if (e.detail > 1 || dragged) return;
    const hits = engine?.pickAll(e.clientX, e.clientY, inFocus) ?? [];
    const again = lastClick && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 6,
      cur = selection.value;
    lastClick = { x: e.clientX, y: e.clientY };
    const at = again && cur ? hits.findIndex((h) => h.table === cur.table && h.row === cur.row) : -1;
    const hit = hits[(at + 1) % Math.max(hits.length, 1)];
    // An object linked to the focus (its truth particle; a truth particle's reco objects), not a hit: jump there,
    // keeping the way back.
    if (hit && !isHitLayer(layerOf(hit.table)) && focusLinked.peek()?.get(hit.table)?.has(hit.row))
      return jump({ table: hit.table, row: hit.row });
    // A click on nothing while looking at another object from a card: back to the card's object.
    if (!hit && anchor.peek()) return unlook();
    selection.value = hit ? { table: hit.table, row: hit.row } : null;
  };
  const onDoubleClick = (e: MouseEvent) => {
    if (dragged) return;
    // The first click already selected the object: zoom to it.
    if (!selection.value) {
      const hit = engine?.pick(e.clientX, e.clientY, inFocus);
      if (!hit) return;
      selection.value = { table: hit.table, row: hit.row };
    }
    frameFocus(700);
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
      {hasDomainBar(bundle.value?.header) && <Views />}
      <div class="viewchips">
        <OverlayChip />
        <RestChoice />
      </div>
      <Hint />
    </div>
  );
}

function ReplayCaption() {
  const tour = tourCaption.value,
    c = tour ?? replayCaption.value ?? stepCaption.value;
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
  const t = ev.tables[h.table];
  const value = d?.colour && t.columns[d.colour] ? Number(t.columns[d.colour][h.row]) : null;
  return (
    <div class="tooltip" style={{ left: h.x + 14, top: h.y + 14 }}>
      <b>{nameOf(h)}</b>
      {h.stacked > 1 && <div class="muted">{h.stacked} objects here · click again for the next</div>}
      {value !== null && (
        <div>
          {d!.colour}: {short(value)} {unitOf(b.header.tables[h.table].columns[d!.colour!]?.doc)}
        </div>
      )}
    </div>
  );
}
