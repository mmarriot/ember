// Objects linked to objects of the same table (e.g. truth particles -> their daughters) as a tree that folds, in the
// Truth tab (TruthTab.tsx). A click on an object selects it; an object selected elsewhere opens the tree down to it.
import { useEffect, useMemo, useState } from "preact/hooks";
import type { Relation } from "../io/bundle";
import { filterMask, filters } from "../model/custom";
import { bundle, describe, event, labelOf, largestFirst, layerOf, selection, theme } from "../model/store";
import { PALETTES } from "../render/colour";
import { jump } from "./navigate";

const go = (table: string, row: number) => jump({ table, row });
const MAX = 100; // children (or roots) listed per node; the rest are counted

/** Relations from a table to itself present in this event: [name, table]. */
export function treeRelations(): [string, string][] {
  const b = bundle.value,
    ev = event.value;
  if (!b || !ev) return [];
  return Object.entries(b.header.relations)
    .filter(([n, r]) => r.from === r.to && ev.relations[n])
    .map(([n, r]) => [n, r.from]);
}

/** The rows of `table` as a tree along relation `name` (from a row to its children), largest first, with a box that
 *  finds an object by the start of its name. */
export function Tree({ name, table }: { name: string; table: string }) {
  const ev = event.value!,
    rel = ev.relations[name],
    t = ev.tables[table],
    d = layerOf(table);
  const parents = useMemo(() => parentsOf(rel, t.n), [rel, t.n]),
    order = (rows: number[]) => largestFirst(table, rows);
  const keep = filterMask(t, filters.value[table]); // the layer's filter (e.g. signal only) applies to the tree too
  const kept = (r: number) => !keep || keep[r] !== 0;
  const children = (r: number) => order([...rel.indices.subarray(rel.offsets[r], rel.offsets[r + 1])].filter(kept));
  const roots = order([...Array(t.n).keys()].filter((r) => !parents[r].length && kept(r)));

  const [open, setOpen] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const found = query.trim()
    ? order(
        [...Array(t.n).keys()].filter(
          (r) => kept(r) && describe(table, r).toLowerCase().startsWith(query.trim().toLowerCase()),
        ),
      )
    : [];
  const sel = selection.value;
  useEffect(() => {
    // open the path to an object selected elsewhere (e.g. a matched truth particle)
    if (sel?.table !== table) return;
    const path = new Set(open);
    for (let todo = [...parents[sel.row]]; todo.length; ) {
      const p = todo.pop()!;
      if (!path.has(p)) {
        path.add(p);
        todo.push(...parents[p]);
      }
    }
    if (path.size !== open.size) setOpen(path);
  }, [sel?.table, sel?.row, ev]);
  useEffect(() => setOpen(new Set()), [ev]); // a new event starts collapsed

  const swatch = (r: number) => {
    const pal = PALETTES[theme.value];
    return d?.colourBy === "row" ? (
      <i class="swatch" style={{ background: pal.categories[r % pal.categories.length] }} />
    ) : null;
  };
  const node = (r: number) => {
    const kids = rel.offsets[r + 1] - rel.offsets[r],
      isOpen = open.has(r);
    const toggle = () => {
      const s = new Set(open);
      if (isOpen) s.delete(r);
      else s.add(r);
      setOpen(s);
    };
    return (
      <li>
        <div class="node">
          <button class="toggle" disabled={!kids} onClick={toggle} aria-label={isOpen ? "collapse" : "expand"}>
            {kids ? (isOpen ? "▾" : "▸") : ""}
          </button>
          {swatch(r)}
          <button
            class={sel?.table === table && sel.row === r ? "label selected" : "label"}
            onClick={() => go(table, r)}
          >
            {describe(table, r) || `#${r}`}
            {kids ? <span class="muted"> ({kids})</span> : null}
          </button>
        </div>
        {isOpen && kids > 0 && <List rows={children(r)} node={node} />}
      </li>
    );
  };
  return (
    <section class="tree">
      <h3 title="Click one to select it, ▸ to see what it produced">
        {labelOf(table)}{" "}
        <span class="count">
          {roots.length} at the top{keep ? `, filter ${filters.value[table]}` : ""}
        </span>
      </h3>
      <input
        class="expr"
        placeholder="Find, e.g. t, W⁺, b, e⁻ (start of the name)"
        value={query}
        spellcheck={false}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
      />
      {query.trim() && (
        <div class="found">
          <p class="hint">
            {found.length} found{found.length > 20 ? ", largest 20 shown" : ""}; click one to select it and open the
            tree to it.
          </p>
          {found.slice(0, 20).map((r) => (
            <button
              class={sel?.table === table && sel.row === r ? "chip selected" : "chip"}
              onClick={() => go(table, r)}
            >
              {describe(table, r)}
            </button>
          ))}
        </div>
      )}
      <List rows={roots} node={node} />
    </section>
  );
}

function List({ rows, node }: { rows: number[]; node: (r: number) => preact.JSX.Element }) {
  return (
    <ul>
      {rows.slice(0, MAX).map(node)}
      {rows.length > MAX && <li class="muted">… {rows.length - MAX} more</li>}
    </ul>
  );
}

/** The parents of every row (a row may have several, e.g. particles meeting at a vertex). */
function parentsOf(rel: Relation, n: number): number[][] {
  const out: number[][] = Array.from({ length: n }, () => []);
  for (let f = 0; f + 1 < rel.offsets.length; f++)
    for (let k = rel.offsets[f]; k < rel.offsets[f + 1]; k++) out[rel.indices[k]].push(f);
  return out;
}
