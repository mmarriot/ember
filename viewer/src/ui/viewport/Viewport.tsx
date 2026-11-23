// The 3D view: the canvas (the engine draws on it: scene.ts) and what is drawn over it: labels, the tooltip, the replay
// and tour captions, the note while one kind is drawn alone, the views' buttons and a hint. The pointer: hovering an
// object shows its tooltip, a click selects it (again on the same spot: the next object under the pointer), a
// double click zooms to the selection, and a drag rotates or pans without changing the selection.
import { effect, signal, untracked } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { Caption } from "../../render/replay";
import { sameRef } from "../../model/event/relations";
import { unitOf } from "../../io/format";
import { colourBy } from "../../model/custom/custom";
import {
  activeMode,
  anchor,
  bundle,
  domain,
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
  overlay,
  replayCaption,
  rest,
  RESTS,
  type Rest,
  selection,
  setRest,
  shared,
  short,
  shownLayer,
  shownLevel,
  subject,
  touring,
  unlook,
  view,
} from "../../model/store";
import type { ViewName } from "../../io/format";
import { Labels } from "./Labels";
import { Hint } from "./Hint";
import { TitleBox } from "./TitleBox";
import { frameFocus, jump } from "../../control/navigate";
import { engine, startScene } from "../../control/scene";
import { stopTour, tourCaption } from "../../control/tour";

/** What ↓ / ↑ (or a chain step's "show") just drew: shown on the view for a moment (see stepCaptions). */
const stepCaption = signal<Caption | null>(null);

/** Caption each level the user steps to inside the same focus (↓ / ↑, a chain step's "show"): its name and count, and
 *  where it is among the focus's steps. Not when the domain changes (D: the chosen level stays), nor for a level set
 *  with its focus (a link, which sets both at once); a new focus clears it. Returns the function that stops it. */
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
    if (chosen === null) return void (stepCaption.value = null); // back to the object with its smallest parts
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
    // The card covers part of the view while something is selected: framing leaves that part free. Measured at each
    // framing (one layout read); a card not drawn yet (framing in the same step as the selection) is taken where
    // styles/card.css puts it.
    eng.cover = () => {
      if (!subject.peek()) return null;
      const box = canvas.current!.getBoundingClientRect(),
        card = document.querySelector(".inspector")?.getBoundingClientRect();
      return card
        ? { x0: card.left - box.left, y0: card.top - box.top, x1: card.right - box.left, y1: card.bottom - box.top }
        : { x0: box.width - CARD, y0: 12, x1: box.width - 12, y1: box.height - 12 };
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
      {(bundle.value?.header.domains?.length ?? 0) >= 2 && <Views />}
      <div class="viewchips">
        <OverlayChip />
        <RestChoice />
      </div>
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

/** In a detector part's view, the chip that draws the shared parts' layers (e.g. Physics: jets, MET) over it. A
 *  selection draws its own objects of those parts whatever the chip (store/selection.ts focusLayers). */
function OverlayChip() {
  const d = domain.value,
    names = [...shared.value];
  if (!d || !names.length || shared.value.has(d)) return null;
  const on = overlay.value,
    name = names.join(" · ");
  return (
    <button
      class={on ? "overlaychip on" : "overlaychip"}
      aria-pressed={on}
      title={`${on ? "Stop drawing" : "Draw"} the ${name} objects over this part of the detector`}
      onClick={() => (overlay.value = !on)}
    >
      {name} overlay
    </button>
  );
}

export const REST_NAMES: Record<Rest, [string, string]> = {
  dim: ["Dim", "Dim the rest of the event: it stays readable around the selection"],
  faint: ["Faint", "Leave a faint trace of the rest of the event"],
  hidden: ["Hide", "Hide the rest of the event: only the selection, its parts and its truth are drawn"],
};
/** While something is selected: how the rest of the event is drawn (dimmed, faint, hidden; key H steps through). */
function RestChoice() {
  if (!focus.value) return null;
  return (
    <div class="segmented rest" role="group" aria-label="The rest of the event">
      <span class="label" title="How the rest of the event is drawn while something is selected (H)">
        Others
      </span>
      {RESTS.map((r) => (
        <button
          class={rest.value === r ? "on" : ""}
          aria-pressed={rest.value === r}
          title={`${REST_NAMES[r][1]} (H)`}
          onClick={() => setRest(r)}
        >
          {REST_NAMES[r][0]}
        </button>
      ))}
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
