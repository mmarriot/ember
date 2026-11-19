// Labels over the view: the leading objects of the layers with a `labels` hint (in a shared domain's view, e.g.
// Physics, where they are the event), the focus in any view, and the object under the pointer in the side panel's
// object rows (with a ring). HTML elements moved after every frame drawn (Engine.onDraw): a projection and a CSS
// transform each, a handful per frame.
import { computed, signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { kindName, type DisplayLayer } from "../io/format";
import type { Ref } from "../model/relations";
import { filters } from "../model/custom";
import {
  bundle,
  cuts,
  describe,
  domain,
  drawnLayers,
  event,
  focus,
  labelsOn,
  layerKey,
  layerOf,
  selection,
  shared,
} from "../model/store";
import { ranked } from "../control/navigate";
import { engine } from "../control/scene";

/** The object under the pointer in the side panel's object rows. */
export const rowHover = signal<Ref | null>(null);

interface Item {
  ref: Ref;
  text: string;
  kind: "lead" | "focus" | "selected" | "hover";
}

/** A label's text: its kind and the first value of its `describe` ("Jets · pT 49.7 GeV"); `full`: all of it. */
function text(d: DisplayLayer, row: number, full = false) {
  const skip = full ? [] : (d.describe?.columns.slice(1) ?? []);
  const name = describe(d.table, row, skip);
  return name ? `${kindName(d)} · ${name}` : `${kindName(d)} #${row}`;
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
  const out: Item[] = [],
    seen = new Set<string>(),
    add = (item: Item) => {
      const k = `${item.ref.table}:${item.ref.row}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(item);
      }
    };
  if (h && layerOf(h.table)) add({ ref: h, text: text(layerOf(h.table)!, h.row, true), kind: "hover" });
  // The selected object, marked so it is found at once, whatever the labels (L): every kind gets this mark, also those
  // the renderer cannot make stand out (a line one pixel wide).
  if (sel && layerOf(sel.table)) add({ ref: sel, text: text(layerOf(sel.table)!, sel.row, true), kind: "selected" });
  if (!labelsOn.value) return out;
  // The focus, when the selection is one of its parts.
  if (f && layerOf(f.table)) add({ ref: f, text: text(layerOf(f.table)!, f.row, true), kind: "focus" });
  // The leading objects: in a shared domain's view, or in a bundle without domains; not while a focus is shown elsewhere.
  const lead = (domain.value ? shared.value.has(domain.value) : !b.header.domains?.length) && !f;
  if (lead)
    for (const d of b.header.display.filter((l) => l.labels && drawn[layerKey(l)]))
      for (const row of ranked(d, d.labels)) add({ ref: { table: d.table, row }, text: text(d, row), kind: "lead" });
  return out;
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
    const e = engine;
    if (!e) return;
    const place = () => {
      const els = box.current?.children;
      if (!els) return;
      list.forEach((item, i) => {
        const el = els[i] as HTMLElement | undefined,
          at = anchor(item.ref),
          p = at && e.project(...at);
        if (!el) return;
        if (!p || !Number.isFinite(p[0])) {
          el.style.visibility = "hidden";
          return;
        }
        el.style.visibility = "visible";
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
      {list.map((item) => (
        <div class={`label ${item.kind}`}>
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  );
}
