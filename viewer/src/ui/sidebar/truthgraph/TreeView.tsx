// The truth graph as a tree that folds (view.ts says what a view gets and may use): each particle under its primary
// parent, joined by the lines of the tree, with the vertex its daughters were made at standing on their line (◆).
// The rows are rows.ts treeRows: only what is unfolded, long lists in parts.
import { signal } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import type { EventData } from "../../../io/format";
import {
  event,
  graphQuery,
  graphVertices,
  layerOf,
  pickedTops,
  pickTruth,
  selection,
  short,
  theme,
  togglePick,
  truthPicks,
  truthText,
} from "../../../model/store";
import { GRAPH_LEVELS } from "../../../model/truth/levelGraph";
import { PALETTES } from "../../../render/colour";
import { categoryNames } from "../../card/chips";
import { emptyState, LIST, pathTo, reveal, type Path, type Place, type Row, treeRows, type TreeState } from "./rows";
import { type GraphViewProps, levelColour, matchingNodes } from "./view";

/** The search unfolds the way to this many of the particles it finds, the largest. */
const REVEAL = 20;
/** Rails beyond this depth are narrower, so a deep tree still fits the side panel. */
const WIDE = 8;

/** The tree's display state (rows.ts TreeState), for the event it was made in: a new event starts afresh. */
const tree = signal<{ ev: EventData | null; s: TreeState }>({ ev: null, s: emptyState() });
const stateOf = (ev: EventData) => (tree.value.ev === ev ? tree.value.s : emptyState());
const update = (ev: EventData, change: (s: TreeState) => TreeState) => {
  const now = tree.peek();
  tree.value = { ev, s: change(now.ev === ev ? now.s : emptyState()) };
};

export function TreeView({ lg, g, particles, vertices }: GraphViewProps) {
  const ev = event.value!,
    s = stateOf(ev),
    P = lg.particles,
    pal = PALETTES[theme.value],
    picked = pickedTops.value,
    picks = truthPicks.value,
    sel = selection.value,
    selRow = sel?.table === particles ? sel.row : -1,
    current = selRow >= 0 ? g.top[selRow] : -1,
    query = graphQuery.value,
    names = layerOf(particles)?.describe?.names?.pdgId ?? {},
    reasons = categoryNames(vertices);
  const found = useMemo(() => matchingNodes(lg, g, names, query), [lg, query]);
  const marked = useMemo(() => new Set(found.map((i) => P[i].top)), [found]);
  // The ways to the picks, the selection and the largest found: listed whatever a list's length.
  const keep = useMemo(() => {
    const rows = [...picks, ...(selRow >= 0 ? [selRow] : []), ...found.slice(0, REVEAL).map((i) => P[i].top)];
    return new Set(rows.flatMap((r) => pathTo(g, lg, r)?.tops ?? []));
  }, [lg, picks, selRow, found]);
  const rows = treeRows(lg, g, s, graphVertices.value, keep);

  // Unfold the way to a particle selected anywhere (the view, a card, X, a pick here), to what the search finds and
  // to a particle asked for here; then scroll it into view (once its row is drawn).
  const root = useRef<HTMLDivElement>(null),
    target = useRef<{ top: number; focus: boolean } | null>(null);
  const goTo = (paths: Path[], focus = false) => {
    if (!paths.length) return;
    update(ev, (s) => paths.reduce(reveal, s));
    target.current = { top: paths[0].tops.at(-1)!, focus };
  };
  const pathsOf = (rows: number[]) => rows.flatMap((r) => pathTo(g, lg, r) ?? []);
  useEffect(() => goTo(pathsOf(selRow >= 0 ? [selRow] : [])), [selRow, lg]);
  useEffect(() => goTo(pathsOf(found.slice(0, REVEAL).map((i) => P[i].top))), [found]);
  useEffect(() => {
    const t = target.current,
      row = t && root.current?.querySelector<HTMLElement>(`[data-top="${t.top}"]`);
    if (!t || !row) return;
    target.current = null;
    row.scrollIntoView({ block: "nearest" });
    if (t.focus) row.querySelector<HTMLElement>(".tg-name")?.focus();
  });

  const name = (top: number) => names[String(g.col("pdgId", top))] ?? `pdgId ${g.col("pdgId", top)}`;
  const energy = (row: number) => <span class="tg-e">{short(g.col("energy", row))} GeV</span>;
  const toggle = (row: Row) =>
    update(ev, (s) => {
      if (row.kind === "group") return { ...s, groups: { ...s.groups, [row.group.id]: !row.open } };
      const top = row.kind === "particle" ? P[row.node].top : row.kind === "hidden" ? row.top : -1;
      return { ...s, folds: new Map(s.folds).set(top, !("open" in row && row.open)) };
    });
  const toggleBelow = (top: number) =>
    update(ev, (s) => {
      const below = new Set(s.below);
      if (!below.delete(top)) below.add(top);
      return { ...s, below };
    });
  const more = (list: string) =>
    update(ev, (s) => ({ ...s, more: new Map(s.more).set(list, (s.more.get(list) ?? LIST) + LIST) }));

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
        title="Draw it too, or take it out"
        onChange={() => togglePick(row)}
      />
      {dot}
      <button class="tg-name" title={title} onClick={() => pickTruth(row)}>
        {name(top)}
      </button>
    </>
  );
  const rowClass = (kind: string, top: number) =>
    `tg-row ${kind}${top === current ? " sel" : picked.has(top) ? " picked" : ""}${marked.has(top) ? " found" : ""}`;

  const line = (r: Row) => {
    if (r.kind === "group")
      return (
        <div class="tg-group" key={r.key} data-key={r.key}>
          <button class="tg-name" aria-expanded={r.open} onClick={() => toggle(r)}>
            <span class="tg-caret">{r.open ? "▾" : "▸"}</span>
            {r.group.name} <span class="count">{r.size.toLocaleString()}</span>
          </button>
        </div>
      );
    if (r.kind === "vertex") {
      const v = lg.vertices[r.vertex],
        list = (ns: number[]) =>
          ns
            .slice(0, 6)
            .map((i) => name(P[i].top))
            .join(" ") + (ns.length > 6 ? " …" : "");
      return (
        <div class="tg-row vertex" key={r.key} tabIndex={0}>
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
        <div class="tg-row more" key={r.key}>
          {guides(r)}
          <i class={r.depth ? "tg-fold leaf" : "tg-fold"} />
          <button class="link" onClick={() => more(r.list)}>
            {r.left > LIST ? `show ${LIST} more` : `show the other ${r.left}`}
          </button>
          {r.left > LIST && <span class="tg-e">of {r.left.toLocaleString()}</span>}
        </div>
      );
    if (r.kind === "hidden")
      return (
        <div class={rowClass("hidden", r.top)} key={r.key} data-key={r.key} data-top={r.top}>
          {guides(r)}
          {fold(r, r.open)}
          {particle(
            r.top,
            g.last[r.top],
            <i class="tg-dot" />,
            `${truthText(particles, g.last[r.top])} · at no level shown`,
          )}
          {energy(g.last[r.top])}
        </div>
      );
    const p = P[r.node],
      also = p.parents.slice(1),
      below = s.below.has(p.top);
    return (
      <div class={rowClass("particle", p.top)} key={r.key} data-key={r.key} data-top={p.top}>
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
              <button class="link" title="Go to it" onClick={() => goTo(pathsOf([P[a].top]), true)}>
                {name(P[a].top)}
              </button>
            ))}
          </span>
        )}
        {p.below > 0 && (
          <button
            class="link tg-more"
            aria-expanded={below}
            title={`${below ? "Hide" : "List"} the particles below it at no level shown`}
            onClick={() => toggleBelow(p.top)}
          >
            {below ? "▾" : "▸"} {p.below} below
          </button>
        )}
      </div>
    );
  };

  // Keys: ↑ ↓ move between the names, → unfolds, ← folds.
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const onKey = (e: KeyboardEvent) => {
    const names = [...(root.current?.querySelectorAll<HTMLElement>(".tg-name") ?? [])],
      at = names.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const row = byKey.get(names[at].closest<HTMLElement>("[data-key]")?.dataset.key ?? ""),
      open = row && "open" in row ? row.open : undefined;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") names[at + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
    else if (row && open !== undefined && open !== (e.key === "ArrowRight") && /^Arrow(Left|Right)$/.test(e.key))
      toggle(row);
    else return;
    e.preventDefault();
  };

  return (
    <div class="truthgraph" ref={root} onKeyDown={onKey}>
      {query.trim() && (
        <p class="tg-hint">
          {found.length ? (
            <>
              {found.length.toLocaleString()} found
              {found.length > REVEAL ? `, the ${REVEAL} largest unfolded` : ""} ·{" "}
              <button class="link" onClick={() => pickTruth(P[found[0]].last)}>
                pick the first
              </button>{" "}
              · Enter: the next
            </>
          ) : (
            "None at the levels shown"
          )}
        </p>
      )}
      {rows.map(line)}
    </div>
  );
}
