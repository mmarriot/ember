// The controls drawn with the view: the views' buttons (in the top bar, or on the canvas with a domain bar), the
// shared domains' overlay chip and the choice of how the rest of the event is drawn around a selection.
import type { Header, ViewName } from "../../io/format";
import { bundle, domain, focus, overlay, rest, RESTS, type Rest, setRest, shared, view } from "../../model/store";

/** Whether the top bar has a domain bar (two or more domains); the views' buttons then go on the canvas. */
export const hasDomainBar = (h: Pick<Header, "domains"> | undefined) => (h?.domains?.length ?? 0) >= 2;

/** Each view: its name, its button's label and its key. */
export const VIEWS: [ViewName, string, string][] = [
  ["3d", "3D", "1"],
  ["front", "Front", "2"],
  ["side", "Side", "3"],
  ["rz", "ρ–z", "4"],
];
/** The views' buttons: on the canvas for a bundle with a domain bar (which takes their place), else in the top bar. */
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

/** In a domain's view, the chip that draws the shared domains' layers (e.g. Physics: jets, MET) over it. A selection
 *  draws its own objects of those whatever the chip (store/selection.ts focusLayers). */
export function OverlayChip() {
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

/** How the rest of the event can be drawn: the button's label and its tooltip. */
export const REST_NAMES: Record<Rest, [string, string]> = {
  dim: ["Dim", "Dim the rest of the event: it stays readable around the selection"],
  faint: ["Faint", "Leave a faint trace of the rest of the event"],
  hidden: ["Hide", "Hide the rest of the event: only the selection, its parts and its truth are drawn"],
};
/** While something is selected: how the rest of the event is drawn (H steps through). */
export function RestChoice() {
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
