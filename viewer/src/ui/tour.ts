// Guided tour, with the camera moving through each event as it builds up (see render/replay.ts). The camera orbits
// the whole time and every flight is layered on top of the orbit, and selections cross-fade, so nothing jumps:
// particles travel out while the camera swoops in from wide, swinging round; it circles the clusters as they form,
// glides into the leading shower while the showers are linked, visits the most energetic showers one at a time
// (selected, so the inspector describes each), then pulls back out to the next event. Forever, until any key or
// touch, or the play button. Only camera moves and timers: nothing is recomputed beyond a manual selection.
import { bundle, cuts, event, eventIndex, highlight, layerKey, selection, showEvent, touring, view, visible } from "../model/store";
import { related, type Ref } from "../model/relations";
import { stopLive } from "./live";
import { engine, replayEvent } from "./Viewport";

const ORBIT = 1.2; // turns per minute, throughout
const SHOWERS = 3;

let generation = 0; // each tour has its own; a stopped tour's pending steps see a newer one and end

export function toggleTour() {
  if (touring.value) stopTour();
  else void startTour();
}

export function stopTour() {
  if (!touring.value) return;
  generation++;
  touring.value = false;
  engine?.autoRotate(0);
}

async function startTour() {
  const me = ++generation, e = engine;
  if (!e) return;
  stopLive();
  touring.value = true;
  view.value = "3d";
  const wait = (ms: number) => new Promise<boolean>((done) => setTimeout(() => done(generation === me), ms));
  const fly = (rows: Map<string, Iterable<number>> | undefined, ms: number, swing: number) => {
    e.frame(rows, true, ms, swing);
    return wait(ms);
  };
  e.autoRotate(ORBIT);

  while (generation === me) {
    selection.value = null;
    const targets = showers(SHOWERS), plan = replayEvent(), start = performance.now();
    const until = (s: number) => wait(Math.max(0, start + s * 1000 - performance.now())); // s on the replay clock
    if (plan) {
      e.frame(around(targets), true, plan.travel * 1000, 0.6); // swoop in while the particles travel
      if (!(await until(plan.linkStart))) return; // circle while the clusters form
      // Glide into the leading shower while it is built and linked; at the last reconstruction step, pull back to
      // show every final object (and the tracks that reach them).
      const last = plan.stages.length > 1 ? plan.stages[plan.stages.length - 1] : undefined;
      const glideEnd = last ? last.start : plan.seconds;
      if (targets.length) e.frame(around(targets.slice(0, 1)), true, (glideEnd - plan.linkStart) * 1000, -0.3);
      if (last) {
        if (!(await until(last.start))) return;
        e.frame(everything(last.tables), true, (plan.seconds - last.start) * 1000, 0.5);
      }
      if (!(await until(plan.seconds + 0.4))) return;
    } else if (!(await wait(4000))) return;
    for (const ref of targets) { // the selection cross-fades while the camera glides over
      selection.value = ref;
      if (!(await fly(highlight.value ?? undefined, 2600, 0.3))) return;
      if (!(await wait(3500))) return;
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

/** The most energetic objects of the latest visible reconstruction stage (else the first visible shower-like
 *  layer: drawn as ellipsoids, or one colour per object) that pass its cut; none if the data has no such layer
 *  (then the tour only orbits). */
function showers(k: number): Ref[] {
  const b = bundle.value, ev = event.value;
  if (!b || !ev) return [];
  const drawn = b.header.display.filter((l) => visible.value[layerKey(l)] && ev.tables[l.table]?.n);
  const d = drawn.filter((l) => l.stage !== undefined).sort((a, c) => c.stage! - a.stage!)[0]
    ?? drawn.find((l) => l.repr === "ellipsoids" || l.colourBy === "row");
  if (!d) return [];
  const t = ev.tables[d.table];
  const column = d.cut?.column ?? Object.keys(t.columns).find((c) => /energy$/i.test(c));
  const value = (i: number) => (column ? Number(t.columns[column][i]) : 0);
  const min = d.cut ? cuts.value[d.cut.group] ?? 0 : -Infinity;
  return [...Array(t.n).keys()].filter((i) => value(i) >= min).sort((a, c) => value(c) - value(a)).slice(0, k).map((row) => ({ table: d.table, row }));
}
