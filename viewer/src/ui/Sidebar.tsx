// Left panel: the profile's presets; a tab per part of the detector (layer `domain`) with its collections, the truth
// (its collections, what became of each particle, the tree) and the event; the colour key under them. Its width can
// be dragged.
import type { ComponentChildren } from "preact";
import { activePreset } from "../model/custom";
import { applyPreset } from "../model/presets";
import { bundle, bundleName } from "../model/store";
import { EventInfo } from "./EventInfo";
import { ColourKey } from "./Key";
import { Collections, tabOf } from "./Layers";
import { Truth, treeRelations } from "./Tree";
import { Tabs } from "./widgets";

export function Sidebar() {
  const b = bundle.value, display = b?.header.display ?? [], presets = b?.header.presets ?? [];
  const reco = display.filter((d) => !d.truth), truth = display.some((d) => d.truth);
  const tabs: [string, () => ComponentChildren][] = [...new Set(reco.map(tabOf))].map((name) => [name, () => <Collections key={`${bundleName.value}|${name}`} layers={reco.filter((d) => tabOf(d) === name)} />]);
  if (truth || treeRelations().length) tabs.push([truth ? "Truth" : "Tree", Truth]);
  tabs.push(["Event", EventInfo]);
  return (
    <>
      <aside class="sidebar">
        {presets.length > 1 && (
          <div class="segmented presets" role="group" aria-label="Preset">
            {presets.map((p, i) => <button class={activePreset.value === i ? "on" : ""} onClick={() => applyPreset(i)}>{p.name}</button>)}
          </div>
        )}
        <Tabs tabs={tabs} />
        <ColourKey />
      </aside>
      <div class="resizer" title="Drag to resize, double-click to reset" onPointerDown={startResize} onDblClick={() => setWidth(DEFAULT_WIDTH)} />
    </>
  );
}

// Sidebar width: a CSS variable on the root, remembered per browser (storage may be unavailable, e.g. private mode).
const DEFAULT_WIDTH = 340, KEY = "evd.sidebar";
function setWidth(px: number) {
  const w = Math.round(Math.min(560, Math.max(260, px)));
  document.documentElement.style.setProperty("--sidebar", `${w}px`);
  try { localStorage.setItem(KEY, String(w)); } catch { /* not persisted */ }
}
try { const w = Number(localStorage.getItem(KEY)); if (w) setWidth(w); } catch { /* default width */ }

function startResize(e: PointerEvent) {
  const handle = e.currentTarget as HTMLElement;
  handle.setPointerCapture(e.pointerId);
  document.body.classList.add("resizing");
  const move = (m: PointerEvent) => setWidth(m.clientX);
  const up = () => { handle.removeEventListener("pointermove", move); document.body.classList.remove("resizing"); };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up, { once: true });
}
