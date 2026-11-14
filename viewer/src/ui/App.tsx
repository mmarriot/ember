// The page: its layout, and what it does as a whole. It opens the data set its address names (or the site's newest
// one), keeps the address and the tab's title in step with what is shown, keeps the lists of data sets current,
// answers the keyboard, and opens a file dropped on it.
//
// How the components read the state (model/store.ts), here and in every file of ui/: a component that reads a
// signal's `.value` while it renders is rendered again whenever that signal changes. Event handlers and effects read
// `.peek()` where they must not depend on a signal, and assign `.value` to change it, which updates every reader.
import { effect, signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { ViewName } from "../render/engine";
import { startDomain } from "../model/domains";
import { loadIdentity, loadRecent, mine, pruneRecent, refreshMine } from "../model/library";
import {
  activeMode,
  anchor,
  bundle,
  bundleName,
  catalogue,
  colourChoice,
  dialog,
  domain,
  event,
  eventIndex,
  focusLevel,
  highlight,
  labelsOn,
  openBundle,
  opened,
  opening,
  openLocal,
  refreshCatalogue,
  selection,
  shownEntry,
  shownLevel,
  solo,
  soloKey,
  started,
  stepEvent,
  stepFocusLevel,
  truthColours,
  unlook,
  view,
} from "../model/store";
import { chooserOpen } from "./Chooser";
import { Header } from "./Header";
import { HelpDialog } from "./Help";
import { Popover, popover } from "./Info";
import { Navigator } from "./Navigator";
import { menuOpen } from "./Menu";
import { Sidebar } from "./Sidebar";
import { DropHint, Start } from "./Start";
import { back, chooseDomain, cross, nextDomain, nextObject, showWhole } from "./navigate";
import { stopLive } from "./live";
import { stopTour, toggleTour } from "./tour";
import { engine, replayEvent } from "./scene";
import { Viewport } from "./Viewport";
import { Toasts } from "./widgets";

const VIEW_KEYS: Record<string, ViewName> = { "1": "3d", "2": "front", "3": "side", "4": "rz" };
const ALL = "All"; // the address's name for everything (domain null), in a bundle that opens on a domain
const POLL = 30_000; // ms between checks of the site's lists of data sets: two small requests each time
const NAME = "Event display";

/** A file is being dragged over the page. */
const dropping = signal(false);
/** The data set named by the address the page was opened with, until its event, view and selection are applied. */
const restoring = signal<string | null>(null);

export function App() {
  useEffect(() => {
    openFromAddress();
    const stops = [keepListsCurrent(), writeTitle(), writeAddress(), listenForKeys(), listenForDrops()];
    return () => stops.forEach((stop) => stop());
  }, []);

  return (
    <div class={bundle.value ? "app" : "app nodata"}>
      <Header />
      <Sidebar />
      <main>
        <Viewport />
        <Start />
        <Navigator />
      </main>
      {dialog.value === "help" && <HelpDialog />}
      <Popover />
      <Toasts />
      {dropping.value && <DropHint />}
    </div>
  );
}

/** Open what the page's address names, with its event, view, selection and colours. The state is in the hash
 *  (#b=…&e=…); an address written as a query (?b=…&e=…) works too. `e` is the event's place in the file, from 0 (the
 *  top bar counts from 1: "2 of 50"), not its event number (the "Event…" box takes that). */
function openFromAddress() {
  const url = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));

  // Who the page is for, and their files, are asked for at once, in the background; a linked data set does not wait
  // for them. A bare address opens the site's newest shared data set as soon as the site's list is in. Only a site
  // without shared data sets waits to know who I am, to open my newest file (whoami has a time limit: library.ts).
  loadRecent();
  const shared = refreshCatalogue(),
    own = loadIdentity().then(() => refreshMine());
  const linked = url.get("b") || null; // "b=" names nothing
  restoring.value = linked;

  (linked ? Promise.resolve() : shared.then(() => (catalogue.value.bundles.length ? undefined : own)))
    .then(async () => {
      const name = linked ?? catalogue.value.bundles[0]?.file ?? mine.value[0]?.file;
      started.value = true;
      // The address's view, selection and colours are for its data set, once its event is on screen. Another data set
      // chosen while the link's was on its way wins: openBundle then returns false (store.ts).
      if (!name || !(await openBundle(name, undefined, Number(url.get("e") ?? 0))) || !linked) return;

      const d = url.get("d"); // "All": everything, in a bundle that opens on a domain
      if (d) chooseDomain(d === ALL ? null : d, false);
      const v = url.get("v") as ViewName | null;
      if (v && Object.values(VIEW_KEYS).includes(v)) view.value = v;
      const only = url.get("only"); // one kind alone
      if (only && bundle.peek()?.header.display.some((l) => soloKey(l) === only)) solo.value = only;
      // A link made before the data set was converted again may name a row that no longer exists.
      const [table, row] = (url.get("s") ?? "").split(":");
      if (table && row && Number(row) < (event.peek()?.tables[table]?.n ?? 0))
        selection.value = { table, row: Number(row) };
      if (url.get("c") === "truth" && truthColours.peek()) colourChoice.value = "truth";
      const lv = url.get("lv");
      if (lv && selection.peek()) focusLevel.value = lv; // a level the focus does not have is ignored (store.ts shownLevel)
    })
    .finally(() => (restoring.value = null));
}

/** Keep the lists of data sets current: the site's and mine every POLL ms while the page is visible, the recent ones
 *  when another tab changes them, and the recent ones pruned of files that are gone. Returns the function that stops. */
function keepListsCurrent() {
  const poll = setInterval(() => {
    if (document.visibilityState === "visible") {
      void refreshCatalogue();
      void refreshMine();
    }
  }, POLL);
  const onStorage = (e: StorageEvent) => {
    if (e.key === "evd.recent") loadRecent(); // another tab opened or forgot one
  };
  window.addEventListener("storage", onStorage);
  const stopPruning = effect(() => pruneRecent([...catalogue.value.bundles, ...mine.value].map((x) => x.file)));
  return () => {
    clearInterval(poll);
    window.removeEventListener("storage", onStorage);
    stopPruning();
  };
}

/** Name the browser tab after the data set and event shown, so that tabs of several can be told apart. */
function writeTitle() {
  return effect(() => {
    const o = opened.value,
      e = shownEntry.value;
    document.title = o ? `${o.title}${e ? ` · event ${e.event}` : ""} – ${NAME}` : NAME;
  });
}

/** Keep the address in step with what is shown, so that it is always a link to this view (the share button copies
 *  it): data set, event, view, domain, selection and its level, truth colours and the kind drawn alone. */
function writeAddress() {
  return effect(() => {
    const s = selection.value,
      d = domain.value ?? (startDomain(bundle.value?.header) ? ALL : null),
      lv = s && shownLevel.value;
    const p = new URLSearchParams({
      b: bundleName.value,
      e: String(eventIndex.value),
      v: view.value,
      ...(d ? { d } : {}),
      ...(s ? { s: `${s.table}:${s.row}` } : {}),
      ...(lv ? { lv } : {}),
      ...(activeMode.value === "truth" ? { c: "truth" } : {}),
      ...(solo.value ? { only: solo.value } : {}),
    });

    // A link being opened stays in the address until its event, view and selection are applied. Written earlier, the
    // address would say e=0 and the default view while the link's event is read, and a reload (or "Reload the page"
    // after a link that failed) would open that instead. Another data set chosen meanwhile ends the wait.
    const link = restoring.value,
      held =
        link !== null &&
        (opening.value === link || (opening.value === null && (!bundleName.value || bundleName.value === link)));
    if (held) return;

    // A local file has no address: a link to it would open nothing, not even for me after a reload.
    if (opened.value?.local) history.replaceState(null, "", location.pathname + location.search);
    // "/" and ":" may stand as they are in a fragment: the link reads b=data/u/alice/x.evdb, not b=data%2Fu%2F…
    else if (bundleName.value) history.replaceState(null, "", `#${p}`.replace(/%2F/g, "/").replace(/%3A/g, ":"));
  });
}

/** The keyboard shortcuts (the help dialog lists them). Not while typing in a field, nor with Ctrl, Cmd or Alt. */
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && popover.value) return void (popover.value = null); // also from a control in it (a cut's slider)
  if (["SELECT", "INPUT"].includes((e.target as HTMLElement).tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "p" || e.key === "P") return toggleTour();
  stopTour(); // any other key takes over from the tour

  if (e.key === "Escape") {
    // Close what is open; else back to the normal view: no selection, the whole event.
    if (chooserOpen.value) chooserOpen.value = false;
    else if (menuOpen.value) menuOpen.value = false;
    else if (dialog.value) dialog.value = null;
    else if (anchor.value)
      unlook(); // back to the card's own object
    else {
      selection.value = null;
      showWhole(true);
    }
  } else if (e.key === "?") dialog.value = dialog.value ? null : "help";
  else if (e.key === "ArrowRight") stepEvent(1);
  else if (e.key === "ArrowLeft") stepEvent(-1);
  else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && stepFocusLevel(e.key === "ArrowDown" ? 1 : -1))
    e.preventDefault();
  else if (VIEW_KEYS[e.key]) view.value = VIEW_KEYS[e.key];
  else if (e.key === "d" || e.key === "D") nextDomain(e.shiftKey ? -1 : 1);
  else if ((e.key === "t" || e.key === "T") && truthColours.value)
    colourChoice.value = colourChoice.value === "truth" ? "reco" : "truth";
  else if (e.key === "f" || e.key === "F") engine?.frame(highlight.value ?? undefined, true);
  else if (e.key === "l" || e.key === "L") labelsOn.value = !labelsOn.value;
  else if (e.key === "n" || e.key === "N") nextObject(e.shiftKey ? -1 : 1);
  else if (e.key === "x" || e.key === "X") cross();
  else if (e.key === "b" || e.key === "B") back();
  else if (e.key === "Home") showWhole();
  else if (e.key === "r" || e.key === "R") void replayEvent();
}

function listenForKeys() {
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

/** A file dragged over the page: say that it can be dropped, until it is dropped (then open it) or leaves. `depth`
 *  counts the elements the drag is over, as enter and leave fire for every element crossed. */
function listenForDrops() {
  let depth = 0;
  const files = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth = 0;
    dropping.value = false;
    const file = e.dataTransfer?.files[0];
    if (file) {
      stopLive();
      void openLocal(file);
    }
  };
  const onDragOver = (e: DragEvent) => e.preventDefault();
  const onDragEnter = (e: DragEvent) => {
    if (files(e) && ++depth === 1) dropping.value = true;
  };
  const onDragLeave = (e: DragEvent) => {
    if (files(e) && --depth <= 0) {
      depth = 0;
      dropping.value = false;
    }
  };
  window.addEventListener("drop", onDrop);
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("dragenter", onDragEnter);
  window.addEventListener("dragleave", onDragLeave);
  return () => {
    window.removeEventListener("drop", onDrop);
    window.removeEventListener("dragover", onDragOver);
    window.removeEventListener("dragenter", onDragEnter);
    window.removeEventListener("dragleave", onDragLeave);
  };
}
