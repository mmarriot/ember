// Opening a data set and moving between its events: the site's list of data sets, the open in progress and why one
// failed, and the actions that set data.ts's signals (openBundle, showEvent). Opens and event reads may overlap; the
// last one asked for always wins.
import { batch, computed, signal } from "@preact/signals";
import { around, blobSource, Bundle, HttpError, httpSource, type Source } from "../../io/bundle";
import { type DisplayLayer, type EventData, REPRS } from "../../io/format";
import { loadCustom } from "../custom";
import { startDomain } from "../domains";
import {
  cleanList,
  describeFailure,
  type Failure,
  forgetRecent,
  type Listed,
  locate,
  mine,
  NameError,
  noteRecent,
  ownerOf,
  readIndex,
  titleOf,
} from "../library";
import { colourChoice } from "./colours";
import { bundle, bundleName, eventIndex, loadMs, loading, rawEvent, shownOf } from "./data";
import { layerKey } from "./names";
import { selection } from "./selection";
import { cutGroups, cuts, domain, hover, openTab, showAll, solo, tabOfDomain, toast, view, visible } from "./view";

export type { Listed };

// ---- The data sets

/** The site's shared data sets (index.json), newest data first: test stands, reference samples. A person's own are
 *  in `mine` (library.ts). */
export const catalogue = signal<{ bundles: Listed[]; updated?: string }>({ bundles: [] });

/** The data set open: its title and its entry in a list where one has it (the site's, mine, or its owner's). `local`:
 *  a file from this computer, which no link can reach. `external`: an address on another site, about which this
 *  site's lists, publishers and expiry say nothing. */
export interface Opened {
  file: string;
  title: string;
  local: boolean;
  external: boolean;
  entry?: Listed;
}
/** How `bundleName` was opened (set with it, in one batch). `theirs`: its entry in its owner's index, for a data set
 *  from a link that no list of mine has. */
const openedAs = signal<{ local: boolean; external: boolean; theirs?: Listed }>({ local: false, external: false });
/** The data set open, named from the lists as they are now: a link's data set opens before the lists are read, and
 *  takes its title from them once they are. */
export const opened = computed<Opened | null>(() => {
  const file = bundleName.value,
    { local, external, theirs } = openedAs.value;
  if (!file || !bundle.value) return null;
  const entry =
    local || external
      ? undefined
      : (catalogue.value.bundles.find((x) => x.file === file) ?? mine.value.find((x) => x.file === file) ?? theirs);
  return { file, local, external, entry, title: entry?.title ?? (local ? file : titleOf(file)) };
});

/** The name of the data set being opened (the last one asked for), until it shows or fails. */
export const opening = signal<string | null>(null);
/** Why the last data set did not open, while nothing else is shown instead (ui/Start.tsx). */
export const openFailure = signal<Failure | null>(null);
/** Start-up is over: the lists were read and the first data set, if any, was asked for (set by ui/App.tsx). */
export const started = signal(false);
/** Live mode (control/live.ts): new data sets are opened as they appear. */
export const following = signal(false);

/** Re-read index.json, bypassing caches (it changes as new data arrive). Only well-formed entries are kept
 *  (library.ts cleanList). An index whose `updated` time has not changed changes nothing, so that nothing that depends
 *  on the list runs again on every poll. */
export async function refreshCatalogue() {
  try {
    const r = await fetch("index.json", { cache: "no-store" });
    const index = r.ok ? await r.json() : null,
      bundles = cleanList(index?.bundles);
    if (!bundles || (typeof index.updated === "string" && index.updated === catalogue.peek().updated)) return;
    catalogue.value = { bundles, updated: typeof index.updated === "string" ? index.updated : undefined };
  } catch {
    /* offline or no index: keep what we have */
  }
}

// ---- Opening one

/** How many opens were asked for: each open knows its number, and only the last one may show anything. */
let opens = 0;

/** Open a bundle and show its event `start` (a shared link's event: only that one is read, not event 0 first).
 *  `local`: a file from this computer (read through `open`), which the address bar and the recent list cannot open
 *  again. `asked`, when not local, is a file of this site or an address elsewhere (library.ts locate); anything else
 *  is refused. An old link to a site file `x.evdb` that is gone opens `x.ember`, its name since the rename. Opens may overlap (a slow link and a choice made meanwhile, Live, two quick picks): the last one asked for
 *  wins, whatever order they finish in, and one that was overtaken changes nothing and says nothing. Returns whether
 *  this open is the one on screen with its event read (then a link's view and selection can be applied). */
export async function openBundle(
  asked: string,
  open?: () => Promise<Source>,
  start = 0,
  local = false,
  index = readIndex,
): Promise<boolean> {
  const id = ++opens,
    overtaken = () => id !== opens;
  const place = local ? null : locate(asked),
    external = place?.kind === "external";
  let name = asked; // the file opened: `asked`, or its .ember successor (below)
  opening.value = asked;
  try {
    if (place?.kind === "bad") throw new NameError(asked);
    let source: Source;
    try {
      source = await (open ?? (() => httpSource(external ? place.url : asked)))();
    } catch (e) {
      // A bundle published before the rename to Ember (x.evdb) and published again since is x.ember, and the old file
      // is gone: an old link to it opens the new one. One more request, made only when the first found nothing.
      const successor = asked.replace(/\.evdb$/, ".ember");
      if (open || place?.kind !== "site" || successor === asked || !isMissing(e)) throw e;
      source = await httpSource(successor);
      name = successor;
    }
    if (overtaken()) return false;
    const b = await Bundle.open(source);
    if (overtaken()) return false;
    dropUndrawable(b);
    // The first event is read before anything changes: until it is in, the data set on screen stays whole (its
    // event, selection and address), and one whose first event cannot be read fails to open, as a whole.
    // The data set on screen keeps only the event shown meanwhile: its neighbours read ahead (100 MB each at PU200)
    // would otherwise be held alongside the new data set's first event.
    bundle.peek()?.keep([eventIndex.peek()]);
    const n = b.events.length,
      at = n && Number.isInteger(start) ? ((start % n) + n) % n : 0,
      t0 = performance.now(),
      ev = n ? await b.event(at) : null;
    if (overtaken()) return false;

    // One change for whoever watches (the scene, the address, the panels): the bundle, its name, how it was opened,
    // its own starting state (the domain it opens on and that domain's view, the user's saved choices for its
    // profile, the default ticks and cuts) and its first event. Nothing ever sees the new bundle with the previous
    // one's event, selection or settings.
    batch(() => {
      bundle.value = b;
      solo.value = null;
      colourChoice.value = "reco";
      bundleName.value = name;
      openedAs.value = { local, external };
      openFailure.value = null;
      const first = startDomain(b.header);
      view.value = b.header.domains?.find((d) => d.name === first)?.view ?? b.header.view?.start ?? "3d";
      loadCustom(
        b.header.profile,
        Object.fromEntries(b.header.display.filter((d) => d.filter).map((d) => [d.table, d.filter!])),
        !external,
      );
      visible.value = Object.fromEntries(b.header.display.map((d) => [layerKey(d), d.visible]));
      showAll.value = {};
      domain.value = first;
      if (first) openTab.value = { name: tabOfDomain(b.header, first) };
      cuts.value = Object.fromEntries([...cutGroups.value].map(([g, info]) => [g, info.default]));
      if (ev) putEvent(b, at, ev, performance.now() - t0);
      else rawEvent.value = null;
    });
    wanted = at;
    if (ev) readAhead(b, at, at);
    void describeOpened(id, name, local, external, index);
    return true;
  } catch (e) {
    if (overtaken()) return false;
    const failure = describeFailure(asked, e, local);
    if (failure.kind === "gone") forgetRecent(asked);
    // With a data set on screen it stays, and a message says why the other did not open; with nothing to show (a link
    // followed to a file that is gone), the page says so in full.
    if (bundle.peek()) toast(`${failure.title}: ${failure.text}`, "error");
    else openFailure.value = failure;
    return false;
  } finally {
    if (!overtaken()) opening.value = null;
  }
}

/** The server has no such file (what library.ts describeFailure calls "gone"). */
const isMissing = (e: unknown) => e instanceof HttpError && (e.status === 404 || e.status === 410);

/** Leave out the layers this viewer cannot draw, so the rest of the bundle still shows: a representation it does not
 *  know (a newer bundle; a console warning), or position columns the table lacks (they would be drawn at the origin;
 *  a message says so). Changes the header in place. */
function dropUndrawable(b: Bundle) {
  const unknown = b.header.display.filter((d) => !(REPRS as readonly string[]).includes(d.repr));
  if (unknown.length) {
    console.warn(
      `Not drawn, unknown representation: ${unknown.map((d) => `${d.label} (${d.table}: ${d.repr})`).join(", ")}`,
    );
    b.header.display = b.header.display.filter((d) => !unknown.includes(d));
  }
  const placed = (d: DisplayLayer) => d.position.every((c) => c in (b.header.tables[d.table]?.columns ?? {}));
  const unplaced = b.header.display.filter((d) => !placed(d));
  if (unplaced.length) {
    toast(`Not drawn, position columns missing: ${unplaced.map((d) => `${d.label} (${d.table})`).join(", ")}`, "error");
    b.header.display = b.header.display.filter(placed);
  }
}

/** Name the data set just opened (open number `id`). One that no list of mine has came from a link: it goes to the
 *  recent ones (from which a list that arrives later takes it back, library.ts pruneRecent), with its title from its
 *  owner's index (read once, in the background), where its expiry is too. An address on another site is neither
 *  looked up nor remembered. */
async function describeOpened(id: number, name: string, local: boolean, external: boolean, index = readIndex) {
  if (local) return noteRecent({ file: name, title: name, local: true });
  if (external || opened.peek()?.entry) return;
  const owner = ownerOf(name),
    theirs = owner ? (await index(owner))?.find((x) => x.file === name) : undefined;
  if (id !== opens) return; // another one was asked for meanwhile
  if (theirs) openedAs.value = { local, external, theirs };
  if (!opened.peek()?.entry || opened.peek()?.entry === theirs)
    noteRecent({ file: name, title: theirs?.title ?? titleOf(name) });
}

/** Keep the data set on screen, chosen again while another was opening: that open is overtaken, as by a new one. */
export function keepShown() {
  opens++;
  opening.value = null;
}

/** Open a file from this computer (dropped on the page, or picked): read where it is, never uploaded. */
export const openLocal = (file: File) => openBundle(file.name, async () => blobSource(file), 0, true);

// ---- Moving between events

/** The event asked for last: shown, or still to be read. */
let wanted = 0;
/** The bundle whose event is being read: one read at a time. */
let reading: Bundle | null = null;

/** Show the event `d` after the one asked for last (← / →), so that presses while an event is read each move on one
 *  event. */
export const stepEvent = (d: number) => showEvent(wanted + d);

/** Put event `index` of `b`, just read in `ms`, on screen. The caller batches it with whatever else changes. */
function putEvent(b: Bundle, index: number, ev: EventData, ms: number) {
  selection.value = null;
  hover.value = null;
  eventIndex.value = index;
  rawEvent.value = ev;
  shownOf.value = b;
  loadMs.value = ms;
}

/** Keep the events around `index` read, and read the next one in the direction of travel (from `from`) ahead
 *  (io/bundle.ts around). */
function readAhead(b: Bundle, index: number, from: number) {
  const { keep, next } = around(index, from, b.events.length);
  b.keep(keep);
  if (next !== null) b.event(next).catch(() => {}); // a failed read ahead is tried again when that event is shown
}

/** Show event `i` (wrapping around), then read the next one in the direction of travel ahead (io/bundle.ts around).
 *  One event is read at a time: if others are asked for meanwhile, the read goes on to the last one asked for,
 *  skipping those in between (holding → at PU200 never has more than one 35 MB read in flight). */
export async function showEvent(i: number) {
  const b = bundle.value;
  if (!b || !b.events.length) return;
  const n = b.events.length;
  wanted = ((i % n) + n) % n;
  if (reading === b) return; // the read in flight goes on to `wanted`
  reading = b;
  loading.value = true;
  let index = wanted;
  try {
    for (;;) {
      const t0 = performance.now(),
        ev = await b.event(index);
      if (bundle.peek() !== b) return; // another bundle opened meanwhile
      if (index !== wanted) {
        index = wanted;
        continue;
      }
      const from = shownOf.peek() === b ? eventIndex.peek() : index;
      batch(() => putEvent(b, index, ev, performance.now() - t0));
      readAhead(b, index, from);
      return;
    }
  } catch (e) {
    if (bundle.peek() === b) {
      wanted = eventIndex.peek();
      toast(`Could not read event ${index + 1}: ${e}`, "error");
    }
  } finally {
    if (reading === b) {
      reading = null;
      loading.value = false;
    }
  }
}
