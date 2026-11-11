// Floating card for the selected object: summary, all columns with documentation, related objects.
import { colourBy, customColumns, customDoc } from "../model/custom";
import { type Table, unitOf } from "../io/bundle";
import { bundle, describe, event, full, highlight, short, kindOf, labelOf, layerKey, layerOf, modes, relatives, selection, sizeColumn, drawnLayers, truthStatuses } from "../model/store";
import { simEnergyByParticle } from "../model/match";
import { facts, unitOf as factUnit } from "../model/facts";
import { bestFirst, type Related } from "../model/relations";
import { engine } from "./Viewport";
import { jump } from "./navigate";
import { Lineage, TruthCard } from "./Truth";
import { Icon, Tabs } from "./widgets";

const weightsText = (w: Record<string, number>) => Object.entries(w).map(([k, v]) => `${k} ${Math.abs(v) < 5e-4 ? "0" : full(v)}`).join(" · ");

export function Inspector() {
  const b = bundle.value, ev = event.value, sel = selection.value, hl = highlight.value;
  if (!b || !ev || !sel || !ev.tables[sel.table]) return null;
  const info = b.header.tables[sel.table], table = ev.tables[sel.table];
  const d = layerOf(sel.table), truth = isTruth(sel.table), name = describe(sel.table, sel.row);
  const custom = customColumns.value.filter((c) => c.table === sel.table).map((c) => c.name);
  const colour = d ? colourBy.value[layerKey(d)] ?? d.colour : undefined;
  const category = d && typeof d.colourBy === "object" && "category" in d.colourBy ? d.colourBy.category : undefined;
  // The summary's rows: the layer's `inspect` columns (e.g. pt, eta, phi of a jet), else what colours, places and sizes it.
  const key = [...new Set([...(d?.inspect ?? [category, colour, ...(d?.position ?? []), sizeColumn(sel.table, table)]), ...custom])]
    .filter((c): c is string => !!c && c in table.columns);
  const doc = (c: string) => info.columns[c]?.doc ?? customDoc(sel.table, c);
  const rows = (cols: string[]) => (
    <table class="kv"><tbody>
      {cols.map((c) => (
        <tr title={doc(c)}><td>{custom.includes(c) ? <i>{c}</i> : c}</td><td>{full(table.columns[c][sel.row])}</td><td class="unit">{unitOf(info.columns[c]?.doc)}</td></tr>
      ))}
    </tbody></table>
  );
  const parts = relatives.value;
  const without = (r: Related | undefined) => [...(r ?? [])].map(([t, set]) => [t, t === sel.table ? new Set([...set].filter((x) => x !== sel.row)) : set] as const).filter(([, set]) => set.size);
  // Linked, but not what contains it (e.g. a track's vertex: highlighted with it, listed under "Part of").
  const linked = without(parts?.linked).map(([t, set]) => [t, new Set([...set].filter((r) => !parts?.partOf.get(t)?.has(r)))] as const).filter(([, set]) => set.size);
  const sections: [string, string, (readonly [string, Set<number>])[]][] = [
    ["Made of", "what it is built from; highlighted in the view", without(parts?.madeOf)],
    ["Part of", "the objects that contain it (not highlighted, so they do not cover it)", without(parts?.partOf)],
    [truth ? "Reconstructed as" : linked.every(([t]) => isTruth(t)) ? "Truth matches" : "Linked", "linked by an association (e.g. reco <-> truth graph); highlighted", linked],
  ];
  const nRelated = sections.reduce((s, [, , g]) => s + g.reduce((k, [, set]) => k + set.size, 0), 0);
  const matches = associations(sel.table, sel.row);
  const truthMatch = truth ? undefined : matches.find((m) => isTruth(m.table)), best = truthMatch?.rows[0];
  // A kind whose association carries a `match` contract gets the truth card instead of the bare best-match line.
  const hasCard = Object.entries(b.header.relations).some(([n, r]) => (r.match?.shared ?? r.match?.purity) && r.from === sel.table && isTruth(r.to) && ev.relations[n]);
  // What the particles left in its hits, per detector; only for a kind with a match, evd's stand-in or hits: for any other,
  // a ranking of the particles in its hits would be a match through hits (docs/truth.md "Constituents"): the facts stay on the hits.
  const status = truthStatuses.value.get(sel.table);
  const content = !truth && parts && (status?.kind === "match" || status?.kind === "derived" || status?.kind === "fact") ? simEnergyByParticle(ev, b.header, parts.madeOf, drawn) : [];
  // What contains it, one object per kind, innermost first in display order: hit -> layer cluster -> trackster -> ...
  const order = (t: string) => b.header.display.findIndex((l) => l.table === t);
  const chain = [...(parts?.partOf ?? [])].filter(([t, set]) => set.size && order(t) >= 0 && !layerOf(t)?.alternative)
    .sort(([a], [c]) => order(a) - order(c)).map(([t, set]) => [t, Math.min(...set)] as const);
  const chip = (t: string, r: number) => {
    const text = describe(t, r);
    return <button class="chip" title={text ? `#${r}` : undefined} onClick={() => jump({ table: t, row: r })}>{text || r}</button>;
  };

  return (
    <div class="inspector" role="dialog" aria-label="Selected object">
      <header>
        <div>
          <div class={truth ? "kind truth" : "kind"}>{labelOf(sel.table)}{truth && " (simulation)"}</div>
          <h2>#{sel.row}{name && <span class="describe"> · {name}</span>}</h2>
        </div>
        <div class="actions">
          <button class="icon-button" title="Zoom to it and its related objects (F)" onClick={() => hl && engine?.frame(hl, true)}><Icon name="focus" /></button>
          <button class="icon-button" title="Close (Esc)" onClick={() => (selection.value = null)}><Icon name="close" /></button>
        </div>
      </header>
      <p class="hint">{info.doc}</p>
      <Tabs tabs={[
        ["Summary", () => (
          <div>
            {chain.length > 0 && <p class="chainline" title="The objects that contain it, one per kind (Related tab: all of them)">
              Part of {chain.map(([t, r]) => <><span class="muted"> {kindOf(t)}</span> {chip(t, r)}</>)}</p>}
            {sel.table === modes.value.roots.truth ? <Lineage row={sel.row} /> : !truth && <TruthCard table={sel.table} row={sel.row} />}
            {!truth && best && !hasCard && (status?.kind === "fact" ? <FactLine table={sel.table} row={sel.row} chip={chip(truthMatch!.table, best.row)} weights={Object.entries(best.weights).map(([k, v]) => `${k} ${short(v)}`).join(" · ")} />
              : <p class="truthline" title="The truth-graph particle the association picked for it (best by its score); shared energy and score from CMSSW">
              <span class="badge truth">truth</span> associator's best match {chip(truthMatch!.table, best.row)}
              <span class="muted">{weightsText(best.weights)}</span></p>)}
            {content.map((g) => g.particles.length > 0 && (
              <div class="truthcontent" title={`Each particle's ${g.weight} in this object's hits${g.in ? ` in ${g.in}` : ""} (deposited in the sensors, not calibrated: compare only within one detector), summed over the hit layers shown; hits belong to the particles that entered the calorimeter, with their secondaries; only particles in the truth-graph export`}>
                <p class="truthline"><span class="badge truth">truth</span> simulated energy in its hits{content.length > 1 && g.in ? ` in ${g.in}` : ""}, by particle that entered the calorimeter:</p>
                <ul class="matches">{g.particles.slice(0, 5).map(([p, e]) => (
                  <li>{chip(g.table, p)}<span class="muted">{(100 * e / g.total).toFixed(0)}%</span></li>
                ))}</ul>
                {g.particles.length > 5 && <p class="hint">… and {g.particles.length - 5} more particles</p>}
              </div>
            ))}
            {d?.fractions && <Fractions fractions={d.fractions} table={table} row={sel.row} />}
            {rows(key)}
          </div>
        )],
        [`Columns · ${Object.keys(table.columns).length}`, () => rows(Object.keys(table.columns))],
        [`Related · ${nRelated}`, () => nRelated ? (
          <div>{sections.filter(([, , groups]) => groups.length).map(([title, hint, groups]) => (
            <section class="relsection">
              <h4 title={hint}>{title}</h4>
              {groups.map(([t, set]) => (
                <div class="related">
                  <h3 class={drawn(t) ? undefined : "muted"} title={drawn(t) ? undefined : "this layer is hidden (its tab in the side panel)"}>{labelOf(t)} <span class="count">{set.size}</span>{!drawn(t) && " · hidden layer"}</h3>
                  <div>{[...set].slice(0, 30).map((r) => chip(t, r))}{set.size > 30 && " …"}</div>
                </div>
              ))}
            </section>
          ))}</div>
        ) : <p class="hint">Nothing related in this file.</p>],
        ...(matches.length ? [[`Matches · ${matches.reduce((s, m) => s + m.rows.length, 0)}`, () => (
          <div>{matches.map((m) => (
            <div class="related">
              <h3>{labelOf(m.table)} <span class="count">{m.rows.length}</span></h3>
              <ul class="matches">
                {m.rows.slice(0, 20).map(({ row, weights }) => (
                  <li>{chip(m.table, row)}<span class="muted">{weightsText(weights)}</span></li>
                ))}
              </ul>
              {m.rows.length > 20 && <p class="hint">… and {m.rows.length - 20} more</p>}
            </div>
          ))}</div>
        )] as [string, () => preact.JSX.Element]] : []),
      ]} />
    </div>
  );
}

/** The objects an association relation (e.g. reco <-> truth) links to this one, with the relation's weights, best
 *  first (by its `best` weight), one group per relation. */
function associations(table: string, row: number) {
  const b = bundle.value, ev = event.value;
  if (!b || !ev) return [];
  const out: { table: string; rows: { row: number; weights: Record<string, number> }[] }[] = [];
  for (const [name, info] of Object.entries(b.header.relations)) {
    const rel = ev.relations[name];
    if (!info.association || !rel || (info.from !== table && info.to !== table)) continue;
    const rows: { row: number; weights: Record<string, number> }[] = [];
    // Named by what they hold: a hit-based association (tracks) stores shared hit counts under its energy names.
    const label = (w: string) => (info.match?.measure === "hits" && (w === "sharedEnergy" || w === "sharedFraction") ? "shared hits" : w);
    const weights = (k: number) => Object.fromEntries(Object.entries(rel.weights).map(([w, a]) => [label(w), a[k]]));
    if (info.from === table)
      for (let k = rel.offsets[row]; k < rel.offsets[row + 1]; k++) rows.push({ row: rel.indices[k], weights: weights(k) });
    else
      for (let f = 0; f + 1 < rel.offsets.length; f++)
        for (let k = rel.offsets[f]; k < rel.offsets[f + 1]; k++) if (rel.indices[k] === row) rows.push({ row: f, weights: weights(k) });
    if (!rows.length) continue;
    if (info.best) { const weight = label(info.best.weight), cmp = bestFirst(info.best); rows.sort((a, c) => cmp(a.weights[weight] ?? 0, c.weights[weight] ?? 0)); }
    const other = info.from === table ? info.to : info.from, same = out.find((o) => o.table === other);
    if (same) same.rows.push(...rows.filter((r) => !same.rows.some((x) => x.row === r.row)));
    else out.push({ table: other, rows });
  }
  return out;
}

/** A hit's simulation fact: the particle that left the most simulated energy in it, and, where the simulation records
 *  a coarser unit than the hit (e.g. a CSC layer), that unit, which every hit in it shares. */
function FactLine({ table, row, chip, weights }: { table: string; row: number; chip: preact.JSX.Element; weights: string }) {
  const b = bundle.value!, f = facts(b.header).find((x) => x.to === table), unit = f && factUnit(f, event.value?.tables[table]?.columns, row);
  const where = unit ? (typeof f!.unit === "string" ? ` (per ${unit})` : ` in this ${unit}`) : "";
  return (
    <p class="truthline" title={`Simulation: the truth-graph particle that left the most simulated energy ${unit ? `in the ${unit} of this hit (the simulation does not resolve it further: every hit there shares these particles)` : "in this hit"}`}>
      <span class="badge truth">truth</span> most simulated energy{where} from {chip}
      <span class="muted">{weights}</span></p>
  );
}

function drawn(table: string) {
  const b = bundle.value;
  return !!b?.header.display.some((l) => l.table === table && drawnLayers.value[layerKey(l)]);
}

const isTruth = (table: string) => !!layerOf(table)?.truth;

/** A reco object's energy fractions (layer hint `fractions`, e.g. a jet's charged and neutral hadrons, photons...) as
 *  one bar, in a neutral ramp (a reconstruction quantity, not a colour of the views), with the shares named under it. */
function Fractions({ fractions, table, row }: { fractions: Record<string, string>; table: Table; row: number }) {
  const parts = Object.entries(fractions).filter(([c]) => c in table.columns)
    .map(([c, name]) => [name, Number(table.columns[c][row])] as const).filter(([, v]) => v >= 0.005);
  if (!parts.length) return null;
  const shade = (i: number) => `hsl(210, 8%, ${72 - (44 * i) / Math.max(1, parts.length - 1)}%)`;
  return (
    <div class="fractions" title="Energy fractions from the reconstruction (not truth)">
      <div class="fbar">{parts.map(([name, v], i) => <span style={{ width: `${100 * v}%`, background: shade(i) }} title={`${name} ${(100 * v).toFixed(0)}%`} />)}</div>
      <div class="flegend"><span class="badge reco">reco</span> energy:{parts.map(([name, v], i) => <span><i style={{ background: shade(i) }} />{name} {(100 * v).toFixed(0)}%</span>)}</div>
    </div>
  );
}
