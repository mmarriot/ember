// The selection, the focus and what they show.
//
// The selection is the object the card (ui/Card.tsx) describes. The focus is the object clicked from outside any
// focus (e.g. a candidate). While a focus lasts, it is drawn with its smallest parts (e.g. hits) and, on request, one
// level in between (see `levels`), and only its objects can be picked. Selecting one of them keeps the focus;
// selecting anything else focuses on it (the old focus is kept for "back"); clearing the selection (a click on
// nothing, Esc) ends it.
//
// Looking at an object from another's card: a click on an object in the card selects it, so the view shows it as any
// selection (with its parts, its pair), while the card stays on the object it was opened for, the `anchor`. Any other
// selection (a click in the view, a list, N) ends the look: the card follows the selection again, and the way back
// is the card's object, shown as it was (in its own focus), never the object looked at.
import { batch, computed, effect, signal } from "@preact/signals";
import type { DisplayLayer } from "../../io/format";
import { matchClass, recoLadder, recoOfTruth } from "../chain";
import { focusLevels, levelLayers, mergeAcrossDomains, partsFirst, scopeLevels, stepLevel } from "../levels";
import { delegatedPart, PAIR, type Pair, pairFor, pairShows } from "../pair";
import { simEnergyByParticle } from "../match";
import { colourLevel } from "../truth";
import { cached, levelsOf, type Related, relatedParts, sameRef, type Ref, type SlotRank } from "../relations";
import { activeMode, modes, truthLevel, truthStatuses } from "./colours";
import { truthStatement } from "../statement";
import { isFactTable } from "../facts";
import { bundle, event } from "./data";
import { layerKey, layerOf } from "./names";
import { domain, drawnLayers, inDomain, shared, visible } from "./view";

// ---- The selection and the focus

/** The object selected (the card's, unless another is looked at), or null. */
export const selection = signal<Ref | null>(null);
/** The focus: the object whose parts are drawn and pickable, or null. Follows the selection (see the effect below). */
export const focus = signal<Ref | null>(null);
/** Earlier focuses, oldest first: "back" returns to the last one. */
export const focusHistory = signal<Ref[]>([]);
/** The level shown between the focus and its bottom level (e.g. a candidate's tracksters), by name; null: none. It
 *  is kept while the focus moves (e.g. from one candidate to the next), and forgotten when the focus ends. */
export const focusLevel = signal<string | null>(null);

/** The card's own object while another is looked at (see `look`), else null. */
export const anchor = signal<Ref | null>(null);
/** The selection made by `look`, which keeps the anchor (any other selection ends the look). */
let looking: Ref | null = null;
/** The focus the card's object was shown in: the object itself, or what it is a part of. */
let anchorFocus: Ref | null = null;
/** The object the card describes: the anchor while another is looked at, else the selection. */
export const subject = computed(() => anchor.value ?? selection.value);

/** What `ref` is made of, part of and linked to (model/relations.ts relatedParts), or null without it in the event. */
const partsOf = (ref: Ref | null) => {
  const b = bundle.value,
    ev = event.value;
  return b && ev && ref && ref.row < (ev.tables[ref.table]?.n ?? 0) ? relatedParts(ev, b.header, ref) : null;
};
const focusParts = computed(() => partsOf(focus.value));
/** The selection's relatives: what it is made of, what it is part of, what is linked to it (e.g. its truth particle). */
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

/** The ladder of the card's object (model/chain.ts): for a reco object, what it is part of, itself and what it is made
 *  of, each step with its link to the truth; null for a truth object. */
export const ladder = computed(() => {
  const b = bundle.value,
    ev = event.value,
    sel = subject.value,
    parts = subjectParts.value;
  if (!b || !ev || !sel || !parts || layerOf(sel.table)?.truth) return null;
  return recoLadder(ev, b.header, sel, parts, truthStatuses.value);
});

/** What the truth says about the card's reco object (model/statement.ts): its kind's own association, and its parts'
 *  own matches; null for a truth object, and in a bundle without truth. */
export const statement = computed(() => {
  const b = bundle.value,
    ev = event.value,
    l = ladder.value;
  return b && ev && l && modes.value.roots.truth ? truthStatement(ev, b.header, l, truthStatuses.value) : null;
});

/** For a truth object on the card: what was reconstructed from it, per reco kind, and the hits it left
 *  (model/chain.ts recoOfTruth); null for anything else. */
export const reconstructed = computed(() => {
  const b = bundle.value,
    ev = event.value,
    sel = subject.value;
  if (!b || !ev || !sel || !layerOf(sel.table)?.truth || sel.row >= (ev.tables[sel.table]?.n ?? 0)) return null;
  return recoOfTruth(ev, b.header, sel);
});

/** What the CMSSW associator says of a reco object of a matched kind: clean, impure or unmatched (model/chain.ts
 *  matchClass); undefined for any other kind. It colours the object's name in lists. */
export function matchOf(table: string, row: number) {
  const b = bundle.value,
    ev = event.value,
    s = truthStatuses.value.get(table);
  return b && ev && s?.kind === "match" ? matchClass(ev, b.header, s.relation, row) : undefined;
}

// ---- What the view highlights

/** A hit opens its particle's pair only on request (the card's button): a click on a hit shows the hit. It is reset
 *  with each new focus. */
export const hitPair = signal(false);

/** In the "pid" and "truth" modes with something focused: its truth <-> reco pair (model/pair.ts), which colours every
 *  layer. Null when the pair has nothing to show, for a kind with no association of its own (a jet, a PF candidate, a
 *  TICL candidate: their parts may open one), and in a bundle with no truth at all (data, a standard NanoAOD). */
export const pairView = computed<Pair | null>(() => {
  const f = focus.value,
    b = bundle.value,
    ev = event.value,
    { roots } = modes.value;
  if (activeMode.value === "layers" || !f || !b || !ev || !roots.truth || f.row >= (ev.tables[f.table]?.n ?? 0))
    return null;
  if (isFactTable(b.header, f.table) && !hitPair.value) return null;
  let pair = pairFor(ev, b.header, f, roots.truth);
  // An object with no truth of its own may stand in for its one matched part (model/pair.ts delegatedPart).
  const part = pair ? null : delegatedPart(ev, b.header, f, roots.truth);
  const theirs = part && pairFor(ev, b.header, part, roots.truth);
  if (theirs) pair = { ...theirs, via: f };
  return pair && pairShows(pair) ? pair : null;
});

/** How the truth colours give their slots (model/relations.ts identities), in the truth mode: the domain looked at, the
 *  level chosen and, with a selection that has no pair of its own (a jet, an electron, a PF candidate), the particles
 *  its parts are matched to (by pT), then those that left simulated energy in its hits (by energy, detector by
 *  detector). Outside the truth mode, nothing: a truth particle drawn for a selection keeps the plain ranking. */
export const truthRank = computed<SlotRank>(() => {
  const b = bundle.value,
    ev = event.value,
    root = modes.value.roots.truth,
    sel = selection.value;
  if (activeMode.value !== "truth" || !b || !ev || !root) return {};
  const level = truthLevel.value ?? undefined,
    base = { domain: domain.value, level, only: level !== undefined && colourLevel(level).only };
  const parts = relatives.value;
  if (!sel || pairView.value || !parts) return base;
  const pt = ev.tables[root]?.columns.pt,
    matched = [...(parts.linked.get(root) ?? [])].sort((a, c) => (pt ? Number(pt[c]) - Number(pt[a]) : a - c));
  const deposits = simEnergyByParticle(ev, b.header, parts.madeOf).flatMap((g) => g.particles.map(([p]) => p));
  return { ...base, prefer: [...(sel.table === root ? [sel.row] : []), ...matched, ...deposits] };
});

/** In the truth mode with nothing selected, the truth particles drawn (the layer is otherwise drawn only for a
 *  selection): the signal particles of the colour level with pT >= 1 GeV, so the event's truth shows before a click.
 *  Pile-up stays off. Undefined in other modes, or for another layer. Once per event and level. */
export function truthPreview(d: DisplayLayer): Set<number> | undefined {
  const ev = event.peek(),
    t = ev?.tables[d.table];
  if (activeMode.peek() !== "truth" || !d.truth || !d.particle || !ev || !t) return undefined;
  const mask = truthLevel.peek() ?? 2 ** d.particle.bit,
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

/** What is drawn highlighted, per table: the focus, its levels and what is linked to it (e.g. its truth particle);
 *  in the pair view, the pair's objects. What contains the focus is listed on the card, not highlighted: big
 *  containers would cover it. Null without a focus. */
export const highlight = computed(() => {
  const b = bundle.value,
    ev = event.value,
    f = focus.value,
    parts = focusParts.value,
    pair = pairView.value;
  if (pair && f && b) {
    // The pair view: the objects of the pair, wherever they ended up, and the focus.
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
    // ... and, for a reco focus, the reco objects linked to it (e.g. a track's vertex), which the pair may not
    // classify. Not a truth particle's associations: the pair already shows its matches, and every other object an
    // association names (at any score) would look like part of it.
    if (!layerOf(f.table)?.truth)
      for (const [t, rows] of parts?.linked ?? [])
        if (!layerOf(t)?.truth) hl.set(t, new Set([...(hl.get(t) ?? []), ...rows]));
    return hl;
  }
  return b && ev && f && parts ? levelsOf(ev, b.header, f, parts) : null;
});

/** What framing the focus fits in the view: the highlight less what is only linked to the focus (its truth particle,
 *  a track's vertex), which can lie far from it (a low-pT particle's helix curls round 80 cm across the tracker). Null
 *  without a focus. */
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

/** What the focus is part of (e.g. a muon's jet), per table; null without a focus. */
const focusParents = computed(() => focusParts.value?.partOf ?? null);
/** For a layer of a shared part (e.g. Physics: jets) that the domain looked at does not draw (no overlay): the rows
 *  drawn for the focus, alone: its own (a selected jet) and, if the layer is ticked, what it is part of (a muon's
 *  jet), so a selection brings its physics objects along (control/scene.ts); else undefined. */
export const parentRows = (d: DisplayLayer) => {
  if (!d.domain || !shared.value.has(d.domain) || inDomain(d)) return undefined;
  const parents = visible.value[layerKey(d)] ? (focusParents.value?.get(d.table) ?? []) : [],
    rows = new Set([...(highlight.value?.get(d.table) ?? []), ...parents]);
  return rows.size ? rows : undefined;
};

/** Objects linked to the focus through an association (its truth; a truth particle's reco objects): a click on one
 *  moves the focus there. */
export const focusLinked = computed(() => focusParts.value?.linked ?? null);
/** The focus is a truth object. */
export const focusIsTruth = computed(() => !!focus.value && !!layerOf(focus.value.table)?.truth);

/** Whether an object can be picked: anything without a focus; inside one, its parts except the focus itself (it is
 *  already selected, so a click reaches what it is made of). */
export const inFocus = (table: string, row: number) => {
  const hl = highlight.peek();
  return !hl || (!!hl.get(table)?.has(row) && !sameRef(focus.peek(), { table, row }));
};

// The focus follows the selection: a selection outside the focus becomes the focus, no selection ends it. A selection
// made elsewhere while another object is looked at ends the look (the card's object is kept for "back").
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
    else if (sel && !inView) focus.value = { ...sel }; // not through focusOn, which would keep the object looked at for back
    if (sel) return;
  }
  if (sel && !highlight.peek()?.get(sel.table)?.has(sel.row)) focusOn(sel);
  else if (!sel) {
    focus.value = null;
    focusLevel.value = null;
    if (focusHistory.peek().length) focusHistory.value = [];
  }
});

// A new focus starts without its hit pair.
effect(() => {
  focus.value;
  hitPair.value = false;
});

// ---- The focus's levels

/** The object whose levels are shown: in the pair view, the matched object it comes from (a track for its hits), or
 *  the object it stands in for (a TICL candidate for its candidate trackster's pair); else the focus. */
export const levelTop = computed<Ref | null>(() => pairView.value?.via ?? pairView.value?.from ?? focus.value);
const topParts = computed(() => (sameRef(levelTop.value, focus.value) ? focusParts.value : partsOf(levelTop.value)));

/** The kinds of object the focus is made of, top first (model/levels.ts); its own kind and truth are not levels. */
export const levels = computed(() => {
  const b = bundle.value,
    top = levelTop.value,
    hl = highlight.value,
    parts = topParts.value,
    pair = pairView.value;
  if (!b || !top || !hl || !parts) return [];
  // Not levels: what is only linked to the top, and in the pair view what the pair does not classify but is linked to
  // the focus (a track's vertex is not a part of its candidate, and stays drawn).
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
  // Looking at everything in a bundle with parts of the detector: same-depth levels of different parts become one.
  return !domain.value && (b.header.domains?.length ?? 0) >= 2 ? mergeAcrossDomains(lv, shared.value) : lv;
});

/** The levels ↓ ↑ step through and the card's chain offers to show: those the current domain draws as its own or
 *  shares (model/levels.ts scopeLevels). */
export const focusBar = computed(() => scopeLevels(levels.value, domain.value, shared.value));

/** The chosen level, if the focus has it and it is not one drawn anyway (the bottom ones, lines); else null. */
export const shownLevel = computed(() => {
  const c = focusLevel.value;
  return levels.value.some((l) => !l.always && l.name === c) ? c : null;
});

/** Step the shown level down (+1) or up (-1) among the current domain's (focusBar); false, and nothing changes, if it
 *  has none to step through. */
export function stepFocusLevel(by: number) {
  const bar = focusBar.peek();
  if (!bar.some((l) => !l.always && !l.beside)) return false;
  focusLevel.value = stepLevel(bar, focusLevel.peek(), by);
  return true;
}

// ---- The layers a focus adds or hides

// While a focus lasts, what is drawn differs from the side panel's ticks (and the domain's view): the focus's layer,
// its stage (e.g. a candidate's track) and what is linked to it (its truth) are drawn even from layers not ticked; of
// its levels, only the bottom ones and the chosen one are, even if others are ticked. The layer keys are joined into
// strings first, so that the signals below change, and the layers are rebuilt, only when these sets change, not on
// every new focus.
const focusKeys = computed(() => {
  const b = bundle.value,
    hl = highlight.value,
    vis = drawnLayers.value,
    lv = levels.value,
    f = focus.value;
  if (!b || !hl) return { shown: "", hidden: "" };
  // The focus's own layer is always drawn, also when its kind is a level (the pair view's levels are its candidate's).
  const ticked = (d: DisplayLayer) => !!vis[layerKey(d)],
    own = (d: DisplayLayer) => d.table === f?.table;
  const inLevels = new Set(lv.flatMap((l) => l.layers).filter((d) => !own(d)));
  const { draw, hide: levelHide } = levelLayers(lv, focusLevel.value, ticked),
    hide = levelHide.filter((d) => !own(d));
  const others = b.header.display.filter((d) => !inLevels.has(d) && hl.get(d.table)?.size);
  // A shared part's layers the domain does not draw (no overlay) that hold what the focus is part of (its jet).
  const held = b.header.display.filter((d) => parentRows(d)?.size);
  const keys = (ds: DisplayLayer[]) => ds.map(layerKey).sort().join("|");
  return {
    shown: keys([...others, ...draw, ...held].filter((d) => !ticked(d))),
    hidden: keys(hide.filter(ticked)),
  };
});
const shownKeys = computed(() => focusKeys.value.shown),
  hiddenKeys = computed(() => focusKeys.value.hidden);
const keySet = (keys: string) => new Set(keys ? keys.split("|") : []);
/** Layer keys of layers not ticked that are drawn for the focus. */
export const focusLayers = computed(() => keySet(shownKeys.value));
/** Layer keys of ticked layers not drawn while the focus lasts (levels other than the bottom and the chosen one). */
export const focusHidden = computed(() => keySet(hiddenKeys.value));
