// The page: its layout, opening what the address names, keeping the address and tab title in step with the view,
// the keyboard shortcuts and file drops.
//
// How every component in ui/ reads the state (model/store/): reading a signal's `.value` while rendering subscribes
// the component to it. Handlers and effects read `.peek()` where they must not subscribe, and assign `.value`.
import { batch, effect, signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { ViewName } from "../io/format";
import { startDomain } from "../model/event/domains";
import { readLink, writeLink } from "../model/site/link";
import { loadIdentity, loadRecent, mine, pruneRecent, refreshMine } from "../model/site/library";
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
  focus,
  focusLevel,
  labelsOn,
  setRest,
  layerOf,
  openBundle,
  opened,
  opening,
  openLocal,
  refreshCatalogue,
  selection,
  shownEntry,
  shownLevel,
  lookAlone,
  solo,
  soloKey,
  started,
  stepEvent,
  stepFocusLevel,
  truthColours,
  truthLevel,
  unlook,
  view,
} from "../model/store";
import { COLOUR_LEVELS } from "../model/truth/truth";
import {
  back,
  chooseDomain,
  cross,
  crossChoices,
  frameFocus,
  nextDomain,
  nextObject,
  showWhole,
} from "../control/navigate";
import { replayEvent } from "../control/scene";
import { stopTour, toggleTour } from "../control/tour";
import { Card } from "./card/Card";
import { Popover, popover } from "./common/Info";
import { Toasts } from "./common/widgets";
import { HelpDialog } from "./dialogs/Help";
import { PictureDialog } from "./dialogs/Picture";
import { Sidebar } from "./sidebar/Sidebar";
import { DropHint, Start } from "./Start";
import { chooserOpen } from "./topbar/Chooser";
import { Header } from "./topbar/Header";
import { menuOpen } from "./topbar/Menu";
import { Viewport } from "./viewport/Viewport";

const VIEW_KEYS: Record<string, ViewName> = { "1": "3d", "2": "front", "3": "side", "4": "rz" };
const ALL = "All"; // the address's name for every domain (domain null), in a bundle that opens on one
const POLL = 30_000; // ms between refreshes of the site's lists of data sets
const NAME = "Ember";

const dropping = signal(false); // a file is being dragged over the page
/** The data set named by the page's opening address, until its event, view and selection are applied. */
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
        <Card />
      </main>
      {dialog.value === "help" && <HelpDialog />}
      {dialog.value === "picture" && <PictureDialog />}
      <Popover />
      <Toasts />
      {dropping.value && <DropHint />}
    </div>
  );
}

/** Open what the page's address names (hash #b=…&e=…, or a query ?b=…&e=…), with its event, view, selection and
 *  colours. `e` is the event's index in the file from 0, not its event number. */
function openFromAddress() {
  const link = readLink(location.hash.slice(1) || location.search.slice(1));

  // A linked data set does not wait for the login and lists. A bare address opens the site's newest shared data set;
  // only a site without any waits for whoami (time-limited, library.ts) to open my newest file.
  loadRecent();
  const shared = refreshCatalogue(),
    own = loadIdentity().then(() => refreshMine());
  const linked = link?.bundle ?? null;
  restoring.value = linked;

  (linked ? Promise.resolve() : shared.then(() => (catalogue.value.bundles.length ? undefined : own)))
    .then(async () => {
      const name = linked ?? catalogue.value.bundles[0]?.file ?? mine.value[0]?.file;
      started.value = true;
      // Applied once the event is on screen. A data set chosen meanwhile wins: openBundle returns false (store/open.ts).
      if (!name || !(await openBundle(name, undefined, link?.event ?? 0)) || !link) return;

      const { domain: d, view: v, only, selection: s0, truth, level, group } = link;
      // A link made before the data set was converted again may name a row that no longer exists.
      const s = s0 && s0.row < (event.peek()?.tables[s0.table]?.n ?? 0) ? s0 : null;
      // Without a domain, a selection opens in its own domain.
      const home = d ? (d === ALL ? null : d) : s ? layerOf(s.table)?.domain : undefined;
      if (home !== undefined) chooseDomain(home, false);
      if (v && (Object.values(VIEW_KEYS) as string[]).includes(v)) view.value = v as ViewName;
      if (only && bundle.peek()?.header.display.some((l) => soloKey(l) === only)) lookAlone(only);
      if (s) selection.value = s;
      batch(() => {
        // one rebuild of the layers for both
        if (truth && truthColours.peek()) colourChoice.value = "truth";
        truthLevel.value = COLOUR_LEVELS.find((l) => l.id === group) ?? null; // an unknown level: the profile's
      });
      if (level && selection.peek()) focusLevel.value = level; // a level the focus does not have is ignored (store/selection.ts shownLevel)
      if (s) requestAnimationFrame(() => frameFocus(0)); // beside its card, once the card is drawn (measured)
    })
    .finally(() => (restoring.value = null));
}

/** Keep the lists of data sets current: the site's and mine every POLL ms while visible, the recent ones when another
 *  tab changes them, pruned of files that are gone. Returns the function that stops it. */
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

/** Name the browser tab after the data set and event shown. */
function writeTitle() {
  return effect(() => {
    const o = opened.value,
      e = shownEntry.value;
    document.title = o ? `${o.title}${e ? ` · event ${e.event}` : ""} – ${NAME}` : NAME;
  });
}

/** Keep the address a link to this view (the share button copies it). */
function writeAddress() {
  return effect(() => {
    const s = selection.value,
      d = domain.value ?? (startDomain(bundle.value?.header) ? ALL : null),
      lv = s && shownLevel.value;
    const address = writeLink({
      bundle: bundleName.value,
      event: eventIndex.value,
      view: view.value,
      ...(d ? { domain: d } : {}),
      ...(s ? { selection: s } : {}),
      ...(lv ? { level: lv } : {}),
      truth: activeMode.value === "truth",
      ...(activeMode.value === "truth" && truthLevel.value ? { group: truthLevel.value.id } : {}),
      ...(solo.value ? { only: solo.value } : {}),
    });

    // A link being opened stays in the address until it is applied: else a reload (or "Reload the page" after a link
    // that failed) would open e=0 and the default view. Another data set chosen meanwhile ends the wait.
    const link = restoring.value,
      held =
        link !== null &&
        (opening.value === link || (opening.value === null && (!bundleName.value || bundleName.value === link)));
    if (held) return;

    // A local file has no link; the query is cleared too, or a reload would follow an old ?b=.
    if (opened.value?.local) history.replaceState(null, "", location.pathname);
    else if (bundleName.value) history.replaceState(null, "", `#${address}`);
  });
}

/** The keyboard shortcuts (Help.tsx lists them). Not while typing in a field or behind a dialog, nor with Ctrl, Cmd
 *  or Alt. */
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && popover.value) return void (popover.value = null); // also from a control in it (a cut's slider)
  if (dialog.value && e.key !== "?") return void (e.key === "Escape" && (dialog.value = null));
  if (["SELECT", "INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName) || e.ctrlKey || e.metaKey || e.altKey)
    return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key; // a letter in either case
  if (key === "p") return toggleTour();
  stopTour(); // any other key takes over from the tour

  switch (key) {
    case "Escape":
      // Close what is open (the chooser, X's chooser in the card, the menu); else stop looking at another object
      // than the card's; else leave the selection and show the whole event.
      if (chooserOpen.value) chooserOpen.value = false;
      else if (crossChoices.value) crossChoices.value = null;
      else if (menuOpen.value) menuOpen.value = false;
      else if (anchor.value) unlook();
      else {
        selection.value = null;
        showWhole(true);
      }
      break;
    case "?":
      dialog.value = dialog.value ? null : "help";
      break;
    case "ArrowRight":
    case "ArrowLeft":
      stepEvent(key === "ArrowRight" ? 1 : -1);
      break;
    case "ArrowDown":
    case "ArrowUp":
      if (stepFocusLevel(key === "ArrowDown" ? 1 : -1)) e.preventDefault();
      break;
    case "d":
      nextDomain(e.shiftKey ? -1 : 1);
      break;
    case "t":
      if (truthColours.value) colourChoice.value = colourChoice.value === "truth" ? "reco" : "truth";
      break;
    case "f":
      frameFocus();
      break;
    case "l":
      labelsOn.value = !labelsOn.value;
      break;
    case "h":
      if (focus.value) setRest();
      break;
    case "n":
      nextObject(e.shiftKey ? -1 : 1);
      break;
    case "x":
      cross();
      break;
    case "b":
      back();
      break;
    case "Home":
      showWhole();
      break;
    case "r":
      void replayEvent();
      break;
    default:
      if (VIEW_KEYS[key]) view.value = VIEW_KEYS[key];
  }
}

function listenForKeys() {
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

/** A file dragged over the page: show the drop hint until it is dropped (then open it) or leaves. `depth` counts the
 *  elements the drag is over, as enter and leave fire for every element crossed. */
function listenForDrops() {
  let depth = 0;
  const files = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth = 0;
    dropping.value = false;
    const file = e.dataTransfer?.files[0];
    if (file) {
      stopTour();
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
