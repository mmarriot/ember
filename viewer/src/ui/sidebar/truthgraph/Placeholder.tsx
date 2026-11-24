// A stand-in view of the truth graph (view.ts says what a view gets and may use): the level graph as an indented list,
// each particle under its primary parent, grouped under the vertex it was made at.
import { signal } from "@preact/signals";
import {
  graphQuery,
  graphVertices,
  layerOf,
  pickedTops,
  pickTruth,
  selection,
  theme,
  togglePick,
  truthText,
} from "../../../model/store";
import { GRAPH_LEVELS } from "../../../model/truth/levelGraph";
import { PALETTES } from "../../../render/colour";
import { categoryNames } from "../../card/chips";
import { type GraphViewProps, levelColour, matchingNodes } from "./view";

const MAX = 100; // roots or children listed per node; the rest are counted
/** The particles (by `top`) whose fold the user changed from its default (open in the hard process, else closed). */
const toggled = signal<Set<number>>(new Set());

export function Placeholder({ lg, g, particles, vertices }: GraphViewProps) {
  const pal = PALETTES[theme.value],
    picked = pickedTops.value,
    sel = selection.value,
    current = sel?.table === particles ? g.top[sel.row] : -1,
    reasons = categoryNames(vertices),
    flipped = toggled.value;
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
  const node = (i: number) => {
    const p = lg.particles[i],
      kids = p.children.filter((c) => lg.particles[c].parents[0] === i),
      open = kids.length > 0 && (p.group === "hard") !== flipped.has(p.top);
    const toggle = () => {
      const s = new Set(flipped);
      if (!s.delete(p.top)) s.add(p.top);
      toggled.value = s;
    };
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
                    <List rows={cs} node={node} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <List rows={kids} node={node} />
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
  return (
    <div class="tree truthgraph">
      {lg.groups.map((grp) => (
        <details open={grp.id === "hard"}>
          <summary>
            {grp.name} <span class="count">{grp.roots.length.toLocaleString()}</span>
          </summary>
          <List rows={grp.roots} node={node} />
        </details>
      ))}
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
