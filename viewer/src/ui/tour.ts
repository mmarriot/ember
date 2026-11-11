// Guided tour: each event replays (render/replay.ts) while the camera follows it, then the most energetic showers
// are visited one by one (selected, so the inspector describes them), then the next event; until any key or touch,
// or the play button. Profile view.tour "beam" (collider data): the camera starts on the whole detector and never
// enters it (Engine.tourCamera); "orbit" (default): it frames the objects at their own scale and orbits them.
import { bundle, cuts, event, eventIndex, highlight, layerKey, selection, showAll, showEvent, sizeColumn, touring, view, drawnLayers } from "../model/store";
import { related, type Ref } from "../model/relations";
import { isShower } from "../render/replay";
import { stopLive } from "./live";
import { engine, replayEvent } from "./Viewport";

const ORBIT = 1.2; // turns per minute (orbit tours)
const SHOWERS = 3; // visited per event

let generation = 0; // each tour has its own; a stopped tour's pending steps see a newer one and end

export function toggleTour() {
  if (touring.value) stopTour();
  else void startTour();
}

// Reconstructed objects normally drawn only for a selection (e.g. candidate tracks) are all drawn during a tour:
// the user's choice is restored afterwards.
let savedShowAll: Record<string, boolean> | null = null;

export function stopTour() {
  if (!touring.value) return;
  generation++;
  touring.value = false;
  engine?.stopReplay(); // the event in its final state
  engine?.tourCamera(false);
  engine?.autoRotate(0);
  if (savedShowAll) { showAll.value = savedShowAll; savedShowAll = null; }
}

async function startTour() {
  const me = ++generation, e = engine;
  if (!e) return;
  stopLive();
  touring.value = true;
  view.value = "3d";
  const wait = (ms: number) => new Promise<boolean>((done) => setTimeout(() => done(generation === me), ms));
  const beam = bundle.value?.header.view?.tour === "beam";
  // `room` (beam tours): how much is kept in view around the target, larger is further out.
  const move = (rows: Map<string, Iterable<number>> | undefined, ms: number, swing: number, room?: number) =>
    beam ? e.tourTo(rows, ms, room) : e.frame(rows, true, ms, swing);
  const fly = (rows: Map<string, Iterable<number>> | undefined, ms: number, swing: number, room?: number) => {
    move(rows, ms, swing, room);
    return wait(ms);
  };
  if (beam) e.tourCamera(true);
  else e.autoRotate(ORBIT);
  const header = bundle.value?.header;
  savedShowAll = showAll.value;
  showAll.value = { ...showAll.value, ...Object.fromEntries((header?.display ?? []).filter((d) => d.onSelection && !d.truth).map((d) => [layerKey(d), true])) };

  while (generation === me) {
    selection.value = null;
    const targets = showers(SHOWERS), plan = replayEvent(), start = performance.now();
    const until = (s: number) => wait(Math.max(0, start + s * 1000 - performance.now())); // s on the replay clock
    if (plan) {
      // Start wide (collider data: the whole detector, both endcaps) while the particles travel; orbit tours come
      // closer to the action straight away.
      move(beam ? undefined : around(targets), plan.travel * 1000, 0.6);
      if (plan.growth) { // closer on the paths while they are built (e.g. tracks in the tracker)
        if (!(await until(plan.growth.start))) return;
        move(everything(plan.growth.tables), (plan.growth.build - plan.growth.start) * 1000 + 800, 0.3, 1.15);
        if (plan.linkEnd > plan.growth.end) { // back out for what follows (e.g. clusters forming in the endcaps)
          if (!(await until(plan.growth.end))) return;
          move(beam ? undefined : around(targets), (plan.linkStart - plan.growth.end) * 1000, 0.4);
        }
      }
      if (!(await until(plan.linkStart))) return; // circle while the clusters form
      // Glide into the leading shower while it is built and linked; at the last reconstruction step, pull back to
      // show every final object (and the tracks that reach them).
      const last = plan.stages.length > 1 ? plan.stages[plan.stages.length - 1] : undefined;
      const glideEnd = last ? last.start : plan.seconds;
      if (targets.length) move(around(targets.slice(0, 1)), (glideEnd - plan.linkStart) * 1000, -0.3, 2.7); // well back
      if (last) {
        if (!(await until(last.start))) return;
        move(everything(last.tables), (plan.seconds - last.start) * 1000, 0.5);
      }
      if (!(await until(plan.seconds + 0.4))) return;
    } else if (!(await wait(4000))) return;
    for (const [k, ref] of targets.entries()) { // the selection cross-fades while the camera glides over
      // To the next one: out towards the whole event and back in without stopping (the next goal arrives
      // mid-glide); the current one stays selected on the way out.
      if (k > 0) { move(undefined, 1600, 0); if (!(await wait(beam ? 800 : 1600))) return; }
      selection.value = ref;
      if (!(await fly(highlight.value ?? undefined, 2400, 0.3, 1.35))) return; // closer on the candidate itself
      if (!(await wait(3000))) return;
    }
    selection.value = null;
    if (!(await fly(undefined, 2600, -0.6))) return; // pull out wide, ready for the next event
    await showEvent(eventIndex.value + 1);
  }
}

/** All objects of the given tables, to frame the final reconstruction step. */
function everything(tables: string[]) {
  const ev = event.value, rows = new Map<string, number[]>();
  for (const t of tables) if (ev?.tables[t]?.n) rows.set(t, [...Array(ev.tables[t].n).keys()]);
  return rows.size ? rows : undefined;
}

/** Everything related to the given showers (their clusters and hits), to frame the replay where the action is;
 *  undefined (the whole event) when there are none. */
function around(targets: Ref[]) {
  const b = bundle.value, ev = event.value;
  if (!b || !ev || !targets.length) return undefined;
  const rows = new Map<string, Set<number>>();
  for (const ref of targets) for (const [t, set] of related(ev, b.header, ref)) rows.set(t, new Set([...(rows.get(t) ?? []), ...set]));
  return rows;
}

/** The largest objects (by their size column, e.g. energy) of the latest visible reconstruction stage, else of the
 *  first visible shower layer, that pass its cut; none if the data has no such layer (then the tour only orbits). */
function showers(k: number): Ref[] {
  const b = bundle.value, ev = event.value;
  if (!b || !ev) return [];
  const drawn = b.header.display.filter((l) => drawnLayers.value[layerKey(l)] && ev.tables[l.table]?.n);
  const d = drawn.filter((l) => l.stage !== undefined).sort((a, c) => c.stage! - a.stage!)[0]
    ?? drawn.find(isShower);
  if (!d) return [];
  const t = ev.tables[d.table];
  const column = sizeColumn(d.table, t);
  const value = (i: number) => (column ? Number(t.columns[column][i]) : 0);
  const min = d.cut ? cuts.value[d.cut.group] ?? 0 : -Infinity;
  return [...Array(t.n).keys()].filter((i) => value(i) >= min).sort((a, c) => value(c) - value(a)).slice(0, k).map((row) => ({ table: d.table, row }));
}
