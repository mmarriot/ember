// Reconstruction replay: an event builds up the way it happened, then the way it was reconstructed.
//  1. Physics, in slow motion: each hit appears at its arrival time. Hits with a measured time (display hint `time`)
//     use it; the others use their straight-line time of flight from the collision point. A caption shows the clock.
//     For a front moving along a direction (header `replay.direction`, e.g. cosmics) the order is geometric instead,
//     and with `replay.order: "random"` (no meaningful arrival times, e.g. noise) it is a fixed random order.
//  2. Path building, with a layer of paths built from parts (display hint `grow`, e.g. tracks from their hits): each
//     path's first few parts (its seed) light up, then the paths grow out from their starts at one speed, each part
//     lighting as its path reaches it, and each path flashes when complete (fitted). Paths are inputs to the steps
//     below (tracks to the calorimeter's reconstruction), so they come first, and the steps below wait for them.
//  3. Clustering: grouped objects (e.g. layer clusters) appear, sweeping in the same order.
//  4. Linking: grouped objects take their group's colour and the groups (showers) grow in.
//     With reconstruction stages (display hint `stage`: tracksters, linked tracksters, ..., candidates), each stage
//     grows in turn and the previous one gives way to it; the replay ends on the last stage present.
// Phases 2 to 4 show what the reconstruction produced, in arrival order; not the algorithms' real sequence.
import type { DisplayLayer, Header, Table } from "../io/bundle";
import type { Layer } from "./layers";

export const REPLAY_OFF = 1e30; // clock value meaning "no replay": everything in its final state
const TRAVEL = 3,
  CLUSTER = [3.2, 1.2],
  LINK = [4.6, 2.0],
  SETTLE = 0.8,
  LATE = 1.15; // s; LATE: tail beyond the window
const STAGE = [2.4, 1.6]; // s: interval between reconstruction stages, and how long each takes to grow in
// Path building (s): seeds found over SEEDS from the end of the physics phase, building after a pause of PAUSE over at
// most BUILD (a path as long as the longest tenth takes all of it: one speed), then FIT for the last flashes.
const SEEDS = 1.0,
  PAUSE = 0.3,
  BUILD = 2.4,
  FIT = 0.7,
  SEED = 3;
const NEVER = 1e29; // s: a part of no drawn path stays unlit until the replay ends (REPLAY_OFF)
const C = 29.9792458; // cm/ns
const MISSING = -50; // ns: HGCal stores "no time" as -99

export interface ReplayItem {
  layer: Layer;
  d: DisplayLayer;
  t: Table;
  emphasis?: Uint8Array;
}
export interface Caption {
  title: string;
  detail?: string;
}
/** The parts of each object of a relation's `from` table (e.g. a track's hits): rows of `to`, in CSR form; `name`: what
 *  the parts are called (e.g. "track hits"), also when their layer is not drawn. */
export type Parts = (
  relation: string,
) => { to: string; offsets: Uint32Array; indices: Uint32Array; name?: string } | undefined;
export interface Plan {
  seconds: number; // total
  travel: number;
  clusterStart: number;
  linkStart: number;
  linkEnd: number; // phase boundaries (s)
  /** Path building, when a layer has the `grow` hint: seeding from `start`, building from `build`, every path whole by
   *  `complete`, the fit until `end` (s). */
  growth?: { start: number; build: number; complete: number; end: number; tables: string[] };
  stages: { start: number; tables: string[] }[]; // reconstruction stages present, in order
  caption(s: number): Caption | null;
}

/** Whether a layer shows showers (or other objects that group hits): a reconstruction stage, ellipsoids, or one
 *  colour per object. */
export const isShower = (d: DisplayLayer) => d.stage !== undefined || d.repr === "ellipsoids" || d.colourBy === "row";

/** Sets every layer's timeline and returns the plan (phase times and captions). */
export function planReplay(items: ReplayItem[], how: Header["replay"], parts?: Parts): Plan {
  const direction = how?.direction,
    random = how?.order === "random",
    [ox, oy, oz] = how?.from ?? [0, 0, 0];
  const isGrouped = (d: DisplayLayer) => typeof d.colourBy === "object" && "relation" in d.colourBy;
  const isGrown = (d: DisplayLayer) => d.grow !== undefined;
  const isHit = (d: DisplayLayer) => !isShower(d) && !isGrouped(d) && !isGrown(d);
  let measured = 0,
    total = 0; // drawn hits only (passing the cuts): they are what the physics phase shows

  // Arrival "time" per object: ns (measured or time of flight), or the coordinate along `direction`.
  const arrivals = items.map(({ layer: l, d, t }) => {
    const n = l.x.length,
      out = new Float64Array(n);
    if (random) {
      // a fixed pseudo-random order (the same every replay): hash of the row number
      for (let i = 0; i < n; i++) out[i] = (Math.imul(i + 1, 2654435761) >>> 0) / 4294967296;
      return out;
    }
    if (direction) {
      for (let i = 0; i < n; i++) out[i] = l.x[i] * direction[0] + l.y[i] * direction[1] + l.z[i] * direction[2];
      return out;
    }
    for (let i = 0; i < n; i++) {
      const dx = l.x[i] - ox,
        dy = l.y[i] - oy,
        dz = l.z[i] - oz;
      out[i] = Math.sqrt(dx * dx + dy * dy + dz * dz) / C;
    }
    const col = d.time ? t.columns[d.time] : undefined,
      shift = col ? convention(col, out) : null;
    if (col && shift !== null)
      for (let i = 0; i < n; i++) {
        const v = Number(col[i]);
        if (Number.isFinite(v) && v > MISSING) {
          out[i] = v + (shift ? out[i] : 0);
          if (isHit(d) && l.passes(i)) measured++;
        }
      }
    if (isHit(d)) for (let i = 0; i < n; i++) if (l.passes(i)) total++;
    return out;
  });

  // The window covers the bulk of the drawn hits (1st to 97th percentile); later arrivals come in just after it. It
  // ends with the other hits if the parts of built paths (e.g. tracker hits) arrive before them, so the later ones
  // (e.g. a calorimeter's) still come in its last part.
  const growing = items.filter(({ d, layer }) => isGrown(d) && layer.path);
  const partTables = new Set(growing.map(({ d }) => parts?.(d.grow!.parts)?.to));
  const sample: number[] = [],
    others: number[] = [],
    hitsOnly = items.some(({ d }) => isHit(d));
  for (const [k, a] of arrivals.entries()) {
    const { layer: l, d } = items[k],
      part = partTables.has(d.table);
    if (!hitsOnly || isHit(d))
      for (let i = 0; i < a.length; i += Math.max(1, Math.floor(a.length / 5000)))
        if (l.passes(i)) {
          sample.push(a[i]);
          if (!part) others.push(a[i]);
        }
  }
  const pct = (v: number[], f: number) => v[Math.floor(f * (v.length - 1))];
  sample.sort((a, b) => a - b);
  others.sort((a, b) => a - b);
  const t0 = pct(sample, 0.01) ?? 0,
    t1 = Math.max(pct(sample, 0.97) ?? 1, pct(others, 0.97) ?? -Infinity);
  const progress = (v: number) => Math.min(LATE, Math.max(0, (v - t0) / (t1 - t0 || 1)));

  // Path building: when each path appears and is complete, and when each of their parts lights up. The later phases
  // wait for it (`shift`).
  const built = growing.length ? buildPaths(items, growing, parts) : null;
  const shift = built ? built.end - CLUSTER[0] : 0,
    cluster0 = CLUSTER[0] + shift,
    link0 = LINK[0] + shift;

  const grouped = items.find(({ d }) => isGrouped(d)),
    shower = items.find(({ d }) => isShower(d));
  const order = [...new Set(items.flatMap(({ d }) => (d.stage === undefined ? [] : [d.stage])))].sort((a, b) => a - b);
  const stages = order.map((st, k) => ({
    start: link0 + k * STAGE[0],
    tables: items.filter(({ d }) => d.stage === st).map(({ d }) => d.table),
    name: items.find(({ d }) => d.stage === st)!.d.group,
  }));
  const startOf = (d: DisplayLayer) => (d.stage === undefined ? link0 : stages[order.indexOf(d.stage)].start);
  items.forEach(({ layer, d, emphasis }, k) => {
    const n = layer.x.length,
      a = arrivals[k],
      timeline = built?.paths.get(k);
    if (timeline) {
      layer.setTimeline(timeline.appear, timeline.done);
      layer.setRetire(REPLAY_OFF);
      return;
    }
    const appear = new Float32Array(n),
      link = built?.parts.get(k) ?? new Float32Array(n);
    const grow = d.stage === undefined ? LINK[1] : STAGE[1],
      showerLike = isShower(d),
      inGroup = isGrouped(d),
      start = startOf(d);
    for (let i = 0; i < n; i++) {
      const p = progress(a[i]),
        q = Math.min(1, p);
      if (showerLike) appear[i] = start + grow * q;
      else if (inGroup) {
        appear[i] = cluster0 + CLUSTER[1] * q;
        // grey until grouped; with stages, every object waits for the first stage, whose colours then apply (not
        // for paths: for them the second time is when a path being built is complete)
        if ((emphasis?.[i] || stages.length) && !layer.path) link[i] = link0 + LINK[1] * q;
      } else appear[i] = TRAVEL * p;
    }
    layer.setTimeline(appear, link);
    // Hits fade back as the reconstruction builds up on them, so the reconstructed objects stand out; the parts of
    // paths only if the calorimeter-like phases follow (they are what path building shows).
    if (isHit(d) && (!built?.parts.has(k) || grouped || shower))
      layer.setFade?.(cluster0, stages.length ? stages[0].start + STAGE[1] : link0 + LINK[1], 0.85);
    const next = d.stage === undefined ? undefined : stages[order.indexOf(d.stage) + 1];
    layer.setRetire(next ? next.start : REPLAY_OFF);
  });

  const linkEnd = stages.length
    ? stages[stages.length - 1].start + STAGE[1]
    : shower || grouped
      ? link0 + LINK[1]
      : built
        ? built.end
        : TRAVEL * LATE;
  const name = (x?: ReplayItem) => (x?.d.kind ? x.d.group : (x?.d.label ?? "")).toLowerCase(); // "layer clusters", not "merged"
  const paths = name(growing[0]),
    bits = built?.partsName ?? "parts";
  return {
    seconds: linkEnd + SETTLE,
    travel: TRAVEL,
    clusterStart: cluster0,
    linkStart: link0,
    linkEnd,
    stages: stages.map(({ start, tables }) => ({ start, tables })),
    ...(built
      ? {
          growth: {
            start: built.start,
            build: built.build,
            complete: built.end - FIT,
            end: built.end,
            tables: growing.map(({ d }) => d.table),
          },
        }
      : {}),
    caption(s) {
      if (s < TRAVEL * LATE)
        return random
          ? { title: "Hits appearing", detail: "in random order: these hits have no arrival times" }
          : direction
            ? {
                title: "Particles crossing the detector",
                detail: "hits appear in order of position along the direction of travel, not at measured times",
              }
            : {
                title: `t = ${(t0 + (Math.min(s, TRAVEL * LATE) / TRAVEL) * (t1 - t0)).toFixed(2)} ns after the collision`,
                detail: measured
                  ? `${Math.round((100 * measured) / total)}% of hits at their measured time, the rest at their time of flight`
                  : "times of flight from the collision point",
              };
      if (built && s < built.end) {
        if (s < built.build)
          return { title: `Seeding ${paths}`, detail: `each starts from a seed: its first ${built.seed} ${bits}` };
        if (s < built.end - FIT)
          return {
            title: `Building ${paths} outwards`,
            detail: built.seeded
              ? `each follows its path from the seed, picking up the ${bits} it crosses`
              : "each follows its path out from its start",
          };
        return {
          title: `Fitting ${paths}`,
          detail: built.seeded
            ? `a fit through all its ${bits} gives each its final path`
            : "a fit gives each its final path",
        };
      }
      if (grouped && s < link0) return { title: `Clustering hits into ${name(grouped)}` };
      if (stages.length && s < linkEnd + SETTLE) {
        const k = stages.reduce((last, st, j) => (st.start <= s ? j : last), 0);
        return {
          title:
            k === 0
              ? `Building ${stages[0].name.toLowerCase()}`
              : `${stages[k - 1].name} → ${stages[k].name.toLowerCase()}`,
          detail: `reconstruction step ${k + 1} of ${stages.length}`,
        };
      }
      if (s < linkEnd + SETTLE && (grouped || shower))
        return {
          title: shower ? `Linking ${name(grouped) || "clusters"} into ${name(shower)}` : `Grouping ${name(grouped)}`,
        };
      return null;
    },
  };
}

/** How a time column relates to the time of flight `tof`: 0 if it is an arrival time, 1 if it is corrected for
 *  the flight (about 0 for prompt particles: add it back), null if neither (then it is not used). */
function convention(col: ArrayLike<number | bigint>, tof: Float64Array): 0 | 1 | null {
  const raw = new Float64Array(tof.length),
    minus = new Float64Array(tof.length);
  let k = 0;
  for (let i = 0; i < tof.length; i++) {
    const v = Number(col[i]);
    if (Number.isFinite(v) && v > MISSING) {
      raw[k] = v;
      minus[k++] = v - tof[i];
    }
  }
  if (k < 5) return null;
  const median = (a: Float64Array) => a.subarray(0, k).sort()[k >> 1];
  return Math.abs(median(minus)) < 3 ? 0 : Math.abs(median(raw)) < 3 ? 1 : null;
}

/** Path building (see the top), for the layers of paths `growing`: per path layer (its index in `items`), when each
 *  path appears and is complete; per layer of their parts, when each part lights up (NEVER for the parts of paths not
 *  drawn: below a cut, filtered out). */
function buildPaths(items: ReplayItem[], growing: ReplayItem[], parts?: Parts) {
  // Each path layer's parts and the index of their layer in `items` (-1: not drawn). Without parts drawn there is
  // nothing to seed: the building starts at once.
  const links = growing.map(({ d }) => {
    const rel = d.grow && parts?.(d.grow.parts);
    return { rel, k: rel ? items.findIndex((it) => it.d.table === rel.to) : -1 };
  });
  const named = links.map(
    ({ rel, k }) =>
      rel?.name ?? (k >= 0 ? (items[k].d.kind ? items[k].d.group : items[k].d.label).toLowerCase() : undefined),
  );
  const seeded = links.some(({ k }) => k >= 0),
    seed = growing[0].d.grow?.seed ?? SEED,
    partsName = named.find((x) => x);
  const start = TRAVEL * LATE,
    build = seeded ? start + SEEDS + PAUSE : start,
    end = build + BUILD + FIT;
  const paths = new Map<number, { appear: Float32Array; done: Float32Array }>(),
    lit = new Map<number, Float32Array>();
  for (const [g, item] of growing.entries()) {
    const { layer, d } = item,
      path = layer.path!,
      n = layer.x.length;
    // Arc length of each drawn path, from its polyline (the piece joining the arc to the end point is drawn last).
    const length = new Float32Array(n),
      drawn: number[] = [];
    for (let i = 0; i < n; i++)
      if (layer.passes(i)) {
        drawn.push(i);
        length[i] = arcLength(path, i);
      }
    const sorted = drawn.map((i) => length[i]).sort((a, b) => a - b),
      longest = sorted[Math.floor(0.9 * (sorted.length - 1))] || 1;
    const appear = new Float32Array(n).fill(build),
      done = new Float32Array(n).fill(build + BUILD);
    for (const i of drawn) done[i] = build + BUILD * Math.max(0.05, Math.min(1, length[i] / longest)); // one speed
    paths.set(items.indexOf(item), { appear, done });

    const { rel, k } = links[g];
    if (!rel || k < 0) continue;
    const hits = items[k].layer,
      first = d.grow?.seed ?? SEED;
    let out = lit.get(k);
    if (!out) lit.set(k, (out = new Float32Array(hits.x.length).fill(NEVER)));
    for (const i of drawn) {
      const seededAt = start + SEEDS * ((Math.imul(i + 1, 2654435761) >>> 0) / 4294967296),
        from = rel.offsets[i];
      for (let m = from; m < rel.offsets[i + 1]; m++) {
        const h = rel.indices[m];
        const t =
          m - from < first ? seededAt : build + (done[i] - build) * along(path, i, hits.x[h], hits.y[h], hits.z[h]);
        if (t < out[h]) out[h] = t; // a part of several paths: the first to reach it
      }
    }
  }
  return { start, build, end, seed, seeded, partsName, paths, parts: lit };
}

/** The arc length of path i, from its polyline (the piece joining the arc to the end point is drawn last: not
 *  counted). */
function arcLength(path: NonNullable<Layer["path"]>, i: number) {
  const P = path.points,
    { x, y, z } = path;
  path.fill(i);
  let length = 0;
  for (let j = i * P; j < i * P + P - 2; j++) length += Math.hypot(x[j + 1] - x[j], y[j + 1] - y[j], z[j + 1] - z[j]);
  return length;
}

/** The tour's grow-in (ui/tour.ts): the objects of `layers` appear over `seconds`, outwards from the collision point
 *  (by distance: the bulk of them, 1st to 97th percentile, spread over the time), and paths grow from their starts at
 *  one speed (a path as long as the longest tenth takes all of it). Only these layers' clocks should run
 *  (Engine.replay `only`): the others stay as they are. */
export function growIn(layers: Layer[], seconds: number) {
  const sample: number[] = [],
    dist = (l: Layer, i: number) => Math.hypot(l.x[i], l.y[i], l.z[i]);
  for (const l of layers)
    if (!l.path)
      for (let i = 0; i < l.x.length; i += Math.max(1, Math.floor(l.x.length / 5000)))
        if (l.passes(i)) sample.push(dist(l, i));
  sample.sort((a, b) => a - b);
  const d0 = sample[Math.floor(0.01 * (sample.length - 1))] ?? 0,
    d1 = sample[Math.floor(0.97 * (sample.length - 1))] ?? 1;
  for (const l of layers) {
    const n = l.x.length,
      appear = new Float32Array(n),
      done = new Float32Array(n);
    if (l.path) {
      const length = new Float32Array(n),
        drawn: number[] = [];
      for (let i = 0; i < n; i++)
        if (l.passes(i)) {
          drawn.push(i);
          length[i] = arcLength(l.path, i);
        }
      const sorted = drawn.map((i) => length[i]).sort((a, b) => a - b),
        longest = sorted[Math.floor(0.9 * (sorted.length - 1))] || 1;
      for (const i of drawn) done[i] = seconds * Math.max(0.05, Math.min(1, length[i] / longest));
    } else {
      for (let i = 0; i < n; i++) appear[i] = seconds * Math.min(1, Math.max(0, (dist(l, i) - d0) / (d1 - d0 || 1)));
      done.set(appear); // in their colours as they appear
    }
    l.setTimeline(appear, done);
    l.setRetire(REPLAY_OFF);
    l.setFade?.(0, 1, 0);
  }
}

/** How far along path i's arc (0 to 1) its polyline comes nearest to (x, y, z); the piece joining the arc to the end
 *  point counts as the end of the arc. */
function along(path: NonNullable<Layer["path"]>, i: number, x: number, y: number, z: number) {
  const P = path.points,
    o = i * P,
    px = path.x,
    py = path.y,
    pz = path.z;
  let best = Infinity,
    f = 0;
  for (let j = 0; j < P - 1; j++) {
    const ax = px[o + j],
      ay = py[o + j],
      az = pz[o + j],
      dx = px[o + j + 1] - ax,
      dy = py[o + j + 1] - ay,
      dz = pz[o + j + 1] - az;
    const ll = dx * dx + dy * dy + dz * dz,
      u = ll > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / ll)) : 0;
    const ex = ax + u * dx - x,
      ey = ay + u * dy - y,
      ez = az + u * dz - z,
      d2 = ex * ex + ey * ey + ez * ez;
    if (d2 < best) {
      best = d2;
      f = Math.min(1, (j + u) / (P - 2));
    }
  }
  return f;
}
