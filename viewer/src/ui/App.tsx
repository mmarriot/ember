// Page layout, start-up (bundle list, URL state), keyboard shortcuts, help dialog and drag-and-drop.
import { effect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { blobSource } from "../io/bundle";
import type { ViewName } from "../render/engine";
import { bundleName, catalogue, dialog, eventIndex, highlight, openBundle, refreshCatalogue, selection, showEvent, view } from "../model/store";
import { Header } from "./Header";
import { Inspector } from "./Inspector";
import { Sidebar } from "./Sidebar";
import { stopTour, toggleTour } from "./tour";
import { engine, replayEvent, Viewport } from "./Viewport";
import { Modal, Toasts } from "./widgets";

const VIEW_KEYS: Record<string, ViewName> = { "1": "3d", "2": "front", "3": "side", "4": "rz" };
const POLL = 30_000; // ms between index.json checks (keeps the data set list current): one small request per page

export function App() {
  useEffect(() => {
    const url = new URLSearchParams(location.hash.slice(1));
    refreshCatalogue().then(async () => {
      const name = url.get("b") ?? catalogue.value.bundles[0]?.file;
      if (!name) return;
      await openBundle(name);
      await showEvent(Number(url.get("e") ?? 0));
      const v = url.get("v") as ViewName | null;
      if (v && Object.values(VIEW_KEYS).includes(v)) view.value = v;
      const [table, row] = (url.get("s") ?? "").split(":");
      if (table && row) selection.value = { table, row: Number(row) };
    });
    const poll = setInterval(() => document.visibilityState === "visible" && void refreshCatalogue(), POLL);

    const stopUrl = effect(() => {
      const s = selection.value;
      const p = new URLSearchParams({ b: bundleName.value, e: String(eventIndex.value), v: view.value, ...(s ? { s: `${s.table}:${s.row}` } : {}) });
      if (bundleName.value) history.replaceState(null, "", `#${p}`);
    });

    const onKey = (e: KeyboardEvent) => {
      if (["SELECT", "INPUT"].includes((e.target as HTMLElement).tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "p" || e.key === "P") return toggleTour();
      stopTour(); // any other key takes over from the tour
      if (e.key === "Escape") { if (dialog.value) dialog.value = null; else selection.value = null; }
      else if (e.key === "?") dialog.value = dialog.value ? null : "help";
      else if (e.key === "ArrowRight") showEvent(eventIndex.value + 1);
      else if (e.key === "ArrowLeft") showEvent(eventIndex.value - 1);
      else if (VIEW_KEYS[e.key]) view.value = VIEW_KEYS[e.key];
      else if (e.key === "f" || e.key === "F") engine?.frame(highlight.value ?? undefined, true);
      else if (e.key === "Home") engine?.frame(undefined, true);
      else if (e.key === "r" || e.key === "R") void replayEvent();
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file) openBundle(file.name, async () => blobSource(file));
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener("keydown", onKey);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    return () => { clearInterval(poll); stopUrl(); window.removeEventListener("keydown", onKey); window.removeEventListener("drop", onDrop); window.removeEventListener("dragover", onDragOver); };
  }, []);

  return (
    <div class="app">
      <Header />
      <Sidebar />
      <main><Viewport /><Inspector /></main>
      {dialog.value === "help" && <HelpDialog />}
      <Toasts />
    </div>
  );
}

function HelpDialog() {
  const rows: [string, string][] = [
    ["Rotate", "drag"], ["Pan", "right-drag (or shift + drag)"], ["Zoom", "scroll, towards the cursor"],
    ["Inspect an object", "click it; its related objects stay highlighted"], ["Zoom to an object", "double-click it, or F"],
    ["Show everything", "Home, or Reset"], ["Previous / next event", "← / →, or the arrows at the top"],
    ["Views: 3D, front, side, ρ–z", "1, 2, 3, 4"], ["Clear selection, close dialogs", "Esc"], ["Open a local .evdb file", "drop it on the page"], ["Live: play new data as it arrives", "the Live button"], ["Resize the side panel", "drag its edge; double-click to reset"],
    ["Replay: hits, then clusters, then showers, building up outwards", "R, or the lightning button"],
    ["Tour: replay and orbit, visit the main showers, next event", "P, or the play button; any key or touch stops it"],
    ["Your own columns and filters", "Columns tab and Cuts tab; colour by any column from the Layers tab"],
  ];
  return (
    <Modal title="How to use the event display">
      <table class="kv"><tbody>{rows.map(([what, how]) => <tr><td>{what}</td><td>{how}</td></tr>)}</tbody></table>
      <h3>Colours</h3>
      <p class="hint">Rechits: energy, light (low) to dark red (high). Tracksters: one colour each. Layer clusters: the colour of their
        trackster; small grey dots belong to none. With something selected, everything unrelated fades.</p>
      <h3>Cuts</h3>
      <p class="hint">The Cuts tab sets minimum energies. Each cut applies to every layer of its kind, so SoA and legacy objects are
        always compared with the same selection.</p>
      <h3>Sharing</h3>
      <p class="hint">The address bar keeps the data set, event, view and selection; the share button copies it.</p>
    </Modal>
  );
}
