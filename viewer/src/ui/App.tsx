// Page layout, start-up (bundle list, URL state), keyboard shortcuts, help dialog and drag-and-drop.
import { effect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { blobSource } from "../io/bundle";
import type { ViewName } from "../render/engine";
import { startDomain } from "../model/domains";
import { activeMode, bundle, bundleName, catalogue, colourChoice, dialog, domain, event, eventIndex, focusLevel, highlight, labelsOn, openBundle, refreshCatalogue, selection, shownLevel, stepEvent, stepFocusLevel, truthColours, view } from "../model/store";
import { SYNTAX } from "./ExprForm";
import { Header } from "./Header";
import { Inspector } from "./Inspector";
import { menuOpen } from "./Menu";
import { Sidebar } from "./Sidebar";
import { chooseDomain, nextDomain, nextObject, showWhole } from "./navigate";
import { stopTour, toggleTour } from "./tour";
import { engine, replayEvent, Viewport } from "./Viewport";
import { Modal, Toasts } from "./widgets";

const VIEW_KEYS: Record<string, ViewName> = { "1": "3d", "2": "front", "3": "side", "4": "rz" };
const ALL = "All"; // the URL's name for everything (domain null) in a bundle that opens on a domain
const POLL = 30_000; // ms between index.json checks (keeps the data set list current): one small request per page

export function App() {
  useEffect(() => {
    // The state is in the hash (#b=…&e=…); a link written as a query (?b=…&e=…) works too. `e` is the event's place in
    // the file, from 0 (the top bar shows it from 1: "2 of 50"), not its event number (the Event… box takes that).
    const url = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
    refreshCatalogue().then(async () => {
      const name = url.get("b") ?? catalogue.value.bundles[0]?.file;
      if (!name) return;
      await openBundle(name, undefined, Number(url.get("e") ?? 0));
      const d = url.get("d"); // "All": everything, in a bundle that opens on a domain
      if (d) chooseDomain(d === ALL ? null : d, false);
      const v = url.get("v") as ViewName | null;
      if (v && Object.values(VIEW_KEYS).includes(v)) view.value = v;
      const [table, row] = (url.get("s") ?? "").split(":");
      // A link made before the data set was re-converted may name a row that no longer exists.
      if (table && row && Number(row) < (event.peek()?.tables[table]?.n ?? 0)) selection.value = { table, row: Number(row) };
      if (url.get("c") === "truth" && truthColours.peek()) colourChoice.value = "truth";
      const lv = url.get("lv");
      if (lv && selection.peek()) focusLevel.value = lv; // a level the focus does not have is ignored (store.ts shownLevel)
    });
    const poll = setInterval(() => document.visibilityState === "visible" && void refreshCatalogue(), POLL);

    const stopUrl = effect(() => {
      const s = selection.value, d = domain.value ?? (startDomain(bundle.value?.header) ? ALL : null), lv = s && shownLevel.value;
      const p = new URLSearchParams({ b: bundleName.value, e: String(eventIndex.value), v: view.value, ...(d ? { d } : {}), ...(s ? { s: `${s.table}:${s.row}` } : {}),
        ...(lv ? { lv } : {}), ...(activeMode.value === "truth" ? { c: "truth" } : {}) });
      if (bundleName.value) history.replaceState(null, "", `#${p}`);
    });

    const onKey = (e: KeyboardEvent) => {
      if (["SELECT", "INPUT"].includes((e.target as HTMLElement).tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "p" || e.key === "P") return toggleTour();
      stopTour(); // any other key takes over from the tour
      if (e.key === "Escape") { // close a dialog; else back to the normal view: no selection, the whole event
        if (menuOpen.value) menuOpen.value = false;
        else if (dialog.value) dialog.value = null;
        else { selection.value = null; showWhole(true); }
      }
      else if (e.key === "?") dialog.value = dialog.value ? null : "help";
      else if (e.key === "ArrowRight") stepEvent(1);
      else if (e.key === "ArrowLeft") stepEvent(-1);
      else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && stepFocusLevel(e.key === "ArrowDown" ? 1 : -1)) e.preventDefault();
      else if (VIEW_KEYS[e.key]) view.value = VIEW_KEYS[e.key];
      else if (e.key === "d" || e.key === "D") nextDomain(e.shiftKey ? -1 : 1);
      else if ((e.key === "t" || e.key === "T") && truthColours.value) colourChoice.value = colourChoice.value === "truth" ? "reco" : "truth";
      else if (e.key === "f" || e.key === "F") engine?.frame(highlight.value ?? undefined, true);
      else if (e.key === "l" || e.key === "L") labelsOn.value = !labelsOn.value;
      else if (e.key === "n" || e.key === "N") nextObject(e.shiftKey ? -1 : 1);
      else if (e.key === "Home") showWhole();
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
  // The tab with the object rows: the shared domain's (e.g. Physics), named as the bundle names it.
  const h = bundle.value?.header, listTab = h?.domains?.find((d) => d.shared && h.display.some((l) => l.list && l.domain === d.name))?.name;
  // Grouped as the menu is; each row: its keys, the mouse or button that does it too, what it does.
  const groups: [string, [string[], string, string][]][] = [
    ["Look around", [
      [[], "drag", "Rotate"], [[], "right-drag, or shift + drag", "Pan"], [[], "scroll", "Zoom, towards the cursor"],
      [["1", "2", "3", "4"], "the view buttons (at the bottom left of the view with parts of the detector, else in the top bar)", "Views: 3D, front, side, ρ–z"],
      [["F"], "double-click it", "Zoom to the selection"], [["Home"], "the reset button", "Show the whole event"],
    ]],
    ["Select and explore", [
      [[], "click it", "Inspect an object: it is shown with its smallest parts (e.g. hits), and further clicks pick among its parts"],
      [[], "click again on the same spot", "Objects on top of each other: the next one"],
      [["↓", "↑"], "click a level in the bar at the top left of the view", "See what it is made of, level by level (e.g. its tracksters, then their layer clusters); a part of the detector named there (e.g. Calo 9) shows its objects in that part"],
      [["N", "⇧N"], "", "Next / previous object of the selected kind, largest first (e.g. the next jet); with nothing selected, the leading object"],
      [[], "click it in the inspector or the tree, or an object linked to the one shown", "Go to a related object (e.g. its truth-graph particle)"],
      [[], "← in the bar at the top left of the view", "Back to the previous object"],
      [["Esc"], "click on empty space", "Leave the object; Esc also shows the whole event (and closes this dialog or the menu)"],
    ]],
    ["Event and parts of the detector", [
      [["←", "→"], "the arrows at the top", "Previous / next event"],
      [["D", "⇧D"], "the Look at buttons at the top (when the data has several parts)", "One part of the detector (e.g. the tracker), or all; a selection stays selected, and D skips the parts it has nothing in"],
    ]],
    ["Colours and labels", [
      [["T"], "Reco · Truth in the colour key or the menu", "Colours: what the reconstruction made, or what was really there"],
      [["L"], `pointing at an object's row in ${listTab ? `the ${listTab} tab` : "the side panel"} rings it in the view`, "Labels on the leading objects and the selection"],
    ]],
    ["Play", [
      [["R"], "", "Replay: how the event builds up, step by step"],
      [["P"], "the play button; any key or touch stops it", "Tour: each event built up step by step, out from the collision point and from hits to physics objects, then its leading objects"],
      [[], "the Live button", "Live: play new data as it arrives"],
    ]],
    ["Side panel and files", [
      [[], "⋯ at the end of its row in the side panel", "Colour, filter or a new column for a collection"],
      [[], "drop it on the page", "Open a local .evdb file"], [[], "drag its edge; double-click to reset", "Resize the side panel"],
      [[], "Menu in the top bar", "Every control and its key, in one place"],
    ]],
  ];
  return (
    <Modal title="How to use the event display">
      {groups.map(([name, rows]) => (
        <>
          <h3>{name}</h3>
          <table class="kv keys"><tbody>{rows.map(([keys, mouse, what]) => (
            <tr><td>{keys.map((k) => <kbd>{k}</kbd>)}</td><td>{what}{mouse && <span class="muted"> · {mouse}</span>}</td></tr>
          ))}</tbody></table>
        </>
      ))}
      <h3>Side panel</h3>
      <p class="hint">One tab per part of the detector with its collections, by kind of object (with a domain bar: the physics objects in
        their own tab, with the event's headline and each kind's largest objects, a click selecting one; the parts of the detector
        in Detector, which follows the bar); the truth (its collections, what became of each particle, the history as a tree); the
        event. Each cut slider sits just before the first collection it applies to and applies to every layer of its group, so the
        same objects from different reconstruction paths always get the same selection.</p>
      <h3>Colours</h3>
      <p class="hint">Colour means one thing at a time; the title of the key at the bottom of the side panel says which.
        <b>Reco</b>: candidates by the particle type the reconstruction gave them, and everything they are made of (tracksters, layer
        clusters, hits, tracks) in the same colour. <b>Truth</b> (T): everything by the generator particle it comes from, the same in
        every part of the detector (a conversion's electrons and an interacting pion's daughters take their particle's colour); a reco
        object takes its particle's colour only where it is a clean match (e.g. 75% of a track's hits), else grey. Selecting anything
        shows its truth ↔ reco pair: a generator particle and its best candidate, every hit coloured shared, contamination, split off or
        missed, with the particle's completeness and the candidate's purity in the key. The inspector says what each reco kind
        reconstructs, how pure and complete its match is, and where its particle sits in the truth graph. Truth is drawn dashed.
        ⋯ on a row colours it by any column, or by the colour of a related object, instead. With something selected, everything
        unrelated fades.</p>
      <h3>Expressions</h3>
      <p class="hint">A filter or a new column (⋯ on a row) is an expression of the table's columns: {SYNTAX}. A filter hides the rows where
        it is 0; a new column is shown in the inspector and can colour or filter.</p>
      <h3>Sharing</h3>
      <p class="hint">The address bar keeps the data set, event, view, part of the detector, selection, the level shown and the truth
        colours; the share button copies it.</p>
    </Modal>
  );
}
