// The selection, the focus and what they show.
//
// The selection is the object the card describes. The focus is the object clicked from outside any focus: while it
// lasts, its objects in the ticked collections stand out and only they can be picked. Which collections are drawn is
// the user's ticks alone: a focus never draws an unticked one (but for the selected object itself) nor hides a ticked
// one. Its levels (`levels`) are steps of ticks: ↓ ↑ move the tick from one to the next. Selecting one of its objects
// keeps the focus; selecting anything else focuses on it (the old one kept for "back"); clearing the selection ends it.
//
// Looking at an object from another's card (`look`): the view shows it as any selection, while the card stays on its
// own object, the `anchor`. Any other selection ends the look, and "back" is the card's object, in its own focus.
import { batch, computed, effect, signal } from "@preact/signals";
import type { DisplayLayer } from "../../io/format";
import { recoLadder, recoOfTruth } from "../event/chain";
import { focusLevels, type Level, mergeAcrossDomains, partsFirst, scopeLevels, stepLevel } from "../event/levels";
import { delegatedPart, PAIR, type Pair, pairFor, pairShows } from "../truth/pair";
import { matchClass, simEnergyByParticle } from "../truth/match";
import type { SlotRank } from "../colour/identities";
import { cached } from "../event/cache";
import { levelsOf, type Related, relatedParts, sameRef, type Ref } from "../event/relations";
import { activeMode, modes, truthGraph, truthLevel, truthStatuses } from "./colours";
import { truthStatement } from "../truth/statement";
import { isFactTable } from "../truth/facts";
import { bundle, event } from "./data";
import { layerKey, layerOf } from "./names";
import { placeAt, shownTops, truthDrawn, truthLinked, truthLooked, truthPicks } from "./truthView";
import { domain, drawnLayers, shared, visible } from "./view";

// ---- The selection and the focus

/** The object selected (the card's, unless another is looked at), or null. */
export const selection = signal<Ref | null>(null);
/** The focus: the object whose parts are drawn and pickable, or null. Follows the selection (see the effect below). */
export const focus = signal<Ref | null>(null);
/** Earlier focuses, oldest first: "back" returns to the last one. */
export const focusHistory = signal<Ref[]>([]);

/** The card's own object while another is looked at (see `look`), else null. */
export const anchor = signal<Ref | null>(null);
/** The selection made by `look`, which keeps the anchor (any other selection ends the look). */
let looking: Ref | null = null;
/** The focus the card's object was shown in: the object itself, or what it is a part of. */
let anchorFocus: Ref | null = null;
/** The object the card describes: the anchor while another is looked at, else the selection. */
export const subject = computed(() => anchor.value ?? selection.value);

/** What `ref` is made of, part of and linked to (relatedParts), or null without it in the event. */
const partsOf = (ref: Ref | null) => {
  const b = bundle.value,
    ev = event.value;
  return b && ev && ref && ref.row < (ev.tables[ref.table]?.n ?? 0) ? relatedParts(ev, b.header, ref) : null;
};
/** The focus is one of the particles the Truth tab draws (truthView.ts truthShown: a pick, or the one looked at; any of
 *  its generator copies). */
export const focusPicked = computed(() => {
  const f = focus.value,
    tg = truthGraph.value;
  return !!f && !!tg && f.table === tg.particles && shownTops.value.has(tg.graph.top[f.row]);
});
/** The focus's relatives. While it is one of the picks, what is linked to it is what is linked to the truth drawn for
 *  all of them (truthView.ts truthLinked): with "particle only", not its descendants' hits and matches. */
const focusParts = computed(() => {
  const parts = partsOf(focus.value),
    linked = focusPicked.value ? truthLinked.value : null;
  return parts && linked ? { ...parts, linked } : parts;
});
/** The selection's relatives: what it is made of, part of and linked to (its truth particle). */
export const relatives = computed(() =>
  sameRef(selection.value, focus.value) ? focusParts.value : partsOf(selection.value),
);
const subjectParts = computed(() => (anchor.value ? partsOf(anchor.value) : relatives.value));

/** Look at `ref` in the view, keeping the card on its object; on the card's own object, go back to it. */
export function look(ref: Ref) {
  const a = anchor.peek(),
    sel = selection.peek();
  if (sameRef(sel, ref)) return;
  if (sameRef(a, ref)) return unlook();
  batch(() => {
    // The focus moves there without history: "back" is the card's object.
    if (!a && sel) {
      anchor.value = sel;
      anchorFocus = focus.peek();
    }
    looking = { ...ref };
    focus.value = looking;
    selection.value = looking;
  });
}

/** Back to the card's own object, in the focus it was shown in. */
export function unlook() {
  const a = anchor.peek(),
    f = anchorFocus ?? a;
  if (!a) return;
  batch(() => {
    anchor.value = null;
    looking = null;
    anchorFocus = null;
    focus.value = f;
    selection.value = a;
  });
}

/** Open the card of `ref` (the object looked at, or another): the card's object so far is kept for "back". */
export function openCard(ref: Ref) {
  const a = anchor.peek(),
    home = anchorFocus ?? a;
  batch(() => {
    if (home) {
      focusHistory.value = [...focusHistory.peek(), home];
      anchor.value = null;
      looking = null;
      anchorFocus = null;
    }
    if (!sameRef(selection.peek(), ref)) {
      if (!a) focusOn(ref);
      else focus.value = { ...ref };
      selection.value = { ...ref };
    }
  });
}

/** Focus on `ref`, keeping the current focus for "back" (while looking, the card's object). */
export function focusOn(ref: Ref) {
  const f = focus.peek(),
    from = anchor.peek() ? (anchorFocus ?? anchor.peek()) : f;
  if (sameRef(f, ref)) return;
  if (from) focusHistory.value = [...focusHistory.peek(), from];
  focus.value = { ...ref };
}

/** Back to the previous focus; returns it (null if there is none). */
export function focusBack(): Ref | null {
  const h = focusHistory.peek(),
    prev = h[h.length - 1];
  if (!prev) return null;
  focusHistory.value = h.slice(0, -1);
  focus.value = prev;
  return prev;
}

// ---- What the card shows

/** The ladder of the card's object (event/chain.ts recoLadder); null for a truth object. */
export const ladder = computed(() => {
  const b = bundle.value,
    ev = event.value,
    sel = subject.value,
    parts = subjectParts.value;
  if (!b || !ev || !sel || !parts || layerOf(sel.table)?.truth) return null;
  return recoLadder(ev, b.header, sel, parts, truthStatuses.value);
});

/** What the truth says about the card's reco object (truth/statement.ts); null for a truth object, and in a bundle
 *  without truth. */
export const statement = computed(() => {
  const b = bundle.value,
    ev = event.value,
    l = ladder.value;
  return b && ev && l && modes.value.roots.truth ? truthStatement(ev, b.header, l, truthStatuses.value) : null;
});

/** For a truth object on the card: what was reconstructed from it, and the hits it left (event/chain.ts
 *  recoOfTruth); null for anything else. */
export const reconstructed = computed(() => {
  const b = bundle.value,
    ev = event.value,
    sel = subject.value;
  if (!b || !ev || !sel || !layerOf(sel.table)?.truth || sel.row >= (ev.tables[sel.table]?.n ?? 0)) return null;
  // the vertices at one place are one for reco (truth/places.ts): its reco is that of all of them
  const place = sel.table === truthGraph.value?.vertices ? placeAt(sel.row) : null;
  return recoOfTruth(ev, b.header, sel, place?.rows);
});

/** What the associator says of a reco object of a matched kind (truth/match.ts matchClass), for its name's colour in
 *  lists; undefined for any other kind. */
export function matchOf(table: string, row: number) {
  const b = bundle.value,
    ev = event.value,
    s = truthStatuses.value.get(table);
  return b && ev && s?.kind === "match" ? matchClass(ev, b.header, s.relation, row) : undefined;
}

// ---- What the view highlights

/** A hit opens its particle's pair only on request (the card's button); reset with each new focus. */
export const hitPair = signal(false);

/** In the "pid" and "truth" modes, the focus's truth <-> reco pair (truth/pair.ts), which colours every layer. Null
 *  when it has nothing to show, for a kind with no association of its own (unless it stands in for a part), and in a
 *  bundle without truth. */
export const pairView = computed<Pair | null>(() => {
  const f = focus.value,
    b = bundle.value,
    ev = event.value,
    { roots } = modes.value;
  if (activeMode.value === "layers" || !f || !b || !ev || !roots.truth || f.row >= (ev.tables[f.table]?.n ?? 0))
    return null;
  if (isFactTable(b.header, f.table) && !hitPair.value) return null;
  let pair = pairFor(ev, b.header, f, roots.truth);
  const part = pair ? null : delegatedPart(ev, b.header, f, roots.truth);
  const theirs = part && pairFor(ev, b.header, part, roots.truth);
  if (theirs) pair = { ...theirs, via: f };
  return pair && pairShows(pair) ? pair : null;
});

/** What the truth colours' slots depend on (colour/identities.ts SlotRank), in the truth mode: the domain, the level
 *  and, for a selection with no pair of its own, the particles its parts are matched to (by pT), then those that left
 *  simulated energy in its hits. Outside the truth mode, nothing. */
export const truthRank = computed<SlotRank>(() => {
  const b = bundle.value,
    ev = event.value,
    root = modes.value.roots.truth,
    sel = selection.value;
  if (activeMode.value !== "truth" || !b || !ev || !root) return {};
  const level = truthLevel.value,
    base = level?.classes
      ? { domain: domain.value, classes: level.classes }
      : { domain: domain.value, level: level?.mask, only: level?.only };
  const parts = relatives.value;
  if (!sel || pairView.value || !parts || level?.classes) return base; // a class level has no slots to give
  const pt = ev.tables[root]?.columns.pt,
    matched = [...(parts.linked.get(root) ?? [])].sort((a, c) => (pt ? Number(pt[c]) - Number(pt[a]) : a - c));
  const deposits = simEnergyByParticle(ev, b.header, parts.madeOf).flatMap((g) => g.particles.map(([p]) => p));
  return { ...base, prefer: [...(sel.table === root ? [sel.row] : []), ...matched, ...deposits] };
});

/** In the truth mode, the truth particles drawn without a selection (the layer is otherwise drawn only for one): the
 *  signal particles of the colour level with pT >= 1 GeV. Undefined in other modes, or for another layer. Once per
 *  event and level. */
export function truthPreview(d: DisplayLayer): Set<number> | undefined {
  const ev = event.peek(),
    t = ev?.tables[d.table];
  if (activeMode.peek() !== "truth" || !d.truth || !d.particle || !ev || !t) return undefined;
  const mask = truthLevel.peek()?.mask || 2 ** d.particle.bit, // a class level of no bits (collision): the profile's
    flags = t.columns[d.particle.flags],
    first = d.particle.first ? t.columns[d.particle.first] : undefined,
    pt = t.columns.pt;
  if (!flags || !pt) return undefined;
  return cached(ev, `preview|${d.table}|${mask}`, () => {
    const rows = new Set<number>();
    for (let i = 0; i < t.n; i++)
      if (Number(flags[i]) & mask && (!first || Number(first[i])) && Number(pt[i]) >= 1) rows.add(i);
    return rows;
  });
}

/** The focus's own highlight (see highlight), before the truth picks. */
const focusHighlight = computed(() => {
  const b = bundle.value,
    ev = event.value,
    f = focus.value,
    parts = focusParts.value,
    pair = pairView.value;
  if (pair && f && b) {
    const hl: Related = new Map([[f.table, new Set([f.row])]]);
    // Missed layer clusters stay in the background: their hits show the same, and the many one-hit clusters of a
    // shower's halo would otherwise cover the clusters that were used (markers are drawn on top of the hits).
    const markers = new Set(b.header.display.filter((d) => d.repr === "markers").map((d) => d.table));
    for (const [t, cls] of pair.classes) {
      const rows = hl.get(t) ?? new Set<number>(),
        skip = markers.has(t) ? PAIR.missed : -1;
      for (let i = 0; i < cls.length; i++) if (cls[i] !== PAIR.other && cls[i] !== skip) rows.add(i);
      if (rows.size) hl.set(t, rows);
    }
    // For a reco focus, also the reco objects linked to it (a track's vertex), which the pair may not classify. Not a
    // truth particle's associations: every object one names (at any score) would look like part of the pair.
    if (!layerOf(f.table)?.truth)
      for (const [t, rows] of parts?.linked ?? [])
        if (!layerOf(t)?.truth) hl.set(t, new Set([...(hl.get(t) ?? []), ...rows]));
    return hl;
  }
  return b && ev && f && parts ? levelsOf(ev, b.header, f, parts) : null;
});
/** What is drawn highlighted, per table: the focus, its levels and what is linked to it; in the pair view, the pair's
 *  objects. Not what contains the focus: big containers would cover it. While the focus is one of the Truth tab's
 *  picks, the truth particles and vertices are the picks' (truthView.ts truthDrawn: each alone or with its
 *  descendants), and so are the hits and reco objects linked to them (focusParts); in the pair view those stay the
 *  pair's, the last pick's. Another focus (an object looked at from a card, a truth vertex) keeps its own. Null
 *  without a focus. */
export const highlight = computed(() => {
  const hl = focusHighlight.value,
    drawn = truthDrawn.value;
  return hl && drawn && focusPicked.value ? new Map([...hl, ...drawn]) : hl;
});

/** What framing the focus fits in the view: the highlight less what is only linked to it, which can lie far away (a
 *  low-pT particle's helix curls 80 cm across the tracker). Null without a focus. */
export const framed = computed(() => {
  const hl = highlight.value,
    f = focus.value,
    linked = focusParts.value?.linked;
  if (!hl || !f || !linked?.size) return hl;
  const out: Related = new Map();
  for (const [t, rows] of hl) {
    const away = linked.get(t),
      keep = away ? new Set([...rows].filter((r) => !away.has(r) || (t === f.table && r === f.row))) : rows;
    if (keep.size) out.set(t, keep);
  }
  return out;
});

/** What the focus is part of (a muon's jet), per table; null without a focus. */
const focusParents = computed(() => focusParts.value?.partOf ?? null);
/** For a layer the view does not draw whole, the rows drawn for the focus: of a ticked layer the view leaves out
 *  (another part of the detector's, or one kind looked at alone), the focus's objects and, in a shared part, what it is
 *  part of (a muon's jet); of an unticked layer, only the selected object and the focus themselves, and while the focus
 *  is one of the Truth tab's picks, the truth particles and vertices drawn for them. Undefined for a layer drawn whole,
 *  without a focus, or with none of these rows. */
export const focusRows = (d: DisplayLayer) => {
  const key = layerKey(d),
    hl = highlight.value;
  if (!hl || drawnLayers.value[key]) return undefined;
  let rows: Set<number>;
  if (visible.value[key]) {
    const parents = d.domain && shared.value.has(d.domain) ? (focusParents.value?.get(d.table) ?? []) : [];
    rows = new Set([...(hl.get(d.table) ?? []), ...parents]);
  } else {
    rows = new Set([focus.value, selection.value].filter((r) => r?.table === d.table).map((r) => r!.row));
    // The picks' truth (with their vertices) is drawn whatever the ticks.
    if (focusPicked.value) for (const r of truthDrawn.value?.get(d.table) ?? []) rows.add(r);
  }
  return rows.size ? rows : undefined;
};

/** Objects linked to the focus through an association: a click on one moves the focus there. */
export const focusLinked = computed(() => focusParts.value?.linked ?? null);
/** The focus is a truth object. */
export const focusIsTruth = computed(() => !!focus.value && !!layerOf(focus.value.table)?.truth);

/** Whether an object can be picked: anything without a focus; with one, its highlighted objects but itself (so a
 *  click reaches what it is made of). */
export const inFocus = (table: string, row: number) => {
  const hl = highlight.peek();
  return !hl || (!!hl.get(table)?.has(row) && !sameRef(focus.peek(), { table, row }));
};

// The focus follows the selection: a selection outside it becomes the focus, no selection ends it. A selection made
// while another object is looked at ends the look (the card's object kept for "back").
effect(() => {
  const sel = selection.value,
    a = anchor.peek();
  if (a && !sameRef(sel, looking)) {
    const home = anchorFocus ?? a,
      h = focusHistory.peek(),
      inView = !!sel && !!highlight.peek()?.get(sel.table)?.has(sel.row);
    anchor.value = null;
    looking = null;
    anchorFocus = null;
    if (sel && !sameRef(sel, a) && !sameRef(h.at(-1) ?? null, home)) focusHistory.value = [...h, home];
    if (sameRef(sel, a)) focus.value = home;
    else if (sel && !inView) focus.value = { ...sel }; // not focusOn: it would keep the object looked at for back
    if (sel) return;
  }
  if (sel && !highlight.peek()?.get(sel.table)?.has(sel.row)) focusOn(sel);
  else if (!sel) {
    focus.value = null;
    if (focusHistory.peek().length) focusHistory.value = [];
  }
});

// ---- Picking truth particles (the Truth tab's graph)

/** Look at truth particle `row` (a click on its name), as any new selection: the card describes it, the focus is on
 *  it (the earlier focus kept for "back") and the view draws it with the picks, highlighted. The ticks stay as they
 *  are: only a tick changes them. */
export function selectTruth(row: number) {
  const t = truthGraph.peek()?.particles;
  if (t === undefined) return;
  const ref = { table: t, row };
  batch(() => {
    truthLooked.value = row;
    openCard(ref);
    if (!sameRef(focus.peek(), ref)) focusOn(ref); // selected already, inside another focus
  });
}
/** Tick truth particle `row` (add it to the picks, and look at it), or untick it if it is one (any of its generator
 *  copies): unticking the particle looked at moves the card to the last pick left, or closes it. Not a new choice for
 *  "back", which returns to before the first pick. */
export function togglePick(row: number) {
  const tg = truthGraph.peek();
  if (!tg) return;
  const top = tg.graph.top,
    picks = truthPicks.peek(),
    rest = picks.filter((r) => top[r] !== top[row]),
    adds = rest.length === picks.length,
    looked = truthLooked.peek(),
    within = focusPicked.peek();
  batch(() => {
    truthPicks.value = adds ? [...picks, row] : rest;
    const next = adds ? row : looked !== null && top[looked] === top[row] ? (rest.at(-1) ?? null) : looked;
    if (next === looked && !adds) return; // another pick left: the card stays
    truthLooked.value = next;
    if (next === null) selection.value = null;
    else lookAtShown(tg.particles, next, within);
  });
}
/** Ticks or unticks truth particles `rows` together (a particle and all below it). Ticking looks at the first of them
 *  unless the one looked at is among them; unticking leaves the card where it is (the particle looked at stays drawn,
 *  ticked or not). */
export function setPicks(rows: number[], on: boolean) {
  const tg = truthGraph.peek();
  if (!tg || !rows.length) return;
  const top = tg.graph.top,
    tops = new Set(rows.map((r) => top[r])),
    picks = truthPicks.peek(),
    looked = truthLooked.peek(),
    within = focusPicked.peek();
  if (!on) {
    truthPicks.value = picks.filter((r) => !tops.has(top[r]));
    return;
  }
  const have = new Set(picks.map((r) => top[r])),
    added = [...new Map(rows.filter((r) => !have.has(top[r])).map((r) => [top[r], r])).values()];
  batch(() => {
    truthPicks.value = [...picks, ...added];
    if (looked === null || !tops.has(top[looked])) {
      truthLooked.value = rows[0];
      lookAtShown(tg.particles, rows[0], within);
    }
  });
}
/** The card and the focus on drawn truth particle `row`. From among the particles drawn (`within`), with nothing added
 *  to "back": the picks are one choice; else as any new selection. */
function lookAtShown(table: string, row: number, within: boolean) {
  if (!within) return openCard({ table, row });
  anchor.value = null;
  looking = null;
  anchorFocus = null;
  focus.value = { table, row };
  selection.value = { table, row };
}
/** No truth particle picked or looked at, and nothing selected. */
export function clearPicks() {
  batch(() => {
    truthPicks.value = [];
    truthLooked.value = null;
    selection.value = null;
  });
}
// The picks follow the focus: a truth particle focused from elsewhere (the view, a card, X, back) is the one looked
// at, drawn with the picks; any other focus, or none, ends them. Looking at an object from a card keeps them.
effect(() => {
  const f = focus.value,
    tg = truthGraph.value;
  if (anchor.peek()) return;
  const looked = truthLooked.peek();
  if (f && tg && f.table === tg.particles) {
    if (looked === null || tg.graph.top[looked] !== tg.graph.top[f.row]) truthLooked.value = f.row;
  } else if (truthPicks.peek().length || looked !== null)
    batch(() => {
      truthPicks.value = [];
      truthLooked.value = null;
    });
});

// A new focus starts without its hit pair.
effect(() => {
  focus.value;
  hitPair.value = false;
});

// ---- The focus's levels

/** The object whose levels are shown: in the pair view, the object the pair stands in for or comes from (a track for
 *  its hits); else the focus. */
export const levelTop = computed<Ref | null>(() => pairView.value?.via ?? pairView.value?.from ?? focus.value);
const topParts = computed(() => (sameRef(levelTop.value, focus.value) ? focusParts.value : partsOf(levelTop.value)));

/** The kinds of object the focus is made of, top first (event/levels.ts focusLevels). */
export const levels = computed(() => {
  const b = bundle.value,
    top = levelTop.value,
    hl = highlight.value,
    parts = topParts.value,
    pair = pairView.value;
  if (!b || !top || !hl || !parts) return [];
  // Not levels: what is only linked to the top, and in the pair view what the pair does not classify but is linked to
  // the focus (a track's vertex stays drawn).
  const linked = pair ? focusParts.value?.linked : undefined;
  const unclassified = (t: string) => {
    const cls = pair!.classes.get(t);
    return [...linked!.get(t)!].every((r) => !cls || cls[r] === PAIR.other);
  };
  const own = (t: string) => parts.madeOf.has(t) || (!parts.linked.has(t) && !(linked?.has(t) && unclassified(t)));
  const stage = (t: string) => b.header.display.some((d) => d.table === t && d.stage !== undefined);
  const lv = partsFirst(
    focusLevels(b.header.display, top.table, hl, own, b.header.relations),
    (t) => parts.madeOf.has(t) || stage(t),
  );
  return !domain.value && (b.header.domains?.length ?? 0) >= 2 ? mergeAcrossDomains(lv, shared.value) : lv;
});

/** The levels ↓ ↑ step through and the card's chain offers: the current domain's (event/levels.ts scopeLevels). */
export const focusBar = computed(() => scopeLevels(levels.value, domain.value, shared.value));

/** Whether a level is drawn: one of its collections is ticked. */
export const levelOn = (l: Level, ticks = visible.value) => l.layers.some((d) => ticks[layerKey(d)]);
/** The first of the focus's own levels in between (not always drawn, not only built from its parts) in the part
 *  looked at (focusBar) that is ticked, by name; null: none. ↓ ↑ step from it, the focus is drawn as an outline
 *  around it, and a link names it (lv). */
export const shownLevel = computed(
  () => focusBar.value.find((l) => !l.always && !l.beside && levelOn(l))?.name ?? null,
);

/** Tick (`on`) or untick the collections of the focus's level `name` (of the part looked at): the side panel and the
 *  view follow. */
export function tickLevel(name: string, on: boolean) {
  const l = focusBar.peek().find((x) => x.name === name);
  if (l) visible.value = { ...visible.peek(), ...Object.fromEntries(l.layers.map((d) => [layerKey(d), on])) };
}

/** Draw the focus's level `name` alone among its levels in between in the part looked at (focusBar): tick its
 *  collections and untick the others' (null: untick them all). The levels always drawn, those only built from its
 *  parts and those of other parts of the detector are left as they are. */
export function chooseLevel(name: string | null) {
  const ticks = { ...visible.peek() };
  for (const l of focusBar.peek())
    if (!l.always && !l.beside) for (const d of l.layers) ticks[layerKey(d)] = l.name === name;
  visible.value = ticks;
}

/** Move the tick down (+1) or up (-1) among focusBar's levels: from the first one ticked to the next; false if there
 *  is none to step through. */
export function stepFocusLevel(by: number) {
  const bar = focusBar.peek(),
    ticks = visible.peek();
  if (!bar.some((l) => !l.always && !l.beside)) return false;
  const from = bar.find((l) => !l.always && !l.beside && levelOn(l, ticks))?.name ?? null;
  chooseLevel(stepLevel(bar, from, by));
  return true;
}

// ---- The layers a focus adds

// A focus never hides a ticked layer, and draws an unticked one only for the selected object (focusRows). What it
// adds is joined into strings first, so the signals below change (and layers are built or rebuilt) only when it does,
// not on every new focus.
const added = computed(() => {
  const b = bundle.value;
  if (!b || !highlight.value) return [];
  return b.header.display.flatMap((d) => {
    const rows = focusRows(d);
    return rows?.size ? [{ key: layerKey(d), rows, ticked: !!visible.value[layerKey(d)] }] : [];
  });
});
const shownKeys = computed(() =>
  added.value
    .map((a) => a.key)
    .sort()
    .join("|"),
);
/** Layer keys of layers the view does not draw whole that are drawn for the focus (focusRows). */
export const focusLayers = computed(() => new Set(shownKeys.value ? shownKeys.value.split("|") : []));
/** The rows those layers draw where they do not follow the highlight: of the unticked layers (the selected object, which
 *  moves within one focus), with which layers are ticked. When it changes, the layers drawn for the focus are rebuilt
 *  (control/scene.ts), as for a new highlight. */
export const focusRowsKey = computed(() =>
  added.value
    .map((a) => `${a.key}${a.ticked ? "" : `=${[...a.rows].sort((x, y) => x - y).join(",")}`}`)
    .sort()
    .join("|"),
);
