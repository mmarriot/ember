// A stand-in view of the truth graph (view.ts says what a view gets and may use): the level graph as an indented list
// under the collisions, each particle under its primary parent, grouped under the vertex it was made at.
import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import {
  graphQuery,
  graphVertices,
  layerOf,
  pickedTops,
  pickTruth,
  selection,
  short,
  theme,
  togglePick,
  truthText,
} from "../../../model/store";
import { GRAPH_LEVELS } from "../../../model/truth/levelGraph";
import { PALETTES } from "../../../render/colour";
import { categoryNames } from "../../card/chips";
import { collisionName, type GraphViewProps, levelColour, matchingNodes } from "./view";

const MAX = 100; // roots or children listed per node; the rest are counted
/** The particles (by `top`) whose fold the user changed from its default (open in the hard process, else closed). */
const toggled = signal<Set<number>>(new Set());
/** The folds above the particles (the collisions, the hard scatter, the underlying event, pile-up) whose state the user
 *  changed from its default, by key. */
const flippedFolds = signal<Set<string>>(new Set());
/** `set` with `key` added, or taken out if it is in. */
const flip = <T,>(set: Set<T>, key: T) => {
  const s = new Set(set);
  if (!s.delete(key)) s.add(key);
  return s;
};

export function Placeholder({ lg, g, particles, vertices }: GraphViewProps) {
  const pal = PALETTES[theme.value],
    picked = pickedTops.value,
    sel = selection.value,
    current = sel?.table === particles ? g.top[sel.row] : -1,
    reasons = categoryNames(vertices),
    flipped = toggled.value,
    folds = flippedFolds.value;
  const name = (i: number) => truthText(particles, lg.particles[i].top).split(" · ")[0];
  const row = (i: number, open?: boolean, toggle?: () => void) => {
    const p = lg.particles[i],
      also = p.parents.slice(1);
    return (
      <div class="node">
        <button
          class="toggle"
          disabled={!toggle}
          onClick={toggle}
          aria-label={open ? "fold" : "unfold"}
          aria-expanded={toggle ? open : undefined}
        >
          {toggle ? (open ? "▾" : "▸") : ""}
        </button>
        <input
          type="checkbox"
          checked={picked.has(p.top)}
          title="Add it to the particles drawn, or take it out"
          onChange={() => togglePick(p.last)}
        />
        <i class="swatch" style={{ background: levelColour(pal, p.level) }} title={GRAPH_LEVELS[p.level].name} />
        <button
          class={p.top === current ? "label selected" : "label"}
          title={truthText(particles, p.last)}
          onClick={() => pickTruth(p.last)}
        >
          {name(i)}
          {p.copies > 1 && <span class="muted"> ×{p.copies}</span>}
        </button>
        {also.length > 0 && <span class="muted">also from {also.map(name).join(", ")}</span>}
        {p.below > 0 && (
          <span class="muted" title="Particles below it at no level shown">
            {p.below} below
          </span>
        )}
      </div>
    );
  };
  /** Particle node `i` and, unfolded, what it made; `hard`: it is from the hard process (open at first). */
  const node = (i: number, hard: boolean): preact.JSX.Element => {
    const p = lg.particles[i],
      kids = p.children.filter((c) => lg.particles[c].parents[0] === i),
      open = kids.length > 0 && hard !== flipped.has(p.top);
    const toggle = () => (toggled.value = flip(flipped, p.top));
    const under = (c: number) => node(c, hard);
    // its children grouped by the vertex they were made at, in the order of their largest
    const at = new Map<number, number[]>();
    for (const c of kids) at.set(lg.particles[c].made, [...(at.get(lg.particles[c].made) ?? []), c]);
    return (
      <li>
        {row(i, open, kids.length ? toggle : undefined)}
        {open &&
          (graphVertices.value ? (
            <ul>
              {[...at].map(([k, cs]) => {
                const v = lg.vertices[k];
                return (
                  <li>
                    <div class="vertex" title={v ? `vertex ${v.row}` : undefined}>
                      ● {v ? (reasons[String(v.reason)] ?? `reason ${v.reason}`) : "no vertex"}
                      {v?.skips && <span class="muted"> ⋯</span>}
                    </div>
                    <List rows={cs} node={under} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <List rows={kids} node={under} />
          ))}
      </li>
    );
  };
  const query = graphQuery.value.trim();
  if (query) {
    const names = layerOf(particles)?.describe?.names?.pdgId ?? {},
      found = matchingNodes(lg, g, names, query);
    return (
      <div class="tree truthgraph">
        <p class="hint">
          {found.length} found{found.length > MAX ? `, largest ${MAX} shown` : ""}
        </p>
        <ul>
          {found.slice(0, MAX).map((i) => (
            <li>{row(i)}</li>
          ))}
        </ul>
      </div>
    );
  }
  /** A fold above the particles: its head, and its body only while open (a folded one costs no rows). */
  const fold = (key: string, byDefault: boolean, head: ComponentChildren, body: () => ComponentChildren) => {
    const open = byDefault !== folds.has(key),
      toggle = () => (flippedFolds.value = flip(folds, key));
    return (
      <li>
        <div class="node">
          <button class="toggle" onClick={toggle} aria-label={open ? "fold" : "unfold"} aria-expanded={open}>
            {open ? "▾" : "▸"}
          </button>
          <button class="label" onClick={toggle}>
            {head}
          </button>
        </div>
        {open && body()}
      </li>
    );
  };
  const roots = (rows: number[], hard: boolean) => <List rows={rows} node={(i) => node(i, hard)} />;
  /** "1 particle", "62 particles". */
  const count = (n: number, what: string) => (
    <span class="count">
      {n.toLocaleString()} {what}
      {n === 1 ? "" : "s"}
    </span>
  );
  const sig = lg.signal,
    pileup = lg.pileup;
  return (
    <div class="tree truthgraph">
      <ul>
        {sig &&
          fold(
            "signal",
            true,
            <>
              ◆ signal collision <span class="muted">{collisionName(sig, g, particles)}</span>
            </>,
            () =>
              sig.hard.length ? (
                <ul>
                  {fold("hard", true, "◆ hard scatter", () => roots(sig.hard, true))}
                  {sig.rest.length > 0 &&
                    fold("underlying", false, <>underlying event {count(sig.rest.length, "particle")}</>, () =>
                      roots(sig.rest, false),
                    )}
                </ul>
              ) : (
                roots(sig.rest, false)
              ),
          )}
        {pileup.length > 0 &&
          fold("pileup", false, <>pile-up {count(pileup.length, "collision")}</>, () => (
            <ul>
              {pileup.map((c) =>
                fold(
                  `pileup ${c.id}`,
                  false,
                  <>
                    ◆ {collisionName(c, g, particles) || "collision"} <span class="muted">ΣpT {short(c.pt)} GeV</span>{" "}
                    {count(c.rest.length, "particle")}
                  </>,
                  () => roots(c.rest, false),
                ),
              )}
            </ul>
          ))}
      </ul>
    </div>
  );
}

function List({ rows, node }: { rows: number[]; node: (i: number) => preact.JSX.Element }) {
  return (
    <ul>
      {rows.slice(0, MAX).map(node)}
      {rows.length > MAX && <li class="muted">… {rows.length - MAX} more</li>}
    </ul>
  );
}
