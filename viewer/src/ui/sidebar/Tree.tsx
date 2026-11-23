// Objects linked to objects of the same table (e.g. truth particles -> their daughters) as a tree that folds, in the
// Truth tab (TruthTab.tsx). A click on an object selects it; an object selected elsewhere opens the tree down to it.
// For the truth particles, a particle's generator copies are one node ("μ⁺ ×4"), and the search takes a name, a pdgId,
// truth levels and what a particle did (docs/viewer.md "Truth tab").
import { useEffect, useMemo, useState } from "preact/hooks";
import type { Relation } from "../../io/format";
import { filterMask, filters } from "../../model/custom/settings";
import {
  bundle,
  caloView,
  chipText,
  describe,
  event,
  labelOf,
  largestFirst,
  layerOf,
  selection,
  theme,
  truthGraph,
  truthText,
} from "../../model/store";
import {
  copiesBelow,
  daughterVertices,
  LEVELS,
  length,
  matchesQuery,
  parseTruthQuery,
  REASON,
} from "../../model/truth/truth";
import { PALETTES } from "../../render/colour";
import { jump } from "../../control/navigate";

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
  // The truth particles: a node stands for a particle with its generator copies, its children those of the last.
  const tg = truthGraph.value,
    g = tg?.particles === table ? tg.graph : undefined,
    copies = (r: number) => (g ? copiesBelow(g, r) : [r]),
    nameOf = (r: number) => (g ? truthText(table, r, caloView.value) : describe(table, r)) || chipText(table, r);
  const children = (r: number) => {
    const k = copies(r).at(-1)!;
    return order([...rel.indices.subarray(rel.offsets[k], rel.offsets[k + 1])].filter(kept));
  };
  const roots = order([...Array(t.n).keys()].filter((r) => !parents[r].length && kept(r)));

  const [open, setOpen] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [levels, setLevels] = useState<Set<number>>(new Set()); // level bits a result must have
  const [process, setProcess] = useState<number | null>(null); // the reason of the vertex a result ended in
  const q = parseTruthQuery(query),
    flags = g && layerOf(table)?.particle ? layerOf(table)!.particle!.flags : undefined;
  const pdgNames = layerOf(table)?.describe?.names?.pdgId ?? {};
  // A particle's levels are those of any of its copies (the hard process is the first copy's, status 23): OR-ed per
  // top copy, once per event.
  const topFlags = useMemo(() => {
    const out = new Uint32Array(g?.n ?? 0);
    if (g && flags) for (let r = 0; r < g.n; r++) out[g.top[r]] |= g.col(flags, r);
    return out;
  }, [g, flags]);
  const groupFlags = (r: number) => (g ? topFlags[g.top[r]] : 0);
  // What a particle did: the reasons of the vertices where its daughters were made (not its end vertex, which is
  // only the latest of them), and where.
  const did = (r: number, reason: number) => (g ? daughterVertices(g, r).find((v) => v.reason === reason) : undefined);
  const searching = !!q || levels.size > 0 || process !== null;
  const found = searching
    ? order(
        [...Array(t.n).keys()].filter((r) => {
          if (!kept(r)) return false;
          if (g && g.last[r] !== r) return false; // a particle once: its last copy
          if (q && g) {
            const pdg = g.col("pdgId", r);
            if (!matchesQuery(q, pdg, pdgNames[String(pdg)] ?? "")) return false;
          } else if (q && "name" in q && !describe(table, r).toLowerCase().startsWith(q.name)) return false;
          if (g && flags && [...levels].some((b) => !((groupFlags(r) >>> b) & 1))) return false;
          return process === null || !!did(r, process);
        }),
      )
    : [];
  // The levels and processes offered, with how many particles (the filter's) have them.
  const levelCounts = useMemo(
    () =>
      g && flags
        ? LEVELS.map(
            (l) => [l, countOf(t.n, (r) => kept(r) && g.last[r] === r && !!((groupFlags(r) >>> l.bit) & 1))] as const,
          )
        : [],
    [g, keep, flags, topFlags],
  );
  const PROCESSES = [
    [REASON.conversion, "converted"],
    [REASON.brem, "radiated brem"],
    [REASON.hadronicInelastic, "interacted (hadronic)"],
    [REASON.decay, "decayed"],
  ] as const;
  const where = (r: number) => {
    const v = process === null ? undefined : did(r, process)?.vertex;
    return g && v !== undefined ? ` · R ${length(Math.hypot(g.vcol("x", v), g.vcol("y", v)))}` : "";
  };
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
    const same = copies(r),
      k = same.at(-1)!,
      kids = rel.offsets[k + 1] - rel.offsets[k],
      isOpen = open.has(r) || (same.length > 1 && same.some((c) => open.has(c)));
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
            class={sel?.table === table && same.includes(sel.row) ? "label selected" : "label"}
            title={
              same.length > 1
                ? `One particle the generator wrote ${same.length} times (status ${same.map((c) => g!.col("status", c)).join(" → ")}): click for the last`
                : undefined
            }
            onClick={() => go(table, k)}
          >
            {nameOf(r)}
            {same.length > 1 && <span class="muted"> ×{same.length}</span>}
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
        placeholder={g ? "Find: a name (B, μ), a pdgId (511), |pdg|=11" : "Find, e.g. t, W⁺, b, e⁻ (start of the name)"}
        value={query}
        spellcheck={false}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
      />
      {g && (
        <div class="levelchips" role="group" aria-label="Find by truth level or by what it ended in">
          {levelCounts
            .filter(([, n]) => n > 0)
            .map(([l, n]) => (
              <button
                class={levels.has(l.bit) ? "chip on" : "chip"}
                aria-pressed={levels.has(l.bit)}
                title={`${l.what} (${l.flag}, bit ${l.bit})`}
                onClick={() => {
                  const s = new Set(levels);
                  if (s.has(l.bit)) s.delete(l.bit);
                  else s.add(l.bit);
                  setLevels(s);
                }}
              >
                {l.name} <span class="muted">{n}</span>
              </button>
            ))}
          {PROCESSES.map(([reason, text]) => (
            <button
              class={process === reason ? "chip on" : "chip"}
              aria-pressed={process === reason}
              title="Daughters of the particle were made at a vertex of this process"
              onClick={() => setProcess(process === reason ? null : reason)}
            >
              {text}
            </button>
          ))}
        </div>
      )}
      {searching && (
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
              {nameOf(r)}
              {process !== null && where(r)}
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

/** How many of rows 0 .. n-1 pass `test`. */
function countOf(n: number, test: (r: number) => boolean) {
  let k = 0;
  for (let r = 0; r < n; r++) if (test(r)) k++;
  return k;
}

/** The parents of every row (a row may have several, e.g. particles meeting at a vertex). */
function parentsOf(rel: Relation, n: number): number[][] {
  const out: number[][] = Array.from({ length: n }, () => []);
  for (let f = 0; f + 1 < rel.offsets.length; f++)
    for (let k = rel.offsets[f]; k < rel.offsets[f + 1]; k++) out[rel.indices[k]].push(f);
  return out;
}
