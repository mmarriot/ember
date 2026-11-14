// Live display: when the site's index gains a file, open it and replay each of its events in turn (the camera
// slowly orbiting), then wait for the next. It starts with the newest file present; if data arrive faster than they
// play, it skips ahead to the newest. Until switched off; starting the tour stops it, and the other way round.
import { bundle, catalogue, following, openBundle, refreshCatalogue, showEvent, toast, touring } from "../model/store";
import { stopTour } from "./tour";
import { engine, replayEvent } from "./scene";

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
