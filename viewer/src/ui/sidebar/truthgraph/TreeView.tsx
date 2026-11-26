// The truth graph as a tree that folds (view.ts says what a view gets and may use): the collisions it hangs from (◆),
// each particle under its primary parent, joined by the lines of the tree, with the vertex its daughters were made at
// standing on their line (◆).
// The rows are rows.ts treeRows: only what is unfolded, long lists in parts.
import { signal } from "@preact/signals";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { EventData } from "../../../io/format";
import type { Ref } from "../../../model/event/relations";
import {
  event,
  graphFound,
  graphVertices,
  layerOf,
  pickedTops,
  selection,
  selectTruth,
  short,
  theme,
  togglePick,
  truthPicks,
  truthText,
} from "../../../model/store";
import { GRAPH_LEVELS, type LevelGraph } from "../../../model/truth/levelGraph";
import { PALETTES } from "../../../render/colour";
import { categoryNames } from "../../card/chips";
import {
  emptyState,
  headKey,
  LIST,
  pathTo,
  reveal,
  type Path,
  type Place,
  type Row,
  treeRows,
  type TreeState,
} from "./rows";
import { collisionName, type GraphViewProps, levelColour } from "./view";

/** The search unfolds the way to this many of the particles it finds, the largest. */
const REVEAL = 20;
/** Rails beyond this depth are narrower, so a deep tree still fits the side panel. */
const WIDE = 8;

/** The tree's display state (rows.ts TreeState) for the event it was made in (a new event starts afresh), and the
 *  particle (by top) last gone to from an "also from" link, kept listed. */
const tree = signal<{ ev: EventData | null; s: TreeState; asked: number }>({ ev: null, s: emptyState(), asked: -1 });
const stateOf = (ev: EventData) => (tree.value.ev === ev ? tree.value : { ev, s: emptyState(), asked: -1 });
const update = (ev: EventData, change: (s: TreeState) => TreeState, asked?: number) => {
  const now = tree.peek().ev === ev ? tree.peek() : { ev, s: emptyState(), asked: -1 },
    s = change(now.s);
  if (s !== now.s || (asked !== undefined && asked !== now.asked)) tree.value = { ev, s, asked: asked ?? now.asked };
};
/** The selection made by a pick or a tick in the tree: it is in view already, so it is not revealed again. */
let ownSelection: Ref | null = null;
const own = (pick: (row: number) => void, row: number) => {
  pick(row);
  ownSelection = selection.peek();
};

export function TreeView({ lg, g, particles, vertices }: GraphViewProps) {
  const ev = event.value!,
    { s, asked } = stateOf(ev),
    P = lg.particles,
    pal = PALETTES[theme.value],
    picked = pickedTops.value,
    picks = truthPicks.value,
    sel = selection.value,
    selRow = sel?.table === particles ? sel.row : -1,
    current = selRow >= 0 ? g.top[selRow] : -1,
    found = graphFound.value,
    names = layerOf(particles)?.describe?.names?.pdgId ?? {},
    reasons = categoryNames(vertices);
  const marked = useMemo(() => new Set(found.map((i) => P[i].top)), [found]);
  // The ways to the largest found: open while the search is typed (not written into the folds).
  const searched = useMemo(() => found.slice(0, REVEAL).flatMap((i) => pathTo(g, lg, P[i].top) ?? []), [found]);
  const force = useMemo(() => searched.reduce(reveal, emptyState()), [searched]);
  // The ways to the picks, the selection, the largest found and the particle gone to: listed whatever a list's length.
  const keep = useMemo(() => {
    const rows = [...picks, ...(selRow >= 0 ? [selRow] : []), ...(asked >= 0 ? [asked] : [])];
    return new Set([...rows.flatMap((r) => pathTo(g, lg, r)?.tops ?? []), ...searched.flatMap((p) => p.tops)]);
  }, [lg, picks, selRow, asked, searched]);
  const rows = treeRows(lg, g, s, graphVertices.value, keep, force);

  // Unfold the way to a particle selected elsewhere (the view, a card, X) and to one asked for here, and scroll to it
  // and to the largest found once its row is drawn: in the render after, or not at all.
  const root = useRef<HTMLDivElement>(null),
    target = useRef<{ top: number; focus: boolean; waited: boolean } | null>(null),
    shownLg = useRef<LevelGraph | null>(null);
  const goTo = (path: Path | null, focus = false, ask?: number) => {
    if (!path) return;
    update(ev, (s) => reveal(s, path), ask);
    target.current = { top: path.tops.at(-1)!, focus, waited: false };
  };
  useEffect(() => {
    const levels = shownLg.current !== lg; // also on opening the tab
    shownLg.current = lg;
    if (selRow >= 0 && (levels || sel !== ownSelection)) goTo(pathTo(g, lg, selRow));
  }, [selRow, lg]);
  useEffect(() => {
    if (searched.length) target.current = { top: searched[0].tops.at(-1)!, focus: false, waited: false };
  }, [searched]);
  useEffect(() => {
    const t = target.current;
    if (!t) return;
    const row = root.current?.querySelector<HTMLElement>(`[data-top="${t.top}"]`);
    if (row) {
      row.scrollIntoView({ block: "nearest" }); // the panel's scroll padding keeps it clear of the sticky controls
      if (t.focus) row.querySelector<HTMLElement>(".tg-name")?.focus();
    }
    if (row || t.waited) target.current = null;
    else t.waited = true;
  });

  const name = (top: number) => names[String(g.col("pdgId", top))] ?? `pdgId ${g.col("pdgId", top)}`;
  const energy = (row: number) => <span class="tg-e">{short(g.col("energy", row))} GeV</span>;
  const toggle = (row: Row) =>
    update(ev, (s) => {
      if (row.kind === "head") return { ...s, heads: new Map(s.heads).set(headKey(row.head), !row.open) };
      const top = row.kind === "particle" ? P[row.node].top : row.kind === "hidden" ? row.top : -1;
      return { ...s, folds: new Map(s.folds).set(top, !("open" in row && row.open)) };
    });
  /** Lists the particles at no shown level under particle `top` (unfolding it), or stops listing them. */
  const toggleBelow = (top: number, listed: boolean) =>
    update(ev, (s) => {
      const below = new Set(s.below);
      if (listed) below.delete(top);
      else below.add(top);
      return { ...s, below, folds: listed ? s.folds : new Map(s.folds).set(top, true) };
    });
  const more = (list: string) =>
    update(ev, (s) => ({ ...s, more: new Map(s.more).set(list, (s.more.get(list) ?? LIST) + LIST) }));
  // The vertex whose particles in and out show after a click or tap (pointing at a vertex shows them too).
  const [io, setIo] = useState<string | null>(null);

  /** The lines of the tree left of a row: a rail per ancestor level, then its own elbow (├, └, or ◆ for a vertex). */
  const guides = (r: Place, vertex = false) => (
    <>
      {r.rails.map((on, d) => (
        <i class={`tg-cell${on ? " on" : ""}${d >= WIDE ? " deep" : ""}`} />
      ))}
      {r.depth > 0 && (
        <i class={`tg-cell elbow${vertex ? " vx" : r.last ? " last" : ""}${r.depth > WIDE ? " deep" : ""}`} />
      )}
    </>
  );
  const fold = (r: Row & Place, open: boolean | undefined) =>
    open === undefined ? (
      <i class={r.depth ? "tg-fold leaf" : "tg-fold"} />
    ) : (
      <button class="tg-fold" tabIndex={-1} aria-label={open ? "Fold" : "Unfold"} onClick={() => toggle(r)}>
        {open ? "▾" : "▸"}
      </button>
    );
  /** A particle's tick, dot and name (picks it alone); `row` the copy picked. */
  const particle = (top: number, row: number, dot: preact.JSX.Element, title: string) => (
    <>
      <input
        type="checkbox"
        checked={picked.has(top)}
        title="Tick to keep it drawn with the others ticked; untick to take it out"
        onChange={() => own(togglePick, row)}
      />
      {dot}
      <button class="tg-name" title={title} onClick={() => own(selectTruth, row)}>
        {name(top)}
      </button>
    </>
  );
  /** A particle row's element: its classes (selected, picked, found) and its place in the tree for assistive tech. */
  const item = (r: Place & { open?: boolean }, kind: string, top: number, children: preact.ComponentChildren) => (
    <div
      class={`tg-row ${kind}${top === current ? " sel" : picked.has(top) ? " picked" : ""}${marked.has(top) ? " found" : ""}`}
      key={r.key}
      data-key={r.key}
      data-top={top}
      role="treeitem"
      aria-level={r.depth + 1}
      aria-expanded={r.open}
      aria-selected={top === current}
    >
      {children}
    </div>
  );

  /** "1 particle", "648 particles". */
  const count = (n: number, what: string) => `${n.toLocaleString()} ${what}${n === 1 ? "" : "s"}`;
  /** A head's name, whether it is a vertex (◆), and what it says of what it holds. */
  const head = (r: Row & { kind: "head" }): [string, boolean, string[]] => {
    const h = r.head;
    if (h.kind === "pileup") return ["pile-up", false, [count(lg.pileup.length, "collision")]];
    if (h.kind === "scatter") return ["hard scatter", true, []];
    if (h.kind === "underlying") return ["underlying event", false, [count(h.c.rest.length, "particle")]];
    const where = collisionName(h.c, g, particles);
    if (h.c.signal) return ["signal collision", true, where ? [where] : []];
    return [
      where || (h.c.id >= 0 ? `collision ${h.c.id}` : "collision"),
      true,
      [`ΣpT ${short(h.c.pt)} GeV`, count(h.c.rest.length, "particle")],
    ];
  };

  const line = (r: Row) => {
    if (r.kind === "head") {
      const [title, vertex, says] = head(r);
      return (
        <div
          class={vertex ? "tg-row head vx" : "tg-row head"}
          key={r.key}
          data-key={r.key}
          role="treeitem"
          aria-level={r.depth + 1}
          aria-expanded={r.open}
        >
          {guides(r)}
          {fold(r, r.open)}
          {vertex && <i class="tg-vx" />}
          <button class="tg-name" onClick={() => toggle(r)}>
            {title}
          </button>
          {says.map((x) => (
            <span class="tg-e">{x}</span>
          ))}
        </div>
      );
    }
    if (r.kind === "vertex") {
      const v = lg.vertices[r.vertex],
        list = (ns: number[]) =>
          ns
            .slice(0, 6)
            .map((i) => name(P[i].top))
            .join(" ") + (ns.length > 6 ? " …" : "");
      return (
        <div
          class={io === r.key ? "tg-row vertex io" : "tg-row vertex"}
          key={r.key}
          role="none"
          onClick={() => setIo(io === r.key ? null : r.key)}
        >
          {guides(r, true)}
          <span class="tg-vname">
            {Number.isNaN(v.reason) ? "vertex" : (reasons[String(v.reason)] ?? `reason ${v.reason}`)}
            {v.skips && <span title="Particles at no level shown in between"> ⋯</span>}
          </span>
          <span class="tg-io">
            {list(v.into)} → {list(v.out)}
          </span>
        </div>
      );
    }
    if (r.kind === "more")
      return (
        <div class="tg-row more" key={r.key} role="none">
          {guides(r)}
          <i class={r.depth ? "tg-fold leaf" : "tg-fold"} />
          <button class="link" onClick={() => more(r.list)}>
            {r.left > LIST ? `show ${LIST} more` : `show the other ${r.left}`}
          </button>
          {r.left > LIST && <span class="tg-e">of {r.left.toLocaleString()}</span>}
        </div>
      );
    if (r.kind === "hidden")
      return item(
        r,
        "hidden",
        r.top,
        <>
          {guides(r)}
          {fold(r, r.open)}
          {particle(
            r.top,
            g.last[r.top],
            <i class="tg-dot" />,
            `${truthText(particles, g.last[r.top])} · at no level shown`,
          )}
          {energy(g.last[r.top])}
        </>,
      );
    const p = P[r.node],
      also = p.parents.slice(1),
      listed = r.open !== false && s.below.has(p.top);
    return item(
      r,
      "particle",
      p.top,
      <>
        {guides(r)}
        {fold(r, r.open)}
        {particle(
          p.top,
          p.last,
          <i class="tg-dot" style={{ background: levelColour(pal, p.level) }} />,
          `${truthText(particles, p.last)} · ${GRAPH_LEVELS[p.level].name}`,
        )}
        {p.copies > 1 && <span class="tg-copies">×{p.copies}</span>}
        {energy(p.last)}
        {also.length > 0 && (
          <span class="tg-more">
            also from{" "}
            {also.map((a) => (
              <button class="link" title="Go to it" onClick={() => goTo(pathTo(g, lg, P[a].top), true, P[a].top)}>
                {name(P[a].top)}
              </button>
            ))}
          </span>
        )}
        {r.below > 0 && (
          <button
            class="link tg-more"
            aria-expanded={listed}
            title={`${listed ? "Hide" : "List"} the particles at no level shown that it made`}
            onClick={() => toggleBelow(p.top, listed)}
          >
            {listed ? "▾" : "▸"} {r.below} below
          </button>
        )}
      </>,
    );
  };

  // Keys: ↑ ↓ move between the names, → unfolds, ← folds. Handled here only: not the view's (← → step the event).
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const onKey = (e: KeyboardEvent) => {
    if (!/^Arrow(Up|Down|Left|Right)$/.test(e.key)) return;
    const names = [...(root.current?.querySelectorAll<HTMLElement>(".tg-name") ?? [])],
      at = names.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const row = byKey.get(names[at].closest<HTMLElement>("[data-key]")?.dataset.key ?? ""),
      open = row && "open" in row ? row.open : undefined;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") names[at + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
    else if (row && open !== undefined && open !== (e.key === "ArrowRight")) toggle(row);
  };

  return (
    <div class="truthgraph" ref={root} role="tree" aria-label="Truth graph" onKeyDown={onKey}>
      {rows.map(line)}
    </div>
  );
}
