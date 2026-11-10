// Reconstruction replay: an event builds up the way it happened, then the way it was reconstructed.
//  1. Physics, in slow motion: each hit appears at its arrival time. Hits with a measured time (display hint `time`)
//     use it; the others use their straight-line time of flight from the collision point. A caption shows the clock.
//     For a front moving along a direction (header `replay.direction`, e.g. cosmics) the order is geometric instead,
//     and with `replay.order: "random"` (no meaningful arrival times, e.g. noise) it is a fixed random order.
//  2. Clustering: grouped objects (e.g. layer clusters) appear, sweeping in the same order.
//  3. Linking: grouped objects take their group's colour and the groups (showers) grow in.
//     With reconstruction stages (display hint `stage`: tracksters, linked tracksters, ..., candidates), each stage
//     grows in turn and the previous one gives way to it; the replay ends on the last stage present.
// Phases 2 and 3 show what the reconstruction produced, in arrival order; not the algorithms' real sequence.
import type { DisplayLayer, Header, Table } from "../io/bundle";
import type { Layer } from "./layers";

export const REPLAY_OFF = 1e30; // clock value meaning "no replay": everything in its final state
const TRAVEL = 3, CLUSTER = [3.2, 1.2], LINK = [4.6, 2.0], SETTLE = 0.8, LATE = 1.15; // s; LATE: tail beyond the window
const STAGE = [2.4, 1.6]; // s: interval between reconstruction stages, and how long each takes to grow in
const C = 29.9792458; // cm/ns
const MISSING = -50; // ns: HGCal stores "no time" as -99

export interface ReplayItem { layer: Layer; d: DisplayLayer; t: Table; emphasis?: Uint8Array }
export interface Caption { title: string; detail?: string }
export interface Plan {
  seconds: number; // total
  travel: number; clusterStart: number; linkStart: number; linkEnd: number; // phase boundaries (s)
  stages: { start: number; tables: string[] }[]; // reconstruction stages present, in order
  caption(s: number): Caption | null;
}

/** Sets every layer's timeline and returns the plan (phase times and captions). */
export function planReplay(items: ReplayItem[], how: Header["replay"]): Plan {
  const direction = how?.direction, random = how?.order === "random", [ox, oy, oz] = how?.from ?? [0, 0, 0];
  const tof = (l: Layer, i: number) => Math.hypot(l.x[i] - ox, l.y[i] - oy, l.z[i] - oz) / C;
  const isShower = (d: DisplayLayer) => d.stage !== undefined || d.repr === "ellipsoids" || d.colourBy === "row";
  const isGrouped = (d: DisplayLayer) => typeof d.colourBy === "object" && "relation" in d.colourBy;
  const isHit = (d: DisplayLayer) => !isShower(d) && !isGrouped(d);
  let measured = 0, total = 0; // drawn hits only (passing the cuts): they are what the physics phase shows

  // Arrival "time" per object: ns (measured or time of flight), or the coordinate along `direction`.
  const arrivals = items.map(({ layer: l, d, t }) => {
    const n = l.x.length, out = new Float64Array(n);
    if (random) { // a fixed pseudo-random order (the same every replay): hash of the row number
      for (let i = 0; i < n; i++) out[i] = (Math.imul(i + 1, 2654435761) >>> 0) / 4294967296;
      return out;
    }
    if (direction) {
      for (let i = 0; i < n; i++) out[i] = l.x[i] * direction[0] + l.y[i] * direction[1] + l.z[i] * direction[2];
      return out;
    }
    for (let i = 0; i < n; i++) out[i] = tof(l, i);
    const col = d.time ? t.columns[d.time] : undefined, shift = col ? convention(col, l, tof) : null;
    if (col && shift !== null)
      for (let i = 0; i < n; i++) {
        const v = Number(col[i]);
        if (Number.isFinite(v) && v > MISSING) { out[i] = v + (shift ? out[i] : 0); if (isHit(d) && l.passes(i)) measured++; }
      }
    if (isHit(d)) for (let i = 0; i < n; i++) if (l.passes(i)) total++;
    return out;
  });

  // The window covers the bulk of the drawn hits (1st to 97th percentile); later arrivals come in just after it.
  const sample: number[] = [], hitsOnly = items.some(({ d }) => isHit(d));
  for (const [k, a] of arrivals.entries()) {
    const { layer: l, d } = items[k];
    if (!hitsOnly || isHit(d)) for (let i = 0; i < a.length; i += Math.max(1, Math.floor(a.length / 5000))) if (l.passes(i)) sample.push(a[i]);
  }
  sample.sort((a, b) => a - b);
  const t0 = sample[Math.floor(0.01 * (sample.length - 1))] ?? 0, t1 = sample[Math.floor(0.97 * (sample.length - 1))] ?? 1;
  const progress = (v: number) => Math.min(LATE, Math.max(0, (v - t0) / (t1 - t0 || 1)));

  const grouped = items.find(({ d }) => isGrouped(d)), shower = items.find(({ d }) => isShower(d));
  const order = [...new Set(items.flatMap(({ d }) => (d.stage === undefined ? [] : [d.stage])))].sort((a, b) => a - b);
  const stages = order.map((st, k) => ({
    start: LINK[0] + k * STAGE[0], tables: items.filter(({ d }) => d.stage === st).map(({ d }) => d.table),
    name: items.find(({ d }) => d.stage === st)!.d.group,
  }));
  const startOf = (d: DisplayLayer) => (d.stage === undefined ? LINK[0] : stages[order.indexOf(d.stage)].start);
  items.forEach(({ layer, d, emphasis }, k) => {
    const n = layer.x.length, appear = new Float32Array(n), link = new Float32Array(n), a = arrivals[k];
    const grow = d.stage === undefined ? LINK[1] : STAGE[1];
    for (let i = 0; i < n; i++) {
      const p = progress(a[i]), q = Math.min(1, p);
      if (isShower(d)) appear[i] = startOf(d) + grow * q;
      else if (isGrouped(d)) {
        appear[i] = CLUSTER[0] + CLUSTER[1] * q;
        // grey until grouped; with stages, every object waits for the first stage, whose colours then apply
        if (emphasis?.[i] || stages.length) link[i] = LINK[0] + LINK[1] * q;
      } else appear[i] = TRAVEL * p;
    }
    layer.setTimeline(appear, link);
    // Hits fade back as the reconstruction builds up on them, so the reconstructed objects stand out.
    if (isHit(d)) layer.setFade?.(CLUSTER[0], stages.length ? stages[0].start + STAGE[1] : LINK[0] + LINK[1], 0.85);
    const next = d.stage === undefined ? undefined : stages[order.indexOf(d.stage) + 1];
    layer.setRetire(next ? next.start : REPLAY_OFF);
  });

  const linkEnd = stages.length ? stages[stages.length - 1].start + STAGE[1] : shower || grouped ? LINK[0] + LINK[1] : TRAVEL * LATE;
  const name = (x?: ReplayItem) => (x?.d.kind ? x.d.group : x?.d.label ?? "").toLowerCase(); // "layer clusters", not "merged"
  return {
    seconds: linkEnd + SETTLE, travel: TRAVEL, clusterStart: CLUSTER[0], linkStart: LINK[0], linkEnd,
    stages: stages.map(({ start, tables }) => ({ start, tables })),
    caption(s) {
      if (s < TRAVEL * LATE)
        return random
          ? { title: "Hits appearing", detail: "in random order: these hits have no arrival times" }
          : direction
          ? { title: "Particles crossing the detector", detail: "hits appear in order of position along the direction of travel, not at measured times" }
          : { title: `t = ${(t0 + (Math.min(s, TRAVEL * LATE) / TRAVEL) * (t1 - t0)).toFixed(2)} ns after the collision`,
              detail: measured ? `${Math.round((100 * measured) / total)}% of hits at their measured time, the rest at their time of flight` : "times of flight from the collision point" };
      if (grouped && s < LINK[0]) return { title: `Clustering hits into ${name(grouped)}` };
      if (stages.length && s < linkEnd + SETTLE) {
        const k = stages.reduce((last, st, j) => (st.start <= s ? j : last), 0);
        return { title: k === 0 ? `Building ${stages[0].name.toLowerCase()}` : `${stages[k - 1].name} → ${stages[k].name.toLowerCase()}`,
                 detail: `reconstruction step ${k + 1} of ${stages.length}` };
      }
      if (s < linkEnd + SETTLE && (grouped || shower))
        return { title: shower ? `Linking ${name(grouped) || "clusters"} into ${name(shower)}` : `Grouping ${name(grouped)}` };
      return null;
    },
  };
}

/** How a layer's time column relates to the time of flight: 0 if it is an arrival time, 1 if it is corrected for
 *  the flight (about 0 for prompt particles: add it back), null if neither (then it is not used). */
function convention(col: ArrayLike<number | bigint>, l: Layer, tof: (l: Layer, i: number) => number): 0 | 1 | null {
  const raw: number[] = [], minus: number[] = [];
  for (let i = 0; i < l.x.length; i++) {
    const v = Number(col[i]);
    if (Number.isFinite(v) && v > MISSING) { raw.push(v); minus.push(v - tof(l, i)); }
  }
  if (raw.length < 5) return null;
  const median = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1];
  return Math.abs(median(minus)) < 3 ? 0 : Math.abs(median(raw)) < 3 ? 1 : null;
}
