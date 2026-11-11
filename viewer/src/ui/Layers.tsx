// The collections of one side-panel tab (a part of the detector, or the truth): by kind of object, each kind with its
// cut slider, then the other reconstruction paths folded. A collection is one line (visibility, count); under it
// only what is not said elsewhere: its filter, "only for the selection", and its colour scale when the colour key
// does not explain it. Its ⋯ opens the colour choice, a filter and new columns for its table.
import { computed } from "@preact/signals";
import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { type DisplayLayer, unitOf } from "../io/bundle";
import { colourBy, customColumns, filterMask, filters, RELATION, removeFilter } from "../model/custom";
import { columnName, passes, topRows } from "../model/objects";
import { PALETTES, relatedColourText, type Legend } from "../render/colour";
import {
  activeMode, bundle, cutGroups, cuts, describe, event, focusHidden, focusLayers, focusLevel, labelOf, layerKey, layerName, legends, levels, modes, pairView,
  selection, short, showAll, shown, shownLayer, sizeColumn, theme, visible,
} from "../model/store";
import { ExprForm } from "./ExprForm";
import { jump } from "./navigate";
import { Icon } from "./widgets";

/** The tab a layer is listed in: its `domain`, or "Objects" for bundles made before layers had one. */
export const tabOf = (d: DisplayLayer) => d.domain ?? "Objects";

export function Collections({ layers }: { layers: DisplayLayer[] }) {
  // Alternatives (e.g. legacy next to SoA) are folded at the end, so the kinds read as the chain.
  const main = layers.filter((l) => !l.alternative), alternatives = layers.filter((l) => l.alternative);
  const groups = new Map<string, DisplayLayer[]>();
  for (const d of main) groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
  // Each cut slider once, with the first kind it applies to.
  const placed = new Set<string>();
  const cutsOf = (ls: DisplayLayer[]) => [...new Set(ls.flatMap((d) => (d.cut ? [d.cut.group] : [])))].filter((g) => !placed.has(g) && !!placed.add(g));
  return (
    <>
      <Headline layers={main} />
      {[...groups].map(([group, ls]) => (
        <section class="kind" key={group}>
          <h3>{group}</h3>
          {/* each slider just before the first row it cuts (a kind can have several, e.g. one per calorimeter) */}
          {ls.map((d) => <Fragment key={layerKey(d)}>{cutsOf([d]).map((name) => <CutRow name={name} here={ls} named={new Set(ls.flatMap((x) => (x.cut ? [x.cut.group] : []))).size > 1} />)}<LayerRow d={d} label={d.label} /></Fragment>)}
        </section>
      ))}
      {alternatives.length > 0 && (
        <details class="others">
          <summary title="The same kinds of object from another reconstruction path; hidden by default">Other reconstruction paths ({alternatives.length})</summary>
          {cutsOf(alternatives).map((name) => <CutRow name={name} here={alternatives} />)}
          {alternatives.map((d) => <LayerRow key={layerKey(d)} d={d} label={`${d.group} · ${d.label}`} />)}
        </details>
      )}
    </>
  );
}

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

/** A cut group's minimum: log slider and exact value, labelled by the column it cuts (the group's name is in its
 *  tooltip, and above it when its kind has several cuts, e.g. one per calorimeter: `named`). It applies to every layer
 *  of the group, also those listed elsewhere (named under it). */
function CutRow({ name, here, named = false }: { name: string; here: DisplayLayer[]; named?: boolean }) {
  const g = cutGroups.value.get(name);
  if (!g) return null;
  const v = cuts.value[name] ?? g.default, [lo, hi] = sliderRanges.value.get(name) ?? [-4, 2];
  const set = (x: number) => (cuts.value = { ...cuts.value, [name]: Math.max(0, x) });
  const toSlider = (x: number) => (x > 0 ? Math.log10(x) : lo), fromSlider = (s: number) => (s <= lo ? 0 : 10 ** s);
  const elsewhere = g.layers.filter((d) => !here.includes(d));
  return (
    <div class="cut" title={`Minimum ${name.toLowerCase()} for ${g.layers.map(layerName).join(", ")}`}>
      {named && <div class="cutgroup">{name}</div>}
      <div class="cutrow">
        <span class="cutname">{g.layers[0].cut!.column} ≥</span>
        <input type="range" aria-label={name} min={lo} max={hi} step={0.01} value={toSlider(v)} onInput={(e) => set(fromSlider(Number((e.target as HTMLInputElement).value)))} />
        <input type="number" class="cutvalue" min={0} step="any" value={short(v)} onChange={(e) => set(Number((e.target as HTMLInputElement).value))} />
        <span class="muted unit">{g.unit}</span>
        {v !== g.default && <button class="icon-button small" title={`Reset to ${g.default} ${g.unit}`} onClick={() => set(g.default)}><Icon name="reset" /></button>}
      </div>
      {elsewhere.length > 0 && <div class="sub muted">also cuts {elsewhere.map((d) => labelOf(d.table)).join(", ")}</div>}
    </div>
  );
}

/** A symbol for how a layer is drawn, shown before its name. */
const glyph = (d: DisplayLayer) =>
  d.repr === "cells" ? "⬢" : d.repr === "markers" ? "•" : d.repr === "segments" ? (d.truth ? "┄" : "─") : d.repr === "helix" ? (d.truth ? "┄" : "∿")
    : d.shape === "shell" ? "◯" : d.shape === "cage" ? "⊕" : d.shape === "core" ? "●" : "⬮";

function LayerRow({ d, label }: { d: DisplayLayer; label: string }) {
  const b = bundle.value!, key = layerKey(d), n = event.value?.tables[d.table]?.n ?? 0, legend = legends.value[key];
  const on = !!visible.value[key], s = shown.value[key], filter = filters.value[d.table];
  const [open, setOpen] = useState(false);
  // A layer of one of the focus's levels: ticking it (or the link under it) shows that level.
  const level = levels.value.find((l) => l.layers.includes(d))?.name, showLevel = () => level && (focusLevel.value = level);
  return (
    <div class={on ? "layer" : "layer off"}>
      <div class="row">
        <label title={`${d.table}${b.header.tables[d.table]?.doc ? `: ${b.header.tables[d.table].doc}` : ""}`}>
          <input type="checkbox" checked={on} disabled={!n} onChange={() => { visible.value = { ...visible.value, [key]: !on }; if (!on) showLevel(); }} />
          <span class="glyph" aria-hidden="true">{glyph(d)}</span>
          <span class="name">{label}</span>{d.source && <span class="tag" title="Reconstruction path">{d.source}</span>}
          <span class="count">{on && s !== undefined && s !== n ? `${s.toLocaleString()} / ` : ""}{n.toLocaleString()}</span>
        </label>
        <button class={open ? "more on" : "more"} aria-expanded={open} title="Colour, filter and new columns" onClick={() => setOpen(!open)}>⋯</button>
      </div>
      {!on && focusLayers.value.has(key) && <div class="sub muted">shown for the focus</div>}
      {on && focusHidden.value.has(key) && (
        <div class="sub muted wrap" title="A focus shows one of its levels at a time">hidden for the focus · <button class="link" onClick={showLevel}>show {level}</button></div>
      )}
      {filter && (
        <div class="sub filter" title="Only the rows where this holds are shown">filter <code>{filter}</code>
          <button class="icon-button small" title="Remove filter" onClick={() => removeFilter(d.table)}><Icon name="close" /></button></div>
      )}
      {on && d.onSelection && (
        <label class="sub" title="Ticked: only the objects related to what you click; unticked: all of them">
          <input type="checkbox" checked={!showAll.value[key]} onChange={() => (showAll.value = { ...showAll.value, [key]: !showAll.value[key] })} />
          only for the selection{!showAll.value[key] && !s ? " (click something)" : ""}
        </label>
      )}
      {open ? <Options d={d} legend={on ? legend : undefined} /> : on && legend && !keyed(d) && <div class="legend"><Scale d={d} legend={legend} /></div>}
      {on && d.list && <ObjectRows d={d} />}
    </div>
  );
}

/** A layer's rows that pass its cut and filter (model/objects.ts). */
function passing(d: DisplayLayer) {
  const t = event.value?.tables[d.table];
  if (!t) return null;
  return { t, pass: passes(d, t, d.cut ? cuts.value[d.cut.group] ?? 0 : 0, filterMask(t, filters.value[d.table])) };
}

/** The event in one line, from the ticked layers with object rows (`list`): how many objects of each pass its cut and
 *  filter ("Jets 4"), or the value of a one-object table ("MET 42.2 GeV"). */
function Headline({ layers }: { layers: DisplayLayer[] }) {
  const parts = layers.filter((d) => d.list && visible.value[layerKey(d)]).flatMap((d) => {
    const p = passing(d);
    if (!p) return [];
    if (d.list!.headline === "value") {
      const c = d.list!.columns[0], col = p.t.columns[c];
      if (!col || !p.t.n) return [];
      const unit = unitOf(bundle.value!.header.tables[d.table]?.columns[c]?.doc);
      return [[d.label, `${short(Number(col[0]))}${unit ? ` ${unit}` : ""}`]];
    }
    let n = 0;
    for (let i = 0; i < p.t.n; i++) if (p.pass(i)) n++;
    return [[d.label, n.toLocaleString()]];
  });
  return parts.length ? <p class="headline">{parts.map(([label, value], i) => <>{i > 0 && " · "}{label} <b>{value}</b></>)}</p> : null;
}

/** The largest objects of a layer with a `list` hint, one row each with its columns; a click selects (and frames) it. */
function ObjectRows({ d }: { d: DisplayLayer }) {
  const p = passing(d), sel = selection.value, list = d.list!;
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
            title={`${labelOf(d.table)} #${r}: select it`}>
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
