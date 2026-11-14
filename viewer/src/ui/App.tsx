// Page layout, start-up (bundle list, URL state), keyboard shortcuts, help dialog and drag-and-drop.
import { effect, signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { ViewName } from "../render/engine";
import { startDomain } from "../model/domains";
import { loadIdentity, loadRecent, mine, pruneRecent, PUBLISH_COMMAND, refreshMine } from "../model/library";
import { activeMode, anchor, bundle, bundleName, catalogue, colourChoice, dialog, domain, event, eventIndex, focusLevel, highlight, labelsOn, openBundle, opened, opening, openLocal, refreshCatalogue, selection, shownEntry, shownLevel, solo, soloKey, started, stepEvent, stepFocusLevel, truthColours, unlook, view } from "../model/store";
import { chooserOpen } from "./Chooser";
import { SYNTAX } from "./ExprForm";
import { Header } from "./Header";
import { Popover, popover } from "./Info";
import { Navigator } from "./Navigator";
import { menuOpen } from "./Menu";
import { Sidebar } from "./Sidebar";
import { DropHint, Start } from "./Start";
import { back, chooseDomain, cross, nextDomain, nextObject, showWhole } from "./navigate";
import { stopLive } from "./live";
import { stopTour, toggleTour } from "./tour";
import { engine, replayEvent, Viewport } from "./Viewport";
import { Modal, Toasts } from "./widgets";

const VIEW_KEYS: Record<string, ViewName> = { "1": "3d", "2": "front", "3": "side", "4": "rz" };
const ALL = "All"; // the URL's name for everything (domain null) in a bundle that opens on a domain
const POLL = 30_000; // ms between index checks (keeps the data set lists current): two small requests per page
const NAME = "Event display";
/** A file is being dragged over the page. */
const dropping = signal(false);
/** The data set named by the link the page was opened with, until its state (event, view, selection) is applied. */
const restoring = signal<string | null>(null);

export function App() {
  useEffect(() => {
    // The state is in the hash (#b=…&e=…); a link written as a query (?b=…&e=…) works too. `e` is the event's place in
    // the file, from 0 (the top bar shows it from 1: "2 of 50"), not its event number (the Event… box takes that).
    const url = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
    // Who the page is for and their files: asked for at once, in the background. A link's data set does not wait for
    // them. A bare address opens the site's newest shared data set as soon as the site's list is in; only a site
    // without one waits to know who I am, to open my newest (whoami has a time limit, library.ts).
    loadRecent();
    const shared = refreshCatalogue(), own = loadIdentity().then(() => refreshMine());
    const linked = url.get("b") || null; // "b=" names nothing
    restoring.value = linked;
    (linked ? Promise.resolve() : shared.then(() => (catalogue.value.bundles.length ? undefined : own))).then(async () => {
      const name = linked ?? catalogue.value.bundles[0]?.file ?? mine.value[0]?.file;
      started.value = true;
      // The link's view, selection and colours are for the link's data set with its event on screen: not for another
      // one chosen while it was on its way (it then changes nothing: store.ts openBundle).
      if (!name || !(await openBundle(name, undefined, Number(url.get("e") ?? 0))) || !linked) return;
      const d = url.get("d"); // "All": everything, in a bundle that opens on a domain
      if (d) chooseDomain(d === ALL ? null : d, false);
      const v = url.get("v") as ViewName | null;
      if (v && Object.values(VIEW_KEYS).includes(v)) view.value = v;
      const only = url.get("only"); // one kind alone
      if (only && bundle.peek()?.header.display.some((l) => soloKey(l) === only)) solo.value = only;
      const [table, row] = (url.get("s") ?? "").split(":");
      // A link made before the data set was re-converted may name a row that no longer exists.
      if (table && row && Number(row) < (event.peek()?.tables[table]?.n ?? 0)) selection.value = { table, row: Number(row) };
      if (url.get("c") === "truth" && truthColours.peek()) colourChoice.value = "truth";
      const lv = url.get("lv");
      if (lv && selection.peek()) focusLevel.value = lv; // a level the focus does not have is ignored (store.ts shownLevel)
    }).finally(() => (restoring.value = null));
    const onStorage = (e: StorageEvent) => { if (e.key === "evd.recent") loadRecent(); }; // another tab opened or forgot one
    const poll = setInterval(() => { if (document.visibilityState === "visible") { void refreshCatalogue(); void refreshMine(); } }, POLL);
    const stopRecent = effect(() => pruneRecent([...catalogue.value.bundles, ...mine.value].map((x) => x.file)));
    const stopTitle = effect(() => { // the tab's name: the data set and event, so tabs of several can be told apart
      const o = opened.value, e = shownEntry.value;
      document.title = o ? `${o.title}${e ? ` · event ${e.event}` : ""} – ${NAME}` : NAME;
    });

    const stopUrl = effect(() => {
      const s = selection.value, d = domain.value ?? (startDomain(bundle.value?.header) ? ALL : null), lv = s && shownLevel.value;
      const p = new URLSearchParams({ b: bundleName.value, e: String(eventIndex.value), v: view.value, ...(d ? { d } : {}), ...(s ? { s: `${s.table}:${s.row}` } : {}),
        ...(lv ? { lv } : {}), ...(activeMode.value === "truth" ? { c: "truth" } : {}), ...(solo.value ? { only: solo.value } : {}) });
      // A link being opened stays in the address until its event, view and selection are applied: written earlier, the
      // address would say e=0 and the default view while the link's event is read, and a reload (or the "reload" of a
      // link that failed) would open that instead. Another data set chosen meanwhile ends the wait.
      const link = restoring.value, held = link !== null && (opening.value === link || (opening.value === null && (!bundleName.value || bundleName.value === link)));
      if (held) return;
      // A local file has no address: a link to it would open nothing, also for me after a reload.
      if (opened.value?.local) history.replaceState(null, "", location.pathname + location.search);
      // "/" and ":" are themselves in a fragment: the link reads b=data/u/alice/x.evdb, not b=data%2Fu%2F…
      else if (bundleName.value) history.replaceState(null, "", `#${p}`.replace(/%2F/g, "/").replace(/%3A/g, ":"));
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && popover.value) return void (popover.value = null); // also from a control inside it (a cut's slider)
      if (["SELECT", "INPUT"].includes((e.target as HTMLElement).tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "p" || e.key === "P") return toggleTour();
      stopTour(); // any other key takes over from the tour
      if (e.key === "Escape") { // close a dialog; else back to the normal view: no selection, the whole event
        if (chooserOpen.value) chooserOpen.value = false;
        else if (menuOpen.value) menuOpen.value = false;
        else if (dialog.value) dialog.value = null;
        else if (anchor.value) unlook(); // back to the card's own object
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
      else if (e.key === "x" || e.key === "X") cross();
      else if (e.key === "b" || e.key === "B") back();
      else if (e.key === "Home") showWhole();
      else if (e.key === "r" || e.key === "R") void replayEvent();
    };
    // A file dragged over the page: say that it can be dropped, until it is or leaves. `depth`: enter and leave fire
    // for every element crossed.
    let depth = 0;
    const files = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      dropping.value = false;
      const file = e.dataTransfer?.files[0];
      if (file) { stopLive(); void openLocal(file); }
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDragEnter = (e: DragEvent) => { if (files(e) && ++depth === 1) dropping.value = true; };
    const onDragLeave = (e: DragEvent) => { if (files(e) && --depth <= 0) { depth = 0; dropping.value = false; } };
    window.addEventListener("keydown", onKey);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("storage", onStorage);
    return () => {
      clearInterval(poll); stopUrl(); stopRecent(); stopTitle();
      window.removeEventListener("keydown", onKey); window.removeEventListener("drop", onDrop); window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragenter", onDragEnter); window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return (
    <div class={bundle.value ? "app" : "app nodata"}>
      <Header />
      <Sidebar />
      <main><Viewport /><Start /><Navigator /></main>
      {dialog.value === "help" && <HelpDialog />}
      <Popover />
      <Toasts />
      {dropping.value && <DropHint />}
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
      [[], "click it", "Select an object: it stands out in the view, and its card shows its chain (what it is part of, what it is made of) with what the truth says at every step"],
      [[], "click again on the same spot", "Objects on top of each other: the next one"],
      [[], "click a name in the card", "Look at that object in the view; the card stays. Click another to look at that one"],
      [[], "double click a name in the card, or Open in its Looking at block", "Open that object's card"],
      [["B"], "← at the top of the card; ✕ stop while looking", "Back: to the card's object, or to the previous card"],
      [["X"], "", "Across the link: from a reco object to its truth match, from a truth particle to what was reconstructed from it"],
      [[], "i next to a title, or a tag (match, fact, derived, no truth)", "What something is, and how its numbers are counted"],
      [["↓", "↑"], "show on a step of the chain", "Draw one step of what it is made of in the view (e.g. its tracksters, then their layer clusters); a part of the detector named on a step (e.g. Tracker ›) looks there"],
      [["N", "⇧N"], "the count on a collection's row lists its largest objects", "Next / previous object of the selected kind, largest first (e.g. the next jet, the next track); with nothing selected, the leading object"],
      [["Esc"], "click on empty space", "Leave the object; Esc also shows the whole event (and closes this dialog or the menu)"],
    ]],
    ["Event and parts of the detector", [
      [["←", "→"], "the arrows at the top", "Previous / next event"],
      [["D", "⇧D"], "the Look at buttons at the top (when the data has several parts)", "One part of the detector (e.g. the tracker), or all; a selection stays selected, and D skips the parts it has nothing in"],
      [[], "only on a kind's heading in the side panel", "One kind of object alone (e.g. only the tracks, only the jets); selecting one brings its parts and its truth"],
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
    ["Data sets", [
      [[], "its name in the top bar; type to filter, ↑ ↓ and Enter to open", "Choose a data set: your own files, the ones you opened lately from links, and the site's shared ones"],
      [[], `in a CMSSW area: ${PUBLISH_COMMAND}`, "Publish a file: it is converted, listed under My files and gets a link (it is removed after a while)"],
      [[], "drop it on the page, or Open a local file… in the chooser", "Open a local .evdb file: it stays on your computer"],
      [[], "the share button", "Copy a link to this view"],
    ]],
    ["Side panel", [
      [[], "⋯ at the end of its row in the side panel", "Colour, filter or a new column for a collection"],
      [[], "drag its edge; double-click to reset", "Resize the side panel"],
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
        in Detector, which follows the bar); the truth (the event's reco ↔ truth counts, its collections, what became of each particle,
        the history as a tree); the event. A kind's heading shows its cut (e.g. pT ≥ 30 GeV): click it to change it; it applies to
        every collection of its group. A row shows the collection's state as chips: filter (click to see or remove it), selected
        (drawn only for the selected object; click for all), show (hidden while something is selected; click to draw it).</p>
      <h3>Colours</h3>
      <p class="hint">Colour means one thing at a time; the title of the key at the bottom of the side panel says which.
        <b>Reco</b>: candidates by the particle type the reconstruction gave them, and everything they are made of (tracksters, layer
        clusters, hits, tracks) in the same colour. <b>Truth</b> (T): everything by the generator particle it comes from, the same in
        every part of the detector (a conversion's electrons and an interacting pion's daughters take their particle's colour); a reco
        object takes its particle's colour only where it is a clean match (e.g. 75% of a track's hits), else grey. Selecting anything
        shows its truth ↔ reco pair: a generator particle and its best candidate, every hit coloured shared, contamination, split off or
        missed, with the particle's completeness and the candidate's purity as bars in its card. Each step of the card's chain says
        what the truth graph has for it: match (the CMSSW associator's, with its purity), fact (simulated energy per particle in its hits),
        derived (worked out in evd) or no truth for that kind yet. A dot on an object's name says what the associator found for it:
        green for a clean match, half amber for an impure one, hollow for none. The Truth tab counts, for each matched kind, the clean, impure and
        unmatched objects of the event. Truth is drawn dashed.
        ⋯ on a row colours it by any column, or by the colour of a related object, instead. With something selected, everything
        unrelated fades.</p>
      <h3>Expressions</h3>
      <p class="hint">A filter or a new column (⋯ on a row) is an expression of the table's columns: {SYNTAX}. A filter hides the rows where
        it is 0; a new column is shown in the object's card and can colour or filter.</p>
      <h3>Sharing</h3>
      <p class="hint">The share button copies a link to what is on screen: the data set, event, view, part of the detector, a kind looked
        at alone, the selection with the level shown, and the truth colours (the address bar always holds it). Anyone who can open this
        site can open the link, also for a file someone else published; it works while the file is on the site. A local file has no
        link: publish it with <code>{PUBLISH_COMMAND}</code>.</p>
    </Modal>
  );
}
