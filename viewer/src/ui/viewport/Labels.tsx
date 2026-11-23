// Labels over the view: the leading objects of the layers with a `labels` hint (in a shared domain's view, e.g.
// Physics, where they are the event), the focus in any view, and the object under the pointer in the side panel's
// object rows (with a ring). HTML elements moved after every frame drawn (Engine.onDraw): a projection and a CSS
// transform each, a handful per frame. A label never sits under the card (it flips to the left of its object), and
// where labels would overlap, the less important one hides (see place).
import { computed, signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { Ref } from "../../model/event/relations";
import { filters } from "../../model/custom/settings";
import {
  bundle,
  caloView,
  cuts,
  domain,
  drawnLayers,
  event,
  focus,
  labelsOn,
  labelText,
  layerKey,
  layerOf,
  selection,
  shared,
  truthText,
} from "../../model/store";
import { ranked } from "../../control/navigate";
import { engine } from "../../control/scene";
import { type Kind, placeLabels } from "./placement";

/** The object under the pointer in the side panel's object rows. */
export const rowHover = signal<Ref | null>(null);

interface Item {
  ref: Ref;
  text: string;
  kind: Kind;
}

const items = computed<Item[]>(() => {
  const b = bundle.value,
    ev = event.value,
    drawn = drawnLayers.value,
    f = focus.value,
    h = rowHover.value,
    sel = selection.value;
  cuts.value;
  filters.value; // the leading objects follow the cuts and filters
  if (!b || !ev) return [];
  // `full`: with all its values (the selection, the focus, the row pointed at), else with the first of its `describe`
  const out: (Omit<Item, "text"> & { full: boolean })[] = [],
    seen = new Set<string>(),
    add = (ref: Ref, kind: Kind, full = true) => {
      const k = `${ref.table}:${ref.row}`;
      if (layerOf(ref.table) && !seen.has(k)) {
        seen.add(k);
        out.push({ ref, kind, full });
      }
    };
  if (h) add(h, "hover");
  // The selected object, marked so it is found at once, whatever the labels (L): every kind gets this mark, also those
  // the renderer cannot make stand out (a line one pixel wide).
  if (sel) add(sel, "selected");
  if (labelsOn.value) {
    // The focus, when the selection is one of its parts.
    if (f) add(f, "focus");
    // The leading objects: in a shared domain's view, or in a bundle without domains; not while a focus is shown
    // elsewhere.
    const lead = (domain.value ? shared.value.has(domain.value) : !b.header.domains?.length) && !f;
    if (lead)
      for (const d of b.header.display.filter((l) => l.labels && drawn[layerKey(l)]))
        for (const row of ranked(d, d.labels)) add({ table: d.table, row }, "lead", false);
  }
  // A label's text: the object's name (model/event/describe.ts labelName), with the first value of its `describe` ("Jet 1 ·
  // pT 49.7 GeV") or, `full`, all of them; its collection only where another of its kind is labelled too.
  const labelled = [...new Set(out.map((x) => x.ref.table))].map((t) => layerOf(t)!);
  return out.map(({ ref, kind, full }) => {
    const d = layerOf(ref.table)!;
    return { ref, kind, text: labelText(ref, full ? [] : (d.describe?.columns.slice(1) ?? []), labelled) };
  });
});

/** Where an object's label goes: the end of a line or a cone (its far end, e.g. where a jet meets the calorimeter),
 *  else its position; null if its layer is not drawn in this view. */
function anchor(ref: Ref): [number, number, number] | null {
  const l = engine?.drawnLayer(ref.table);
  if (!l || !l.object.visible || ref.row >= l.x.length) return null;
  const e = l.segment?.b;
  return e ? [e[0][ref.row], e[1][ref.row], e[2][ref.row]] : [l.x[ref.row], l.y[ref.row], l.z[ref.row]];
}

export function Labels() {
  const box = useRef<HTMLDivElement>(null),
    list = items.value;
  useEffect(() => {
    const e = engine,
      host = box.current;
    if (!e || !host) return;
    const els = [...host.children] as HTMLElement[],
      spans = els.map((el) => el.firstElementChild as HTMLElement);
    // The texts' sizes: measured once per list (moving a label does not change them).
    const sizes = spans.map((s) => [s.offsetWidth, s.offsetHeight]);
    // All reads first (the card's rectangle: one layout at most), then all writes, so a frame lays out once.
    const place = () => {
      const view = host.getBoundingClientRect(),
        c = document.querySelector(".inspector")?.getBoundingClientRect(),
        card = c && { x0: c.left - view.left, y0: c.top - view.top, x1: c.right - view.left, y1: c.bottom - view.top };
      const at = list.map((item) => {
        const a = anchor(item.ref),
          p = a && e.project(...a);
        return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : null;
      });
      const sides = placeLabels(
        list.map((item, i) => ({ kind: item.kind, at: at[i], w: sizes[i]?.[0] ?? 0, h: sizes[i]?.[1] ?? 0 })),
        card,
      );
      els.forEach((el, i) => {
        const p = at[i];
        if (!p || !sides[i]) {
          el.style.visibility = "hidden";
          return;
        }
        el.style.visibility = "visible";
        el.classList.toggle("flip", sides[i] === "left");
        el.style.transform = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px)`;
      });
    };
    e.onDraw = place;
    place();
    e.requestRender();
    return () => {
      if (e.onDraw === place) e.onDraw = () => {};
    };
  }, [list]);
  return (
    <div class="labels" ref={box} aria-hidden="true">
      {list.map((item) => {
        // A truth object's label is the truth's: violet, dashed, "Truth · μ⁺ · pT 96.6 · η 1.11" (docs/truth.md).
        const truth = !!layerOf(item.ref.table)?.truth,
          name = truth && truthText(item.ref.table, item.ref.row, caloView.value);
        return (
          <div class={`label ${item.kind}${truth ? " truth" : ""}`}>
            <span>{truth ? `Truth · ${name || item.text}` : item.text}</span>
          </div>
        );
      })}
    </div>
  );
}
