// Live display: play new data as it arrives. When the site's index gains a file, open it and show each of its
// events in turn (replayed, with the camera slowly orbiting the whole event), then wait for the next file. Files
// already present when Live starts are skipped, except the newest, which plays first; if data arrive faster than
// they play, Live skips ahead to the newest file so the display stays current. Runs until switched off; the tour
// and Live take turns (starting one stops the other).
import { bundle, catalogue, following, refreshCatalogue, showEvent, toast, touring, openBundle } from "../model/store";
import { stopTour } from "./tour";
import { engine, replayEvent } from "./Viewport";

const POLL = 10_000; // ms between index checks while waiting for data
const DWELL = 2_500; // ms an event stays after its replay
const ORBIT = 0.8; // turns per minute
const MAX_BEHIND = 3; // files waiting before Live skips to the newest

let generation = 0;
const seen = new Set<string>();

export function toggleLive() {
  if (following.value) stopLive();
  else void startLive();
}

export function stopLive() {
  if (!following.value) return;
  generation++;
  following.value = false;
  engine?.autoRotate(0);
}

async function startLive() {
  if (touring.value) stopTour();
  const me = ++generation;
  following.value = true;
  const alive = () => generation === me;
  const wait = (ms: number) => new Promise<boolean>((done) => setTimeout(() => done(alive()), ms));
  await refreshCatalogue();
  seen.clear();
  catalogue.value.bundles.slice(1).forEach((b) => seen.add(b.file));
  engine?.autoRotate(ORBIT);

  while (alive()) {
    const waiting = catalogue.value.bundles.filter((b) => !seen.has(b.file)); // newest first
    if (waiting.length > MAX_BEHIND) {
      waiting.slice(1).forEach((b) => seen.add(b.file));
      toast(`Skipped ${waiting.length - 1} files to catch up with the newest data`);
    }
    const next = catalogue.value.bundles.filter((b) => !seen.has(b.file)).at(-1); // oldest new file first
    if (!next) {
      if (!(await wait(POLL))) return;
      await refreshCatalogue();
      continue;
    }
    seen.add(next.file);
    toast(`New data: ${next.title}`);
    await openBundle(next.file);
    for (let i = 0; alive() && i < (bundle.value?.events.length ?? 0); i++) {
      if (i > 0) await showEvent(i);
      engine?.frame(undefined, true, 1200);
      const plan = replayEvent();
      if (!(await wait((plan?.seconds ?? 2) * 1000 + DWELL))) return;
    }
    if (alive()) await refreshCatalogue();
  }
}
