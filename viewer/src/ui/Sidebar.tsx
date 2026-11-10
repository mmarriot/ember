// Left panel: one tab each for layers, cuts and filters, custom columns, the object tree (if the data has one) and
// the event. Its width can be dragged.
import { bundle } from "../model/store";
import { Columns } from "./Columns";
import { Cuts } from "./Cuts";
import { EventInfo } from "./EventInfo";
import { Layers } from "./Layers";
import { Tree, treeRelations } from "./Tree";
import { Tabs } from "./widgets";

export function Sidebar() {
  const tree: [string, typeof Tree][] = treeRelations().length ? [[bundle.value?.header.display.some((d) => d.truth) ? "Truth" : "Tree", Tree]] : [];
  return (
    <>
      <aside class="sidebar">
        <Tabs tabs={[["Layers", Layers], ["Cuts", Cuts], ["Columns", Columns], ...tree, ["Event", EventInfo]]} />
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
