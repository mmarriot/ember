// Guided tour: each event is built up step by step (model/tour.ts: outwards from the collision point, from the
// detector's hits to the physics objects), each step's objects growing in while the camera frames them and a caption
// says what they are; then the bundle's own view, whose leading objects (else main showers) are visited one by one
// (selected, so the inspector describes them); then the next event; until any key or touch, or the play button.
// A bundle without the kinds of object the steps name (test beam, cosmics) replays each event instead
// (render/replay.ts), then visits its main showers. Profile view.tour "beam" (collider data): the camera starts on the
// whole detector and never enters it (Engine.tourCamera); "orbit" (default): it frames the objects at their own scale
// and orbits them.
import { batch, signal } from "@preact/signals";
import type { DisplayLayer } from "../io/bundle";
import { bundle, cuts, domain, event, eventIndex, highlight, layerKey, selection, showAll, showEvent, sizeColumn, touring, view, drawnLayers, visible } from "../model/store";
import { filterMask, filters } from "../model/custom";
import { passes } from "../model/objects";
import { related, type Ref } from "../model/relations";
import { isShower, type Caption } from "../render/replay";
import { startDomain } from "../model/domains";
import { tourPlan } from "../model/tour";
import { stopLive } from "./live";
import { chooseDomain, ranked } from "./navigate";
import { engine, growTables, replayEvent } from "./Viewport";

const ORBIT = 1.2; // turns per minute (orbit tours)
const SHOWERS = 3; // visited per event
const LEADING = 4; // physics objects visited per event (bundles that open on a shared domain)
const GROW = 1.6; // s: a step's objects grow in
/** ms a step is shown: time to read its caption. */
const stepMs = (detail: string) => Math.min(8000, 3000 + 25 * detail.length);

/** The tour's caption (Viewport): the step shown. */
export const tourCaption = signal<Caption | null>(null);

let generation = 0; // each tour has its own; a stopped tour's pending steps see a newer one and end

export function toggleTour() {
  if (touring.value) stopTour();
  else void startTour();
}

// The tour draws what each step shows, in All, and every object of layers normally drawn only for a selection (e.g.
// track hits): the user's choices (and domain) are restored afterwards.
let saved: { showAll: Record<string, boolean>; visible: Record<string, boolean>; domain: string | null } | null = null;

export function stopTour() {
  if (!touring.value) return;
  generation++;
  touring.value = false;
  tourCaption.value = null;
  engine?.stopReplay(); // the event in its final state
  engine?.tourCamera(false);
  engine?.autoRotate(0);
  const s = saved;
  saved = null;
  // One rebuild, of what the user's domain draws (not first everything in All).
  if (s) batch(() => { domain.value = s.domain; showAll.value = s.showAll; visible.value = s.visible; });
}

async function startTour() {
  const me = ++generation, e = engine;
  if (!e) return;
  stopLive();
  touring.value = true;
  view.value = "3d";
  const pace = import.meta.env.DEV ? Number((window as { evdTourPace?: number }).evdTourPace ?? 1) : 1; // e2e tests: slower
  const wait = (ms: number) => new Promise<boolean>((done) => setTimeout(() => done(generation === me), ms * pace));
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
  saved = { showAll: showAll.value, visible: visible.value, domain: domain.value };
  showAll.value = { ...showAll.value, ...Object.fromEntries((header?.display ?? []).filter((d) => d.onSelection && !d.truth).map((d) => [layerKey(d), true])) };
  const steps = tourPlan(header?.display ?? []);
  // A bundle that opens on a shared domain (e.g. Physics): the build-up (or replay) in All, the visits in that domain,
  // to its leading labelled objects.
  const physics = startDomain(header);

  /** The event built up step by step; false if the tour was stopped. */
  const buildUp = async () => {
    const here = steps.map(({ step, layers }) => ({ step, layers: layers.filter(showsAny) })).filter((s) => s.layers.length);
    if (import.meta.env.DEV) Object.assign(window, { evdTourPlan: here.map((s) => s.step.title) }); // for the e2e tests
    let shown = new Set<string>();
    for (const { step, layers: now } of here) {
      const stays = (d: DisplayLayer) => shown.has(layerKey(d)) && !(d.kind && step.hide?.includes(d.kind)) && (!step.fresh || !!(d.kind && step.keep?.includes(d.kind)));
      shown = new Set([...header!.display.filter(stays), ...now].map(layerKey));
      visible.value = Object.fromEntries(header!.display.map((d) => [layerKey(d), shown.has(layerKey(d))])); // builds the new layers only
      tourCaption.value = { title: step.title, detail: step.detail };
      const tables = new Set(now.map((d) => d.table));
      growTables(tables, GROW);
      move(step.frame === "all" ? undefined : everything([...tables]), 2400, 0.3, 1.6);
      if (!(await wait(stepMs(step.detail)))) return false;
    }
    return true;
  };

  /** The event replayed (render/replay.ts) while the camera follows it; false if the tour was stopped. */
  const replay = async () => {
    const plan = replayEvent(), start = performance.now(), targets = showers(SHOWERS);
    const until = (s: number) => wait(Math.max(0, start + s * 1000 - performance.now())); // s on the replay clock
    if (!plan) return wait(4000);
    // Start wide (collider data: the whole detector, both endcaps) while the particles travel; orbit tours come
    // closer to the action straight away.
    move(beam ? undefined : around(targets), plan.travel * 1000, 0.6);
    if (plan.growth) { // closer on the paths while they are built (e.g. tracks in the tracker)
      if (!(await until(plan.growth.start))) return false;
      move(everything(plan.growth.tables), (plan.growth.build - plan.growth.start) * 1000 + 800, 0.3, 1.15);
      if (plan.linkEnd > plan.growth.end) { // back out for what follows (e.g. clusters forming in the endcaps)
        if (!(await until(plan.growth.end))) return false;
        move(beam ? undefined : around(targets), (plan.linkStart - plan.growth.end) * 1000, 0.4);
      }
    }
    if (!(await until(plan.linkStart))) return false; // circle while the clusters form
    // Glide into the leading shower while it is built and linked; at the last reconstruction step, pull back to
    // show every final object (and the tracks that reach them).
    const last = plan.stages.length > 1 ? plan.stages[plan.stages.length - 1] : undefined;
    const glideEnd = last ? last.start : plan.seconds;
    if (targets.length) move(around(targets.slice(0, 1)), (glideEnd - plan.linkStart) * 1000, -0.3, 2.7); // well back
    if (last) {
      if (!(await until(last.start))) return false;
      move(everything(last.tables), (plan.seconds - last.start) * 1000, 0.5);
    }
    return until(plan.seconds + 0.4);
  };

  while (generation === me) {
    selection.value = null;
    if (physics || (steps.length && domain.value)) chooseDomain(null, false);
    if (!(await (steps.length ? buildUp() : replay()))) return;
    if (physics) chooseDomain(physics, false); // first, so that only its layers are built below
    if (steps.length) { // the event as the bundle shows it: the user's layers, in the domain it opens on
      engine?.stopReplay();
      tourCaption.value = { title: "The whole event", detail: "Reconstructed and ready for physics analysis: its leading objects, one by one." };
      visible.value = saved!.visible;
    }
    const lead = physics ? leading(LEADING) : [], targets = lead.length ? lead : showers(SHOWERS);
    if (!(await fly(undefined, steps.length ? 4000 : 1600, 0.3))) return;
    tourCaption.value = null; // the inspector describes each object visited
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
    if (steps.length) visible.value = {}; // the next event starts empty: nothing built that its first step hides
    await showEvent(eventIndex.value + 1);
  }
}

/** Whether a layer has objects in the event that pass its cut and filter (e.g. the event may have only muon hits that
 *  the default filter hides): a step with none is skipped. */
function showsAny(d: DisplayLayer) {
  const t = event.value?.tables[d.table];
  if (!t?.n) return false;
  const ok = passes(d, t, d.cut ? cuts.value[d.cut.group] ?? 0 : 0, filterMask(t, filters.value[d.table]));
  for (let i = 0; i < t.n; i++) if (ok(i)) return true;
  return false;
}

/** The `k` largest objects (by their size column, e.g. pT) of the drawn layers with labels (layer hint `labels`), each
 *  among its layer's labelled ones: e.g. the leading jets, the lepton, MET. */
function leading(k: number): Ref[] {
  const b = bundle.value, ev = event.value;
  if (!b || !ev) return [];
  const all: [Ref, number][] = [];
  for (const d of b.header.display.filter((l) => l.labels && drawnLayers.value[layerKey(l)])) {
    const t = ev.tables[d.table], c = t && sizeColumn(d.table, t);
    for (const row of ranked(d, d.labels)) all.push([{ table: d.table, row }, c ? Number(t.columns[c][row]) : 0]);
  }
  return all.sort((a, c) => c[1] - a[1]).slice(0, k).map(([ref]) => ref);
}

/** All objects of the given tables, to frame them. */
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
