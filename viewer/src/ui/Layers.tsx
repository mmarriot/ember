// The collections of one side-panel tab (a part of the detector, or the truth): by kind of object, then the other
// reconstruction paths folded. A kind's heading carries its cut as a chip ("pT ≥ 30 GeV": a click opens its slider) and
// "only". A collection is one line: visibility, name, its state as chips (a filter, drawn for the selection only,
// hidden while something is selected), its count (a click lists its largest objects) and ⋯ (colour, filter, new
// columns). Under it only its colour scale, when the colour key does not explain it.
import { computed, signal } from "@preact/signals";
import { useState } from "preact/hooks";
import { type DisplayLayer, kindName, unitOf } from "../io/bundle";
import { colourBy, customColumns, filterMask, filters, RELATION, removeFilter } from "../model/custom";
import { columnName, passes, topRows } from "../model/objects";
import { PALETTES, relatedColourText, type Legend } from "../render/colour";
import {
  activeMode, bundle, cutGroups, cuts, describe, event, noTruth, truthStatuses, focusHidden, focusLayers, focusLevel, labelOf, layerKey, layerName, legends, levels, modes, pairView,
  selection, short, showAll, shown, shownLayer, sizeColumn, solo, soloKey, theme, visible,
} from "../model/store";
import { ExprForm } from "./ExprForm";
import { popover, togglePopover } from "./Info";
import { rowHover } from "./Labels";
import { jump } from "./navigate";
import { Icon } from "./widgets";

/** The tab a layer is listed in: its `domain`, or "Objects" for bundles made before layers had one. */
export const tabOf = (d: DisplayLayer) => d.domain ?? "Objects";

export function Collections({ layers }: { layers: DisplayLayer[] }) {
  // Alternatives (e.g. legacy next to SoA) are folded at the end, so the kinds read as the chain.
  const main = layers.filter((l) => !l.alternative), alternatives = layers.filter((l) => l.alternative);
  const groups = new Map<string, DisplayLayer[]>();
  for (const d of main) groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
  // A kind whose collections share one cut carries it on its heading; otherwise (one per calorimeter; particles cut,
  // vertices not) each cut is on the first row it applies to.
  const cutsOf = (ls: DisplayLayer[]) => [...new Set(ls.flatMap((d) => (d.cut ? [d.cut.group] : [])))];
  const onHeading = (ls: DisplayLayer[]) => cutsOf(ls).length === 1 && ls.every((d) => d.cut);
  const rowCut = (d: DisplayLayer, ls: DisplayLayer[]) => (d.cut && !onHeading(ls) && ls.find((x) => x.cut?.group === d.cut!.group) === d ? d.cut.group : undefined);
  return (
    <>
      <Headline layers={main} />
      {[...groups].map(([group, ls]) => {
        const id = layerKey(ls[0]), shut = folded.value.has(id), drawn = ls.filter((d) => visible.value[layerKey(d)]).length;
        // Not for a kind drawn only for a selection (track hits): alone, it would show nothing to click.
        const key = soloKey(ls[0]), alone = solo.value === key, canSolo = ls.some((d) => !d.onSelection);
        return (
          <section class={shut ? "kind folded" : "kind"} key={group}>
            <h3><button class="fold" aria-expanded={!shut} title={shut ? "Show this kind's collections" : "Fold this kind"} onClick={() => fold(id)}>{group}</button>
              {sameTruth(ls) && <TruthWord table={ls[0].table} />}{shut && <span class="count"> {drawn} of {ls.length} drawn</span>}
              {!shut && onHeading(ls) && <CutChip name={cutsOf(ls)[0]} here={ls} />}
              {canSolo && <button class={alone ? "only on" : "only"} aria-pressed={alone}
                title={alone ? "Back to everything ticked" : `Look at only the ${group.toLowerCase()}: nothing else is drawn until you select one, which brings its parts and its truth`}
                onClick={() => (solo.value = alone ? null : key)}>only</button>}</h3>
            {!shut && ls.map((d) => <LayerRow key={layerKey(d)} d={d} label={d.label} cut={rowCut(d, ls)} here={ls} />)}
          </section>
        );
      })}
      {alternatives.length > 0 && (
        <details class="others">
          <summary title="The same kinds of object from another reconstruction path; hidden by default">Other reconstruction paths ({alternatives.length})</summary>
          {alternatives.map((d) => <LayerRow key={layerKey(d)} d={d} label={`${d.group} · ${d.label}`} here={alternatives}
            cut={d.cut && alternatives.find((x) => x.cut?.group === d.cut!.group) === d ? d.cut.group : undefined} />)}
        </details>
      )}
    </>
  );
}

/** Kinds folded to their heading (by their first layer), for this page's life: a long tab (e.g. Physics) gets short. */
const folded = signal(new Set<string>());
const fold = (id: string) => { const f = new Set(folded.peek()); if (!f.delete(id)) f.add(id); folded.value = f; };

/** Slider range per cut group, in log10: whole decades around the positive values of its layers in this event
 *  (at most 6 below the largest) and its default. The slider's lowest position means no cut. */
const sliderRanges = computed(() => {
  const ev = event.value, out = new Map<string, [number, number]>();
  for (const [name, g] of cutGroups.value) {
    let lo = g.default > 0 ? g.default : Infinity, hi = g.default > 0 ? g.default : 0;
    for (const d of g.layers) {
      const col = ev?.tables[d.table]?.columns[d.cut!.column];
      for (let i = 0; i < (col?.length ?? 0); i++) { const v = Number(col![i]); if (v > 0) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    }
    const top = hi > 0 ? Math.ceil(Math.log10(hi)) : 2, bottom = hi > 0 ? Math.max(Math.floor(Math.log10(lo)), top - 6) : -4;
    out.set(name, [Math.min(bottom, top - 1), top]);
  }
  return out;
});

/** A cut group's minimum as one chip, "pT ≥ 30 GeV" ("no cut" at 0; marked when it is not the profile's): a click
 *  opens its slider in a pop-up. */
function CutChip({ name, here }: { name: string; here: DisplayLayer[] }) {
  const g = cutGroups.value.get(name);
  if (!g) return null;
  const cut = g.layers[0].cut!, v = cuts.value[name] ?? g.default, what = cut.label ?? cut.column;
  return (
    <button class={v !== g.default ? "cutchip changed" : "cutchip"} title={`${name}: the minimum drawn. Click to change it`}
      onClick={(e) => togglePopover(e, () => <CutRow name={name} here={here} />, name, true)}>{v > 0 ? `${what} ≥ ${short(v)}${g.unit ? ` ${g.unit}` : ""}` : `no ${what} cut`}</button>
  );
}

/** A cut group's minimum (in the pop-up of its chip): log slider and exact value, labelled by its `label` or the
 *  column it cuts. It applies to every layer of the group, also those listed elsewhere (named under it). */
function CutRow({ name, here }: { name: string; here: DisplayLayer[] }) {
  const g = cutGroups.value.get(name);
  if (!g) return null;
  const cut = g.layers[0].cut!, v = cuts.value[name] ?? g.default, [lo, hi] = sliderRanges.value.get(name) ?? [-4, 2];
  const set = (x: number) => (cuts.value = { ...cuts.value, [name]: Math.max(0, x) });
  const toSlider = (x: number) => (x > 0 ? Math.log10(x) : lo), fromSlider = (s: number) => (s <= lo ? 0 : 10 ** s);
  const elsewhere = g.layers.filter((d) => !here.includes(d));
  return (
    <div class="cut" title={`Minimum ${name.toLowerCase()} for ${g.layers.map(layerName).join(", ")}`}>
      <div class="cutrow">
        <span class="cutname">{cut.label ?? cut.column} ≥</span>
        <input type="range" aria-label={name} min={lo} max={hi} step={0.01} value={toSlider(v)} onInput={(e) => set(fromSlider(Number((e.target as HTMLInputElement).value)))} />
        <input type="number" class="cutvalue" min={0} step="any" value={short(v)} onChange={(e) => set(Number((e.target as HTMLInputElement).value))} />
        <span class="muted unit">{g.unit}</span>
        {v !== g.default && <button class="icon-button small" title={`Reset to ${g.default} ${g.unit}`} onClick={() => set(g.default)}><Icon name="reset" /></button>}
      </div>
      {elsewhere.length > 0 && <div class="sub muted">also cuts {elsewhere.map((d) => labelOf(d.table)).join(", ")}</div>}
    </div>
  );
}

/** In the truth colours: what the truth graph says about a kind (docs/truth.md, model/match.ts truthStatus), in one
 *  word on its heading, the reason on hover; on each row instead where its layers differ (e.g. ECAL PF clusters are
 *  matched, HF ones have none). Nothing in the reco colours. */
const WORDS = { match: ["match", "matched by CMSSW's associator"], fact: ["fact", "a simulation fact: simulated energy per particle in each hit"],
  derived: ["derived", ""], none: ["no truth", ""] } as const;
function TruthWord({ table }: { table: string }) {
  const s = truthStatuses.value.get(table);
  if (activeMode.value !== "truth" || !s || s.kind === "container") return null;
  const [word, what] = WORDS[s.kind], why = "reason" in s ? `${s.reason}${s.gap !== undefined ? ` (truth-graph.md gap ${s.gap})` : ""}` : what;
  return <span class={`truthword ${s.kind}`} title={why}>{word}</span>;
}
/** The layers of a kind (its heading's group) in the current bundle. */
const kindLayers = (d: DisplayLayer) => (bundle.value?.header.display ?? []).filter((l) => l.group === d.group && !l.alternative);
/** Whether the layers have one truth status (so one word on their heading). */
const sameTruth = (ls: DisplayLayer[]) => new Set(ls.map((l) => truthStatuses.value.get(l.table)?.kind)).size <= 1;

/** A symbol for how a layer is drawn, shown before its name. */
const glyph = (d: DisplayLayer) =>
  d.repr === "cells" ? "⬢" : d.repr === "markers" ? "•" : d.repr === "segments" ? (d.truth ? "┄" : "─") : d.repr === "helix" ? (d.truth ? "┄" : "∿")
    : d.repr === "polyline" ? "⟋" : d.repr === "cones" ? "◺"
    : d.shape === "shell" ? "◯" : d.shape === "cage" ? "⊕" : d.shape === "core" ? "●" : "⬮";

/** A layer's filter (in the pop-up of its chip): the expression, and its removal. */
function FilterPop({ table }: { table: string }) {
  const filter = filters.value[table];
  return filter ? (
    <div class="filterpop"><p>Only the rows where this holds are drawn:</p><code>{filter}</code>
      <button class="remove" onClick={() => { removeFilter(table); popover.value = null; }}>Remove the filter</button></div>
  ) : <p>No filter.</p>;
}

function LayerRow({ d, label, cut, here = [] }: { d: DisplayLayer; label: string; cut?: string; here?: DisplayLayer[] }) {
  const b = bundle.value!, key = layerKey(d), n = event.value?.tables[d.table]?.n ?? 0, legend = legends.value[key];
  const on = !!visible.value[key], s = shown.value[key], filter = filters.value[d.table];
  const [open, setOpen] = useState(false), [listed, setListed] = useState(false);
  // Its largest objects can be listed (those with a `list` hint always are); not hits, which lead nowhere.
  const t = event.value?.tables[d.table], canList = !d.list && !d.context && d.repr !== "cells" && n > 0 && !!t;
  const count = `${on && s !== undefined && s !== n ? `${s.toLocaleString()} / ` : ""}${n.toLocaleString()}`;
  // A layer of one of the focus's levels: ticking it (or its "show") draws that level.
  const level = levels.value.find((l) => l.layers.includes(d))?.name, showLevel = () => level && (focusLevel.value = level);
  return (
    <div class={`layer${on || focusLayers.value.has(key) ? "" : " off"}${activeMode.value === "truth" && noTruth(d.table) ? " faint" : ""}`}>
      <div class="row">
        <label title={`${d.table}${b.header.tables[d.table]?.doc ? `: ${b.header.tables[d.table].doc}` : ""}`}>
          <input type="checkbox" checked={on} disabled={!n} onChange={() => { visible.value = { ...visible.value, [key]: !on }; if (!on) showLevel(); }} />
          <span class="glyph" aria-hidden="true">{glyph(d)}</span>
          <span class="name">{label}</span>{d.source && <span class="tag" title="Reconstruction path">{d.source}</span>}
          {!sameTruth(kindLayers(d)) && <TruthWord table={d.table} />}
        </label>
        {filter && <button class="rowchip on filter" title={`Filtered: ${filter}. Click to see or remove the filter`} onClick={(e) => togglePopover(e, () => <FilterPop table={d.table} />, "Filter")}>filter</button>}
        {on && d.onSelection && <button class={showAll.value[key] ? "rowchip" : "rowchip on"} aria-pressed={!showAll.value[key]}
          title={showAll.value[key] ? "All of them are drawn. Click to draw only those of the selected object" : "Drawn only for the selected object. Click to draw all of them"}
          onClick={() => (showAll.value = { ...showAll.value, [key]: !showAll.value[key] })}>{showAll.value[key] ? "all" : "selected"}</button>}
        {!on && focusLayers.value.has(key) && <span class="rowchip on" title="Not ticked, but drawn now: it holds objects of the selection">shown</span>}
        {on && focusHidden.value.has(key) && <button class="rowchip" title="Hidden while an object is selected: one of its levels is drawn at a time. Click to draw this one" onClick={showLevel}>show</button>}
        {cut && <CutChip name={cut} here={here} />}
        {canList ? <button class="count listbtn" aria-expanded={listed} title="List its largest objects: click one to select it (N steps through them)" onClick={() => setListed(!listed)}>{count} {listed ? "▾" : "▸"}</button>
          : <span class="count">{count}</span>}
        <button class={open ? "more on" : "more"} aria-expanded={open} title="Colour, filter and new columns" onClick={() => setOpen(!open)}>⋯</button>
      </div>
      {open ? <Options d={d} legend={on ? legend : undefined} /> : on && legend && !keyed(d) && <div class="legend"><Scale d={d} legend={legend} /></div>}
      {on && d.list && <ObjectRows d={d} />}
      {listed && canList && <ObjectRows d={d} list={{ columns: [sizeColumn(d.table, t!)].filter((c): c is string => !!c), max: 8 }} />}
    </div>
  );
}

/** A layer's rows that pass its cut and filter (model/objects.ts). */
export function passing(d: DisplayLayer) {
  const t = event.value?.tables[d.table];
  if (!t) return null;
  return { t, pass: passes(d, t, d.cut ? cuts.value[d.cut.group] ?? 0 : 0, filterMask(t, filters.value[d.table])) };
}

/** The event in one line, from the ticked layers with object rows (`list`): how many objects of each kind pass the cuts
 *  and filters ("Jets 4", the layers of a kind summed, e.g. barrel and endcap electrons), or the value of a one-object
 *  table ("Puppi MET 42.2 GeV"). */
function Headline({ layers }: { layers: DisplayLayer[] }) {
  const parts = new Map<string, number | string>();
  for (const d of layers.filter((l) => l.list && visible.value[layerKey(l)])) {
    const p = passing(d);
    if (!p) continue;
    if (d.list!.headline === "value") {
      const c = d.list!.columns[0], col = p.t.columns[c];
      if (!col || !p.t.n) continue;
      const unit = unitOf(bundle.value!.header.tables[d.table]?.columns[c]?.doc);
      parts.set(d.label, `${short(Number(col[0]))}${unit ? ` ${unit}` : ""}`);
      continue;
    }
    let n = 0;
    for (let i = 0; i < p.t.n; i++) if (p.pass(i)) n++;
    const name = kindName(d);
    parts.set(name, (Number(parts.get(name)) || 0) + n);
  }
  return parts.size ? <p class="headline">{[...parts].map(([label, value], i) => <>{i > 0 && " · "}{label} <b>{typeof value === "number" ? value.toLocaleString() : value}</b></>)}</p> : null;
}

/** The largest objects of a layer with a `list` hint, one row each with its columns; a click selects (and frames) it,
 *  the pointer over a row rings the object in the view. */
function ObjectRows({ d, list = d.list! }: { d: DisplayLayer; list?: NonNullable<DisplayLayer["list"]> }) {
  const p = passing(d), sel = selection.value;
  if (!p) return null;
  const cols = list.columns.filter((c) => c in p.t.columns);
  const rows = topRows(p.t, list.sort ?? sizeColumn(d.table, p.t), p.pass, list.max ?? 10);
  if (!rows.length) return null;
  const more = (() => { let n = 0; for (let i = 0; i < p.t.n; i++) if (p.pass(i)) n++; return n - rows.length; })();
  return (
    <table class="objects">
      <thead><tr><th />{cols.map((c) => <th title={bundle.value!.header.tables[d.table]?.columns[c]?.doc}>{columnName(c)}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, k) => (
          <tr class={sel?.table === d.table && sel.row === r ? "selected" : undefined} onClick={() => jump({ table: d.table, row: r })}
            onMouseEnter={() => (rowHover.value = { table: d.table, row: r })} onMouseLeave={() => (rowHover.value = null)}
            title={`${labelOf(d.table)} #${r}: select it (pointed at in the view)`}>
            {/* its name without the columns shown next to it (a jet: none, so its rank; a PF candidate: its type) */}
            <td>{describe(d.table, r, cols) || `${k + 1}`}</td>
            {cols.map((c) => <td>{short(Number(p.t.columns[c][r]))}</td>)}
          </tr>
        ))}
        {more > 0 && <tr class="more"><td colSpan={cols.length + 1}>… and {more.toLocaleString()} more</td></tr>}
      </tbody>
    </table>
  );
}

/** Whether the colour key at the bottom of the panel explains the layer's colours (particle type, generator
 *  particle, or the pair view), so its own legend would only repeat it. */
function keyed(d: DisplayLayer) {
  const mode = activeMode.value;
  if (mode === "layers" || d.context || colourBy.value[layerKey(d)]) return false;
  if (pairView.value?.classes.has(d.table)) return true;
  if (mode === "truth") { const c = shownLayer(d).colourBy; return d.table === modes.value.roots.truth || (c !== d.colourBy && c !== "none"); }
  return !d.truth && (d.table === modes.value.roots.reco || shownLayer(d).colourBy !== d.colourBy);
}

/** Behind ⋯: what colours the layer (any column, custom ones too, or a related object), with its scale; a filter or a
 *  new column for its table; the table's custom columns. */
function Options({ d, legend }: { d: DisplayLayer; legend?: Legend }) {
  const key = layerKey(d), chosen = colourBy.value[key] ?? "", header = bundle.value!.header;
  const columns = Object.keys(event.value?.tables[d.table]?.columns ?? {});
  // One choice per related drawn table; of two relations between the same tables (e.g. reco -> truth best match, and
  // truth -> reco sharing), the one that points from this layer wins.
  const drawnTables = new Set(header.display.map((l) => l.table)), byTable = new Map<string, string>();
  for (const [name, r] of Object.entries(header.relations)) {
    const other = r.from === d.table ? r.to : r.from;
    if ((r.from === d.table) === (r.to === d.table) || !drawnTables.has(other)) continue;
    if (!byTable.has(other) || r.from === d.table) byTable.set(other, name);
  }
  const shownD = shownLayer(d, activeMode.value, {}), byMode = shownD.colourBy !== d.colourBy;
  const current = typeof shownD.colourBy === "object" && "relation" in shownD.colourBy ? shownD.colourBy.relation : "";
  const related = [...byTable].filter(([, name]) => name !== current)
    .map(([other, name]) => [`${RELATION}${name}`, relatedColourText(header, other, name)]);
  const choose = (c: string) => { const { [key]: _, ...rest } = colourBy.value; colourBy.value = c ? { ...rest, [key]: c } : rest; };
  const defs = customColumns.value.filter((c) => c.table === d.table);
  return (
    <div class="options">
      <div class="legend">
        <select class="colourby" title="Colour by" value={chosen} onChange={(e) => choose((e.target as HTMLSelectElement).value)}>
          <option value="">{(byMode && shownD.colourBy !== "none") || (activeMode.value === "pid" && d.table === modes.value.roots.reco) ? "colour key" : d.colourBy ? "by object" : d.colour ?? "default"}</option>
          {related.length > 0 && <optgroup label="Related objects">{related.map(([v, text]) => <option value={v}>{text}</option>)}</optgroup>}
          {columns.filter((c) => d.colourBy || c !== d.colour).map((c) => <option value={c}>{c}</option>)}
        </select>
        {legend && <Scale d={d} legend={legend} full />}
      </div>
      <ExprForm table={d.table} />
      {defs.map((c) => (
        <div class="defn"><code>{c.name} = {c.expr}</code>
          <button class="icon-button small" title="Remove column" onClick={() => (customColumns.value = customColumns.value.filter((x) => x !== c))}><Icon name="close" /></button>
        </div>
      ))}
    </div>
  );
}

/** A layer's colours: its categories, or a few swatches and what they stand for, or a value ramp with its range (and
 *  its column, unless `full`: there the colour choice above names it). */
function Scale({ d, legend, full = false }: { d: DisplayLayer; legend: Legend; full?: boolean }) {
  const pal = PALETTES[theme.value], shownD = shownLayer(d, activeMode.value, colourBy.value);
  // Identity colours (directly, or taken along a chain in the colour mode) show the identity palette.
  const identity = shownD.colourBy === "identity" || (typeof shownD.colourBy === "object" && shownD.colourBy !== d.colourBy);
  if (shownD.fixedColour && (shownD.colourBy === undefined || shownD.colourBy === "none")) return null; // its kind's colour: nothing to explain
  if (shownD.colourBy === "none") return <><span class="dots"><i style={{ background: pal.other }} /></span>{legend.kind === "category" ? legend.text : ""}</>;
  if (legend.kind === "category" && legend.items && !legend.items.some((it) => it.ref))
    return <span class="items">{legend.items.map((it) => <span><i style={{ background: it.colour }} />{it.label}</span>)}</span>;
  if (legend.kind === "category")
    return <><span class="dots">{(identity ? pal.identity : pal.categories).slice(0, 5).map((c) => <i style={{ background: c }} />)}</span>
      {legend.text}{legend.note && `; ${legend.note}`}</>;
  return (
    <>
      <span class="ramp" style={{ background: `linear-gradient(to right, ${pal.ramps[legend.palette].join(",")})` }} />
      <span>{legend.column && !full ? `${legend.column} ` : ""}{legend.range.scale === "log" ? `${short(10 ** legend.range.lo)} – ${short(10 ** legend.range.hi)}` : `${short(legend.range.lo)} – ${short(legend.range.hi)}`} {legend.unit}</span>
    </>
  );
}
