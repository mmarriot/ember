// Identity colouring: which key (object, or truth branch) each object takes its colour from, and which keys get
// one of the palette's slots (render/colour.ts draws them).
import type { DisplayLayer, EventData, Header, Table } from "../../io/format";
import { cached } from "../event/cache";
import { bestPartners } from "../event/relations";
import { facts, isFactTable, simEnergyIn } from "../truth/facts";
import type { TruthClass } from "../truth/levelFlags";

/** The rule the truth colours give their slots by (model/event/relations.ts identities), as the colour key's title says it:
 *  - `selection`: the particles the selection and its parts are matched to or hold simulated energy in, first;
 *  - `by`: then the rest by simulated energy in one detector of the domain (`in`: the domain, `detectors`: those it
 *    has), by pT among the particles the domain's reco objects are matched to, or by pT among the signal particles. */
export interface SlotRule {
  selection: boolean;
  by: "simEnergy" | "matchedPt" | "pt" | "size";
  in?: string;
  detectors?: string[];
  column?: string; // "size": the layer's colour column
}
/** The key's title for a rule: "top 7 by simulated energy in HGCal". */
export function ruleText(rule: SlotRule, slots: number) {
  const rest =
    rule.by === "simEnergy"
      ? rule.detectors && rule.detectors.length > 1
        ? `by simulated energy within each of ${rule.detectors.join(", ")}, in turn`
        : `by simulated energy in ${rule.in}`
      : rule.by === "matchedPt"
        ? `by pT among the particles matched to ${rule.in} objects`
        : rule.by === "pt"
          ? "signal particles by pT"
          : `by ${rule.column ?? "size"}`;
  return rule.selection
    ? "the selection's particles: those its parts are matched to, then those that left simulated energy in its hits"
    : `top ${slots} ${rest}`;
}

/** How the truth colours give their slots (identities): the domain looked at (null: all of them), the particles the
 *  selection and its parts point at (rows; undefined without a selection), and the level that groups the particles
 *  (a mask of level-flag bits; undefined: the layer's `particle` bit). */
export interface SlotRank {
  domain?: string | null;
  prefer?: number[];
  level?: number;
  /** Only the level's particles take slots (the b / c hadron level: the rest stays grey). */
  only?: boolean;
  /** A class level's classes (model/truth/truth.ts ColourLevel): one colour per class, no slots (truthClasses). */
  classes?: TruthClass[];
}

/** Identity colouring of a table (render/colour.ts): per object, the key whose colour it takes, and the keys that get
 *  a colour of their own (`top`, at most `slots`), and the rule they were chosen by (`rule`, model/truth/truth.ts).
 *  `others`: keys in use beyond `top`; `parent`: each object's first parent, -1 for none, and `anchor`: 1 for the
 *  particles that own hits or are matched (truth tables only);
 *  `preferred`: how many of `top` the selection points at (rank.prefer).
 *  Every object is its own key, except in a truth table (`truth`) with a parent ->
 *  children relation (truth particles), where colours follow truth branches:
 *  - anchors are the particles something points at: those that own hits (an association into a hit layer; the
 *    particles that entered the calorimeter) and those a reco object is matched to (an association into the table);
 *  - with a `particle` level (docs/truth.md: e.g. generator-level stable particles), a particle takes the key of its
 *    highest ancestor in the level (or itself without one): the electrons of a converted photon, the daughters of a
 *    π⁺ that interacted in the tracker and a shower's secondaries all share their generator particle's colour, in
 *    every part of the detector. `rank.level` chooses another level. Without a level, the key is its highest anchor
 *    ancestor (or itself);
 *  - only anchors' keys use colours (`used`): a particle linked to nothing (e.g. a quark) takes none;
 *  - with the level's `first` column (e.g. isSignal), only its keys take colours: signal, never pile-up; keys in the
 *    level come before those above it (a π⁰ matched as a whole), and with `rank.only` only they take colours (the
 *    b / c hadron level: the particles outside every b or c hadron stay grey);
 *  - the slots (docs/truth.md "Which particles get a colour"): first the keys the selection points at (rank.prefer),
 *    then, in a calorimeter's domain, by simulated energy in its hits, ranked within each detector and taken from the
 *    detectors in turn (never compared across detectors); without calorimeter hits there, by pT among the particles
 *    its reco objects are matched to; elsewhere (Physics, all of them) by pT, |η| < 5 first. Keys with nothing in the
 *    domain take no slot. */
export function identities(
  d: DisplayLayer,
  t: Table,
  ev: EventData,
  header: Header,
  slots: number,
  rank: SlotRank = {},
) {
  const mask = rank.level ?? (d.particle ? 2 ** d.particle.bit : 0);
  const { key, used, bySize, parent, anchor } = cached(
    ev,
    `identities|${d.table}|${d.truth}|${d.colour}|${d.particle?.flags}|${mask}|${d.particle?.first}`,
    () => identityKeys(d, t, ev, header, mask),
  );
  // With a `first` column, only its keys take colours (pile-up never looks like a signal particle).
  const first = d.particle?.first ? t.columns[d.particle.first] : undefined,
    flags = d.particle ? t.columns[d.particle.flags] : undefined,
    eligible = bySize.filter(
      (k) => (!first || Number(first[k])) && (!rank.only || !flags || (Number(flags[k]) & mask) !== 0),
    );
  // The slot order depends on the event, the domain and the level only: once each (not on every selection). The
  // callers that only want the keys (slots 0: a lineage, a pair) skip it.
  const { order, rule } =
    slots > 0
      ? cached(
          ev,
          `slots|${d.table}|${d.truth}|${d.colour}|${d.particle?.first}|${mask}|${rank.only}|${rank.domain ?? ""}`,
          () => rankKeys(d, t, ev, header, eligible, key, mask, rank.domain ?? null),
        )
      : { order: [], rule: { by: "size" as const } };
  // The selection's particles first, by their keys, in the order given.
  const ok = new Set(eligible),
    preferred: number[] = [];
  for (const r of rank.prefer ?? []) {
    const k = key[r];
    if (k !== undefined && ok.has(k) && !preferred.includes(k)) preferred.push(k);
  }
  const rest = order.filter((k) => !preferred.includes(k)),
    top = [...preferred, ...rest].slice(0, slots);
  return {
    key,
    used,
    parent,
    anchor,
    top,
    others: Math.max(0, eligible.length - top.length),
    rule: { ...rule, selection: rank.prefer !== undefined } as SlotRule,
    preferred: Math.min(preferred.length, slots),
  };
}

/** Each truth particle's class under a class level (model/truth/truth.ts ColourLevel `classes`): the first class with a bit
 *  of its nearest ancestor (or itself) that has any of the classes' bits; without one, the class without bits (all
 *  of the signal collision) or else `classes.length` (the rest of the signal collision). Pile-up (the level's `first`
 *  column 0) is `classes.length + 1`, whatever its bits (the underlying-event bit is set on pile-up too). Once per
 *  event and level: a walk up the first parents, O(particles x depth). */
export function truthClasses(d: DisplayLayer, t: Table, ev: EventData, header: Header, classes: TruthClass[]) {
  return cached(ev, `classes|${d.table}|${classes.map((c) => `${c.name}:${c.mask}`).join(",")}`, () => {
    const { parent } = identities(d, t, ev, header, 0),
      flags = d.particle ? t.columns[d.particle.flags] : undefined,
      first = d.particle?.first ? t.columns[d.particle.first] : undefined,
      any = classes.reduce((m, c) => m | (c.mask ?? 0), 0),
      all = classes.findIndex((c) => c.mask === undefined),
      out = new Uint8Array(t.n);
    for (let i = 0; i < t.n; i++) {
      if (first && !Number(first[i])) {
        out[i] = classes.length + 1;
        continue;
      }
      let f = 0; // the bits of the nearest particle with any (at most n steps: no endless loop on a cycle)
      for (let j = i, steps = 0; any && flags && j >= 0 && steps < t.n && !f; j = parent[j], steps++)
        f = Number(flags[j]) & any;
      const k = f ? classes.findIndex((c) => (c.mask ?? 0) & f) : -1;
      out[i] = k >= 0 ? k : all >= 0 ? all : classes.length;
    }
    return out;
  });
}

/** The eligible keys in slot order, and the rule used (see identities): one pass over the domain's hit-index
 *  relations (O(entries)), once per event, domain and level (identities caches it). */
function rankKeys(
  d: DisplayLayer,
  t: Table,
  ev: EventData,
  header: Header,
  eligible: number[],
  key: Int32Array,
  mask: number,
  domain: string | null,
): { order: number[]; rule: Omit<SlotRule, "selection"> } {
  const own = domain ? header.domains?.find((x) => x.name === domain) : undefined,
    flags = d.particle ? t.columns[d.particle.flags] : undefined,
    above = (k: number) => (flags && !(Number(flags[k]) & mask) ? 1 : 0); // keys in the level first
  const inDomain = (table: string) => header.display.find((l) => l.table === table)?.domain === domain;
  if (own && !own.shared && d.truth) {
    // Calorimeter facts only (hits drawn as cells): simulated energy in a muon chamber says little of a particle's
    // size, and the pT rule below serves it better.
    const mine = facts(header).filter(
      (f) =>
        f.from === d.table &&
        inDomain(f.to) &&
        ev.relations[f.name] &&
        header.display.find((l) => l.table === f.to)?.repr === "cells",
    );
    if (mine.length) {
      // Simulated energies of different calorimeters are never compared (sampling fractions differ; HF counts
      // photoelectrons): each detector ranks its own keys, and the slots take each detector's next in turn.
      const detectors = [...new Set(mine.map((f) => f.in))];
      const lists = detectors.map((det) => {
        const sum = simEnergyIn(ev, header, mine, det, t.n, key); // per key, in this detector only
        return eligible.filter((k) => sum[k] > 0).sort((a, b) => above(a) - above(b) || sum[b] - sum[a] || a - b);
      });
      const order: number[] = [],
        taken = new Set<number>();
      for (let i = 0; lists.some((l) => i < l.length); i++)
        for (const l of lists)
          if (i < l.length && !taken.has(l[i])) {
            taken.add(l[i]);
            order.push(l[i]);
          }
      return { order, rule: { by: "simEnergy", in: domain!, detectors } };
    }
    // No simulated energy there (the tracker): the particles its reco objects are matched to, by pT.
    const matched = new Set<number>();
    for (const [name, info] of Object.entries(header.relations)) {
      const rel = ev.relations[name];
      if (!rel || !info.association || info.to !== d.table || !info.match || !inDomain(info.from)) continue;
      for (const p of bestPartners(rel, info, true, ev.tables[info.from]?.n ?? 0).partner)
        if (p >= 0) matched.add(key[p]);
    }
    const pt = t.columns.pt;
    if (matched.size && pt)
      return {
        order: eligible
          .filter((k) => matched.has(k))
          .sort((a, b) => above(a) - above(b) || Number(pt[b]) - Number(pt[a]) || a - b),
        rule: { by: "matchedPt", in: domain! },
      };
  }
  const pt = t.columns.pt,
    eta = t.columns.eta;
  if (!pt || !d.truth) return { order: eligible, rule: { by: "size", column: d.colour ?? undefined } };
  const central = (k: number) => (eta && Math.abs(Number(eta[k])) >= 5 ? 1 : 0);
  return {
    order: [...eligible].sort(
      (a, b) => above(a) - above(b) || central(a) - central(b) || Number(pt[b]) - Number(pt[a]) || a - b,
    ),
    rule: { by: "pt" },
  };
}

/** The part of `identities` that does not depend on the selection, once per event: keys, which keys are in use, and
 *  the keys in use largest first. */
function identityKeys(d: DisplayLayer, t: Table, ev: EventData, header: Header, mask: number) {
  const n = t.n,
    anchor = new Uint8Array(n),
    parent = new Int32Array(n).fill(-1),
    key = new Int32Array(n);
  for (let i = 0; i < n; i++) key[i] = i;
  if (d.truth) {
    for (const [name, info] of Object.entries(header.relations)) {
      const rel = ev.relations[name];
      if (!rel) continue;
      if (info.association && info.from === d.table && isFactTable(header, info.to)) {
        for (let f = 0; f < n && f + 1 < rel.offsets.length; f++)
          if (rel.offsets[f + 1] > rel.offsets[f]) anchor[f] = 1;
      } else if (info.association && info.to === d.table) {
        for (const r of rel.indices) anchor[r] = 1;
      } else if (!info.association && info.from === d.table && info.to === d.table) {
        for (let f = 0; f + 1 < rel.offsets.length; f++)
          for (let k = rel.offsets[f]; k < rel.offsets[f + 1]; k++)
            if (parent[rel.indices[k]] < 0) parent[rel.indices[k]] = f;
      }
    }
    const flags = d.particle ? t.columns[d.particle.flags] : undefined;
    const member = flags ? (j: number) => Number(flags[j]) & mask : (j: number) => anchor[j];
    // Each particle walks up to its root, keeping the highest member seen (at most n steps: no endless loop on bad
    // data with a cycle).
    for (let i = 0; i < n; i++)
      for (let j = i, steps = 0; j >= 0 && steps < n; j = parent[j], steps++) if (member(j)) key[i] = j;
  }
  const used = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!d.truth || anchor[i]) used[key[i]] = 1;
  const col = d.colour ? t.columns[d.colour] : undefined,
    first = d.particle?.first ? t.columns[d.particle.first] : undefined,
    bySize: number[] = [];
  for (let i = 0; i < n; i++) if (used[i]) bySize.push(i);
  // Signal first, then particles of the level before keys above it (e.g. a K*0 an object is matched to as a whole:
  // its energy counts all its daughters', and it would take the colours of the particles that own the hits).
  const flags = d.particle ? t.columns[d.particle.flags] : undefined;
  const rank = (i: number) => (first && Number(first[i]) ? 2 : 0) + (flags && Number(flags[i]) & mask ? 1 : 0);
  if (col || first || flags)
    bySize.sort((a, b) => rank(b) - rank(a) || (col ? Number(col[b]) - Number(col[a]) : 0) || a - b);
  return { key, used, bySize, parent, anchor }; // parent: each object's first parent (-1 none), truth tables only
}
