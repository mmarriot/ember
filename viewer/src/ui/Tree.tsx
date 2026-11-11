// Tree tab: objects linked to objects of the same table (e.g. truth-graph particles -> their children), as a
// collapsible tree, after a table of what became of each of them. Clicking an object focuses on it; selecting one
// elsewhere opens the tree down to it.
import { useEffect, useMemo, useState } from "preact/hooks";
import type { Relation, Table } from "../io/bundle";
import { PALETTES } from "../render/colour";
import { filterMask, filters } from "../model/custom";
import { bundle, describe, event, isHitLayer, labelOf, layerOf, selection, short, sizeColumn, theme } from "../model/store";
import { bestPartners } from "../model/relations";
import { jump } from "./navigate";

const go = (table: string, row: number) => jump({ table, row });
/** Larger first, by the table's size column (e.g. energy), if it has one. */
function largestFirst(table: string, t: Table) {
  const c = sizeColumn(table, t), key = c ? t.columns[c] : undefined;
  return (rows: number[]) => (key ? rows.sort((a, k) => Number(key[k]) - Number(key[a])) : rows);
}

const MAX = 100; // children (or roots) listed per node; the rest are summarised

/** Relations from a table to itself present in this event: [name, table]. */
export function treeRelations(): [string, string][] {
  const b = bundle.value, ev = event.value;
  if (!b || !ev) return [];
  return Object.entries(b.header.relations).filter(([n, r]) => r.from === r.to && ev.relations[n]).map(([n, r]) => [n, r.from]);
}

export function Tree() {
  const trees = treeRelations();
  if (!trees.length) return <p class="hint">No tree in this data set.</p>;
  return <div>{trees.map(([, table]) => <Outcome table={table} />)}{trees.map(([name, table]) => <OneTree name={name} table={table} />)}</div>;
}

/** What became of each object of `table` that left hits (associations to a layer drawn as cells; e.g. each simulated
 *  particle): its best match (by the association's `best` weight) among the objects of the latest reconstruction
 *  stage it has associations to. Only reads the associations in the file; objects with none are flagged. */
function Outcome({ table }: { table: string }) {
  const b = bundle.value!, ev = event.value!, t = ev.tables[table], sel = selection.value;
  const rels = Object.entries(b.header.relations).filter(([n, r]) => r.from === table && r.association && ev.relations[n]);
  const hitRels = rels.filter(([, r]) => isHitLayer(layerOf(r.to)));
  const final = b.header.display.filter((l) => l.stage !== undefined && !l.alternative && rels.some(([, r]) => r.to === l.table))
    .reduce<typeof b.header.display[number] | undefined>((a, l) => (!a || l.stage! > a.stage! ? l : a), undefined);
  const toFinal = final && rels.find(([, r]) => r.to === final.table);
  if (!hitRels.length || !final || !toFinal) return null;
  const keep = filterMask(t, filters.value[table]);
  const withHits = largestFirst(table, t)([...Array(t.n).keys()].filter((r) => (!keep || keep[r]) && hitRels.some(([n]) => { const o = ev.relations[n].offsets; return o[r + 1] > o[r]; })));
  const [relName, info] = toFinal, rel = ev.relations[relName], w = info.best ? rel.weights[info.best.weight] : undefined;
  const best = bestPartners(rel, info, true, t.n).entry;
  const missed = withHits.filter((r) => best[r] < 0).length;
  return (
    <div class="card outcome">
      <h3>What became of each {layerOf(table)?.truth ? "particle" : "object"}</h3>
      <p class="hint">{withHits.length} left hits{keep ? ` (filter: ${filters.value[table]})` : ""}; {missed} not reconstructed as {final.group.toLowerCase()}.
        Best match by {info.best?.weight ?? "order"}, from the associations in the file.</p>
      <table class="kv outcome"><tbody>
        {withHits.slice(0, MAX).map((r) => {
          const k = best[r];
          return (
            <tr class={k < 0 ? "missed" : undefined}>
              <td><button class={sel?.table === table && sel.row === r ? "chip selected" : "chip"} onClick={() => go(table, r)}>{describe(table, r) || `#${r}`}</button></td>
              <td>{k < 0 ? <span class="muted">not reconstructed</span> : (
                <><button class="chip" onClick={() => go(info.to, rel.indices[k])}>{describe(info.to, rel.indices[k]) || `#${rel.indices[k]}`}</button>
                  {w && <span class="muted"> {info.best!.weight} {short(w[k])}</span>}</>
              )}</td>
            </tr>
          );
        })}
      </tbody></table>
      {withHits.length > MAX && <p class="hint">… {withHits.length - MAX} more</p>}
    </div>
  );
}

function OneTree({ name, table }: { name: string; table: string }) {
  const ev = event.value!, rel = ev.relations[name], t = ev.tables[table], d = layerOf(table);
  const parents = useMemo(() => parentsOf(rel, t.n), [rel, t.n]), order = largestFirst(table, t);
  const keep = filterMask(t, filters.value[table]); // the layer's filter (e.g. signal only) applies to the tree too
  const kept = (r: number) => !keep || keep[r] !== 0;
  const children = (r: number) => order([...rel.indices.subarray(rel.offsets[r], rel.offsets[r + 1])].filter(kept));
  const roots = order([...Array(t.n).keys()].filter((r) => !parents[r].length && kept(r)));

  const [open, setOpen] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const found = query.trim() ? order([...Array(t.n).keys()].filter((r) => kept(r) && describe(table, r).toLowerCase().startsWith(query.trim().toLowerCase()))) : [];
  const sel = selection.value;
  useEffect(() => { // open the path to an object selected elsewhere (e.g. a matched truth particle)
    if (sel?.table !== table) return;
    const path = new Set(open);
    for (let todo = [...parents[sel.row]]; todo.length;) {
      const p = todo.pop()!;
      if (!path.has(p)) { path.add(p); todo.push(...parents[p]); }
    }
    if (path.size !== open.size) setOpen(path);
  }, [sel?.table, sel?.row, ev]);
  useEffect(() => setOpen(new Set()), [ev]); // a new event starts collapsed

  const swatch = (r: number) => {
    const pal = PALETTES[theme.value];
    return d?.colourBy === "row" ? <i class="swatch" style={{ background: pal.categories[r % pal.categories.length] }} /> : null;
  };
  const node = (r: number) => {
    const kids = rel.offsets[r + 1] - rel.offsets[r], isOpen = open.has(r);
    const toggle = () => { const s = new Set(open); if (isOpen) s.delete(r); else s.add(r); setOpen(s); };
    return (
      <li>
        <div class="node">
          <button class="toggle" disabled={!kids} onClick={toggle} aria-label={isOpen ? "collapse" : "expand"}>{kids ? (isOpen ? "▾" : "▸") : ""}</button>
          {swatch(r)}
          <button class={sel?.table === table && sel.row === r ? "label selected" : "label"} onClick={() => go(table, r)}>
            {describe(table, r) || `#${r}`}{kids ? <span class="muted"> ({kids})</span> : null}
          </button>
        </div>
        {isOpen && kids > 0 && <List rows={children(r)} node={node} />}
      </li>
    );
  };
  return (
    <div class="card tree">
      <h3>{labelOf(table)}</h3>
      <p class="hint">{roots.length} at the top{keep ? ` (filter: ${filters.value[table]})` : ""}; click one to select it, ▸ to see what it produced.</p>
      <input class="expr" placeholder="Find, e.g. t, W⁺, b, e⁻ (start of the name)" value={query} spellcheck={false}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
      {query.trim() && (
        <div class="found">
          <p class="hint">{found.length} found{found.length > 20 ? ", largest 20 shown" : ""}; click one to select it and open the tree to it.</p>
          {found.slice(0, 20).map((r) => (
            <button class={sel?.table === table && sel.row === r ? "chip selected" : "chip"} onClick={() => go(table, r)}>{describe(table, r)}</button>
          ))}
        </div>
      )}
      <List rows={roots} node={node} />
    </div>
  );
}

function List({ rows, node }: { rows: number[]; node: (r: number) => preact.JSX.Element }) {
  return <ul>{rows.slice(0, MAX).map(node)}{rows.length > MAX && <li class="muted">… {rows.length - MAX} more</li>}</ul>;
}

/** The parents of every row (a row may have several, e.g. particles meeting at a vertex). */
function parentsOf(rel: Relation, n: number): number[][] {
  const out: number[][] = Array.from({ length: n }, () => []);
  for (let f = 0; f + 1 < rel.offsets.length; f++)
    for (let k = rel.offsets[f]; k < rel.offsets[f + 1]; k++) out[rel.indices[k]].push(f);
  return out;
}
