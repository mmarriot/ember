// Page layout, start-up (bundle list, URL state), keyboard shortcuts, help dialog and drag-and-drop.
import { effect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { blobSource } from "../io/bundle";
import type { ViewName } from "../render/engine";
import { bundleName, catalogue, dialog, domain, event, eventIndex, highlight, openBundle, refreshCatalogue, selection, showEvent, stepFocusLevel, view } from "../model/store";
import { SYNTAX } from "./ExprForm";
import { Header } from "./Header";
import { Inspector } from "./Inspector";
import { Sidebar } from "./Sidebar";
import { chooseDomain, nextDomain } from "./navigate";
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
      await openBundle(name, undefined, Number(url.get("e") ?? 0));
      const d = url.get("d");
      if (d) chooseDomain(d, false);
      const v = url.get("v") as ViewName | null;
      if (v && Object.values(VIEW_KEYS).includes(v)) view.value = v;
      const [table, row] = (url.get("s") ?? "").split(":");
      // A link made before the data set was re-converted may name a row that no longer exists.
      if (table && row && Number(row) < (event.peek()?.tables[table]?.n ?? 0)) selection.value = { table, row: Number(row) };
    });
    const poll = setInterval(() => document.visibilityState === "visible" && void refreshCatalogue(), POLL);

    const stopUrl = effect(() => {
      const s = selection.value, d = domain.value;
      const p = new URLSearchParams({ b: bundleName.value, e: String(eventIndex.value), v: view.value, ...(d ? { d } : {}), ...(s ? { s: `${s.table}:${s.row}` } : {}) });
      if (bundleName.value) history.replaceState(null, "", `#${p}`);
    });

    const onKey = (e: KeyboardEvent) => {
      if (["SELECT", "INPUT"].includes((e.target as HTMLElement).tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "p" || e.key === "P") return toggleTour();
      stopTour(); // any other key takes over from the tour
      if (e.key === "Escape") { // close a dialog; else back to the normal view: no selection, the whole event
        if (dialog.value) dialog.value = null;
        else { selection.value = null; engine?.home(); }
      }
      else if (e.key === "?") dialog.value = dialog.value ? null : "help";
      else if (e.key === "ArrowRight") showEvent(eventIndex.value + 1);
      else if (e.key === "ArrowLeft") showEvent(eventIndex.value - 1);
      else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && stepFocusLevel(e.key === "ArrowDown" ? 1 : -1)) e.preventDefault();
      else if (VIEW_KEYS[e.key]) view.value = VIEW_KEYS[e.key];
      else if (e.key === "d" || e.key === "D") nextDomain();
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
    ["Inspect an object", "click it: it is shown with its smallest parts (e.g. hits), and further clicks pick among its parts"],
    ["See what it is made of, level by level", "↓ / ↑, or click a level in the bar at the top left of the view (e.g. its tracksters, then their layer clusters)"],
    ["Objects on top of each other", "click again on the same spot for the next one"],
    ["Go to a related object", "click it in the inspector or the tree, or click an object linked to the one shown (e.g. its truth-graph particle)"],
    ["Back to the previous object", "← in the bar at the top left of the view"],
    ["Zoom to the selection", "double-click it, or F"], ["Show the whole event", "Home, or the reset button"],
    ["Leave the object", "click on empty space; Esc also shows the whole event (and closes this dialog)"],
    ["Previous / next event", "← / →, or the arrows at the top"], ["Views: 3D, front, side, ρ–z", "1, 2, 3, 4"],
    ["One part of the detector (e.g. the tracker), or all", "D, or the All · … buttons at the top (when the data has several parts)"],
    ["Replay: how the event builds up, step by step", "R"],
    ["Tour: replay, then visit the main showers, event after event", "P, or the play button; any key or touch stops it"],
    ["Live: play new data as it arrives", "the Live button"],
    ["Colour, filter or a new column for a collection", "⋯ at the end of its row in the side panel"],
    ["Open a local .evdb file", "drop it on the page"], ["Resize the side panel", "drag its edge; double-click to reset"],
  ];
  return (
    <Modal title="How to use the event display">
      <table class="kv"><tbody>{rows.map(([what, how]) => <tr><td>{what}</td><td>{how}</td></tr>)}</tbody></table>
      <h3>Side panel</h3>
      <p class="hint">One tab per part of the detector with its collections, by kind of object; the truth (its collections, what became
        of each particle, the history as a tree); the event. Each cut slider sits with the first kind it applies to and applies to
        every layer of its group, so the same objects from different reconstruction paths always get the same selection.</p>
      <h3>Colours</h3>
      <p class="hint">With candidates in the data, they are coloured by particle type and everything they are made of (tracksters, layer
        clusters, hits, tracks) takes the same colour; the key is at the bottom of the side panel. Selecting anything then shows its
        truth ↔ reco pair: a truth-graph particle and its best candidate, with every hit coloured matched, contamination, split or
        missed, and the particle's efficiency and the candidate's purity in the key. Without candidates, each collection shows its own
        colours under its row. ⋯ on a row colours it by any column, or by the colour of a related object, instead.
        With something selected, everything unrelated fades.</p>
      <h3>Expressions</h3>
      <p class="hint">A filter or a new column (⋯ on a row) is an expression of the table's columns: {SYNTAX}. A filter hides the rows where
        it is 0; a new column is shown in the inspector and can colour or filter.</p>
      <h3>Sharing</h3>
      <p class="hint">The address bar keeps the data set, event, view and selection; the share button copies it.</p>
    </Modal>
  );
}
