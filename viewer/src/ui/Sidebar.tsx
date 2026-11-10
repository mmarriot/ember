// Left panel with tabs: layers (with legends and colour choice), cuts and filters, custom columns, event summary.
import { useState } from "preact/hooks";
import type { DisplayLayer } from "../io/bundle";
import { colourBy, customColumns, evaluate, filters, RELATION } from "../model/custom";
import { FUNCTION_NAMES } from "../model/expr";
import { PALETTES, type Legend } from "../render/colour";
import { bundle, cutGroups, cuts, event, eventIndex, focusLayers, labelOf, layerKey, legends, loadMs, showAll, shown, theme, visible } from "../model/store";
import { Tree, treeRelations } from "./Tree";
import { activePreset, applyPreset } from "../model/presets";
import { Summaries } from "./Summaries";
import { Icon, Tabs } from "./widgets";

export const Sidebar = () => (
  <>
    <aside class="sidebar">
      <Tabs tabs={[["Layers", Layers], ["Cuts", Cuts], ["Columns", Columns], ...(treeRelations().length ? [[bundle.value?.header.display.some((d) => d.truth) ? "Truth" : "Tree", Tree] as [string, () => preact.JSX.Element]] : []), ["Event", EventInfo]]} />
    </aside>
    <div class="resizer" title="Drag to resize, double-click to reset" onPointerDown={startResize} onDblClick={() => setWidth(DEFAULT_WIDTH)} />
  </>
);

// Sidebar width: a CSS variable on the root, remembered per browser (storage may be unavailable, e.g. private mode).
const DEFAULT_WIDTH = 340, KEY = "evd.sidebar";
function setWidth(px: number) {
  const w = Math.round(Math.min(560, Math.max(260, px)));
  document.documentElement.style.setProperty("--sidebar", `${w}px`);
  try { localStorage.setItem(KEY, String(w)); } catch { /* not persisted */ }
}
try { const w = Number(localStorage.getItem(KEY)); if (w) setWidth(w); } catch { /* default width */ }

function startResize(e: PointerEvent) {
  const handle = e.currentTarget as HTMLElement;
  handle.setPointerCapture(e.pointerId);
  document.body.classList.add("resizing");
  const move = (m: PointerEvent) => setWidth(m.clientX);
  const up = () => { handle.removeEventListener("pointermove", move); document.body.classList.remove("resizing"); };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up, { once: true });
}

function Layers() {
  const b = bundle.value;
  if (!b) return <p class="hint">No data loaded.</p>;
  // One card per kind of object; other reconstruction paths of a kind already shown (e.g. legacy next to SoA) are
  // folded into one section at the end, so the list reads as the reconstruction chain.
  const groups = new Map<string, DisplayLayer[]>();
  for (const d of b.header.display.filter((l) => !l.alternative)) groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
  const alternatives = b.header.display.filter((l) => l.alternative);
  const presets = b.header.presets ?? [];
  return (
    <div>
      {presets.length > 1 && (
        <div class="segmented presets" role="group" aria-label="Preset">
          {presets.map((p, i) => <button class={activePreset.value === i ? "on" : ""} onClick={() => applyPreset(i)}>{p.name}</button>)}
        </div>
      )}
      {[...groups].map(([group, layers]) => {
        const truth = layers.every((d) => d.truth);
        return (
          <div class={truth ? "card truth" : "card"}>
            <h3>{group}{truth && <span class="badge truth" title="Simulation truth, not reconstruction">simulation</span>}</h3>
            {layers.map((d) => <LayerRow d={d} label={d.label} />)}
            {truth && <TruthActions />}
          </div>
        );
      })}
      {alternatives.length > 0 && (
        <details class="card">
          <summary>Other reconstruction paths ({alternatives.length})</summary>
          <p class="hint">The same objects from another path (e.g. legacy next to SoA); hidden by default.</p>
          {alternatives.map((d) => <LayerRow d={d} label={`${d.group} · ${d.label}${d.source ? ` (${d.source})` : ""}`} />)}
        </details>
      )}
    </div>
  );
}

/** A symbol for how a layer is drawn, shown before its name. */
const glyph = (d: DisplayLayer) =>
  d.repr === "cells" ? "⬢" : d.repr === "markers" ? "•" : d.repr === "segments" ? (d.truth ? "┄" : "─")
    : d.shape === "shell" ? "◯" : d.shape === "cage" ? "⊕" : d.shape === "core" ? "●" : "⬮";

function LayerRow({ d, label }: { d: DisplayLayer; label: string }) {
  const b = bundle.value!, ev = event.value;
  const key = layerKey(d), n = ev?.tables[d.table]?.n ?? 0, legend = legends.value[key];
  const on = !!visible.value[key], s = shown.value[key];
  return (
    <div class={on ? "layer" : "layer off"}>
      <label title={b.header.tables[d.table]?.doc ?? d.table}>
        <input type="checkbox" checked={on} disabled={!n} onChange={() => (visible.value = { ...visible.value, [key]: !on })} />
        <span class="glyph" aria-hidden="true">{glyph(d)}</span>
        <span class="name">{label}</span>
        <span class="count">{on && s !== undefined && s !== n ? `${s.toLocaleString()} / ` : ""}{n.toLocaleString()}</span>
      </label>
      {!on && focusLayers.value.split("|").includes(key) && <div class="sub muted">shown for the focus</div>}
      {on && legend && <LegendRow d={d} legend={legend} />}
      {on && d.onSelection && (
        <label class="sub" title="Ticked: only the objects related to what you click; unticked: all of them">
          <input type="checkbox" checked={!showAll.value[key]} onChange={() => (showAll.value = { ...showAll.value, [key]: !showAll.value[key] })} />
          only for the selected object{!showAll.value[key] && (s ? "" : " (click something)")}
        </label>
      )}
    </div>
  );
}

/** One-click truth views: hits coloured by the particle that deposited them; every truth particle drawn. */
function TruthActions() {
  const b = bundle.value!;
  const truthTables = new Set(b.header.display.filter((d) => d.truth).map((d) => d.table));
  const hitRels = b.header.display.filter((d) => d.repr === "cells" && !d.alternative).flatMap((d) => {
    const rel = Object.entries(b.header.relations).find(([, r]) => truthTables.has(r.from) && r.to === d.table);
    return rel ? [[layerKey(d), `${RELATION}${rel[0]}`] as const] : [];
  });
  const hitsByTruth = hitRels.length > 0 && hitRels.every(([k, v]) => colourBy.value[k] === v);
  const truthLayers = b.header.display.filter((d) => d.truth && d.onSelection && visible.value[layerKey(d)]);
  const allDrawn = truthLayers.length > 0 && truthLayers.every((d) => showAll.value[layerKey(d)]);
  const toggleHits = () => {
    const next = { ...colourBy.value };
    for (const [k, v] of hitRels) if (hitsByTruth) delete next[k]; else next[k] = v;
    colourBy.value = next;
  };
  const toggleAll = () => {
    const next = { ...showAll.value };
    for (const d of truthLayers) next[layerKey(d)] = !allDrawn;
    showAll.value = next;
  };
  return (
    <div class="actions-row">
      {hitRels.length > 0 && <button class={hitsByTruth ? "pill active" : "pill"} onClick={toggleHits}
        title="Colour each hit by the simulated particle that left most energy in it (grey: none)">Hits by particle</button>}
      {truthLayers.length > 0 && <button class={allDrawn ? "pill active" : "pill"} onClick={toggleAll}
        title="Draw every particle (signal by default), not only those related to the selection">All particles</button>}
    </div>
  );
}

/** The layer's colour scale, and a choice of the column that sets it (any column, including custom ones). */
function LegendRow({ d, legend }: { d: DisplayLayer; legend: Legend }) {
  const pal = PALETTES[theme.value], key = layerKey(d), chosen = colourBy.value[key] ?? "";
  const columns = Object.keys(event.value?.tables[d.table]?.columns ?? {});
  // Relations to another drawn table can colour the layer too: e.g. tracksters by their truth particle.
  const header = bundle.value?.header, shown = new Set(header?.display.map((l) => l.table));
  // One choice per related table: of two relations between the same tables (e.g. reco -> truth best match, and
  // truth -> reco sharing), the one that points from this layer wins.
  const byTable = new Map<string, string>();
  for (const [name, r] of Object.entries(header?.relations ?? {})) {
    const other = r.from === d.table ? r.to : r.from;
    if ((r.from === d.table) === (r.to === d.table) || !shown.has(other)) continue;
    if (!byTable.has(other) || r.from === d.table) byTable.set(other, name);
  }
  const current = typeof d.colourBy === "object" && "relation" in d.colourBy ? d.colourBy.relation : "";
  const related = [...byTable].filter(([, name]) => name !== current)
    .map(([other, name]) => [`${RELATION}${name}`, `colour of its ${labelOf(other).toLowerCase()}`]);
  const choose = (c: string) => { const { [key]: _, ...rest } = colourBy.value; colourBy.value = c ? { ...rest, [key]: c } : rest; };
  const fmt = (v: number) => { const a = Math.abs(v); return a >= 100 ? v.toFixed(0) : a >= 1 ? v.toFixed(1) : v === 0 ? "0" : v.toPrecision(2); };
  return (
    <div class="legend">
      <select class="colourby" title="Colour by" value={chosen} onChange={(e) => choose((e.target as HTMLSelectElement).value)}>
        <option value="">{d.colourBy ? "by object" : d.colour ?? "default"}</option>
        {related.length > 0 && <optgroup label="Related objects">{related.map(([v, text]) => <option value={v}>{text}</option>)}</optgroup>}
        {columns.filter((c) => d.colourBy || c !== d.colour).map((c) => <option value={c}>{c}</option>)}
      </select>
      {legend.kind === "category" && legend.items ? (
        <span class="items">{legend.items.map((it) => <span><i style={{ background: it.colour }} />{it.label}</span>)}</span>
      ) : legend.kind === "category" ? (
        <><span class="dots">{pal.categories.slice(0, 5).map((c) => <i style={{ background: c }} />)}</span>{legend.text}</>
      ) : (
        <>
          <span class="ramp" style={{ background: `linear-gradient(to right, ${pal.ramps[legend.palette].join(",")})` }} />
          <span>{legend.range.scale === "log" ? `${fmt(10 ** legend.range.lo)} – ${fmt(10 ** legend.range.hi)}` : `${fmt(legend.range.lo)} – ${fmt(legend.range.hi)}`} {legend.unit}</span>
        </>
      )}
    </div>
  );
}

/** Log-scale slider (plus exact input) per cut group. The same minimum applies to every layer in the group. */
function Cuts() {
  const groups = cutGroups.value;
  if (!groups.size) return <p class="hint">This data set defines no cuts.</p>;
  return (
    <div>
      <p class="hint">Each cut applies to every layer listed under it, so SoA and legacy objects are cut identically.</p>
      {[...groups].map(([name, g]) => {
        const v = cuts.value[name] ?? g.default;
        const set = (x: number) => (cuts.value = { ...cuts.value, [name]: Math.max(0, x) });
        const toSlider = (x: number) => (x <= 0 ? -4 : Math.log10(x)), fromSlider = (s: number) => (s <= -4 ? 0 : 10 ** s);
        return (
          <div class="card">
            <h3>{name}</h3>
            <div class="cutrow">
              <input type="range" min={-4} max={2} step={0.01} value={toSlider(v)} onInput={(e) => set(fromSlider(Number((e.target as HTMLInputElement).value)))} />
              <input type="number" class="cutvalue" min={0} step="any" value={Number(v.toPrecision(3))} onChange={(e) => set(Number((e.target as HTMLInputElement).value))} />
              <span class="muted">{g.unit}</span>
            </div>
            <p class="hint">Applies to: {g.layers.map((d) => d.label).join(", ")}</p>
            {v !== g.default && <button class="link" onClick={() => set(g.default)}>Reset to {g.default} {g.unit}</button>}
          </div>
        );
      })}
      <Filters />
    </div>
  );
}

/** Per-table filters: rows where the expression is 0 (false) are hidden, on top of the cuts. */
function Filters() {
  const b = bundle.value;
  if (!b) return null;
  const tables = [...new Set(b.header.display.map((d) => d.table))];
  // A filter the data set sets by default is kept as "" when removed, so it does not come back next time.
  const remove = (t: string) => {
    const { [t]: _, ...rest } = filters.value;
    filters.value = b.header.display.some((d) => d.table === t && d.filter) ? { ...rest, [t]: "" } : rest;
  };
  return (
    <div class="card">
      <h3>Filters</h3>
      <p class="hint">Show only the objects for which an expression holds, e.g. <code>energy / sigmaNoise &gt; 5</code>.</p>
      {Object.entries(filters.value).filter(([t, expr]) => expr && tables.includes(t)).map(([t, expr]) => (
        <div class="defn"><span class="muted">{labelOf(t)}</span><code>{expr}</code><button class="icon-button small" title="Remove filter" onClick={() => remove(t)}><Icon name="close" /></button></div>
      ))}
      <ExprForm tables={tables} submit={(t, expr) => (filters.value = { ...filters.value, [t]: expr })} action="Apply filter" placeholder="e.g. layer == 26" />
    </div>
  );
}

/** Custom columns: computed in the browser for every event, shown in the inspector, usable for colour and filters. */
function Columns() {
  const b = bundle.value;
  if (!b) return <p class="hint">No data loaded.</p>;
  const shown = [...new Set(b.header.display.map((d) => d.table))];
  const tables = [...shown, ...Object.keys(b.header.tables).filter((t) => !shown.includes(t))];
  const defs = customColumns.value;
  return (
    <div>
      <p class="hint">Define columns from existing ones. They appear in the inspector, can colour a layer (Layers tab) and can be used in filters (Cuts tab).</p>
      <div class="card">
        <h3>New column</h3>
        <ExprForm tables={tables} named action="Add column" placeholder="e.g. energy / sigmaNoise"
          submit={(table, expr, name) => (customColumns.value = [...defs, { table, name: name!, expr }])} />
      </div>
      {defs.length > 0 && (
        <div class="card">
          <h3>Your columns</h3>
          {defs.map((c, i) => (
            <div class="defn" title={b.header.tables[c.table] ? undefined : "This data set has no such table"}>
              <span class="muted">{labelOf(c.table)}</span><code>{c.name} = {c.expr}</code>
              <button class="icon-button small" title="Remove column" onClick={() => (customColumns.value = defs.filter((_, k) => k !== i))}><Icon name="close" /></button>
            </div>
          ))}
        </div>
      )}
      <details class="card">
        <summary>Expression syntax</summary>
        <p class="hint">Column names of the table, numbers, <code>pi</code>, operators <code>+ - * / % ^</code>, comparisons <code>&lt; &lt;= &gt; &gt;= == !=</code>
          (1 if true, 0 if false), <code>&amp;&amp; || !</code>, parentheses, and the functions {FUNCTION_NAMES.join(", ")}.</p>
      </details>
    </div>
  );
}

/** Table choice, optional name, expression with live feedback on the current event, and a submit button. */
function ExprForm({ tables, named = false, action, placeholder, submit }: {
  tables: string[]; named?: boolean; action: string; placeholder: string; submit: (table: string, expr: string, name?: string) => void;
}) {
  const ev = event.value;
  const [table, setTable] = useState(tables[0] ?? ""), [name, setName] = useState(""), [expr, setExpr] = useState("");
  const t = ev?.tables[table], columns = Object.keys(t?.columns ?? {});
  const nameError = !named ? "" : !name ? "Give it a name" : !/^[A-Za-z_]\w*$/.test(name) ? "Letters, digits and _ only" : columns.includes(name) ? "Name already used" : "";
  const result = t && expr.trim() ? evaluate(t, expr) : null;
  const ok = !!result && !("error" in result) && !nameError;
  const feedback = !result ? (t ? "" : "Not in this event") : "error" in result ? result.error : summary(result.values, result.boolean);
  return (
    <form class="exprform" onSubmit={(e) => { e.preventDefault(); if (ok) { submit(table, expr.trim(), name); setName(""); setExpr(""); } }}>
      <div class="row">
        <select value={table} onChange={(e) => setTable((e.target as HTMLSelectElement).value)} title="Table">
          {tables.map((x) => <option value={x}>{labelOf(x)}{labelOf(x) !== x ? ` (${x})` : ""}</option>)}
        </select>
        {named && <input class="name" placeholder="name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />}
      </div>
      <input class="expr" placeholder={placeholder} value={expr} spellcheck={false} onInput={(e) => setExpr((e.target as HTMLInputElement).value)} />
      <div class={`feedback ${result && "error" in result ? "bad" : ""}`}>{(expr && named && nameError) || feedback}</div>
      <details>
        <summary>Columns of this table ({columns.length})</summary>
        <div>{columns.map((c) => <button type="button" class="chip" onClick={() => setExpr((x) => (x && !/[\s(]$/.test(x) ? `${x} ${c}` : x + c))}>{c}</button>)}</div>
      </details>
      <button type="submit" class="primary" disabled={!ok}>{action}</button>
    </form>
  );
}

function summary(v: Float32Array, boolean: boolean) {
  if (!v.length) return "No rows in this event";
  if (boolean) { let k = 0; for (const x of v) if (x) k++; return `True for ${k.toLocaleString()} of ${v.length.toLocaleString()} rows in this event`; }
  let lo = Infinity, hi = -Infinity, bad = 0;
  for (const x of v) if (Number.isFinite(x)) { lo = Math.min(lo, x); hi = Math.max(hi, x); } else bad++;
  const f = (x: number) => (Math.abs(x) >= 1e4 || (x !== 0 && Math.abs(x) < 1e-3) ? x.toExponential(2) : Number(x.toPrecision(4)).toString());
  return `${lo <= hi ? `${f(lo)} … ${f(hi)}` : "no finite values"} in this event${bad ? ` · ${bad} not finite` : ""}`;
}

/** Event identity, object counts per displayed layer (grouped as in the Layers tab), every table, and provenance. */
/** What is known about the run of the shown event (from the bundle index), if anything. */
function RunInfoCard() {
  const b = bundle.value, e = b?.events[eventIndex.value];
  const info = b && e ? b.runInfo(e.run) : {};
  if (!b || !e || !Object.keys(info).length) return null;
  const title = b.runTitle(e.run);
  return (
    <div class="card">
      <h3>Run {e.run} {title && <span class="count">{title}</span>}</h3>
      <table class="kv stats"><tbody>
        {(b.header.runFields ?? Object.keys(info)).filter((k) => k in info).map((k) => <tr title={`${k}: ${info[k]}`}><td>{k}</td><td>{String(info[k])}</td></tr>)}
      </tbody></table>
    </div>
  );
}

function EventInfo() {
  const b = bundle.value, ev = event.value, e = b?.events[eventIndex.value];
  if (!b || !ev || !e) return <p class="hint">No event loaded.</p>;
  const h = b.header, n = (table: string) => ev.tables[table]?.n ?? 0;
  const groups = new Map<string, typeof h.display>();
  for (const d of h.display) if (!groups.get(d.group)?.some((x) => x.table === d.table)) groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
  const tables = Object.keys(ev.tables).filter(n).sort((a, c) => n(c) - n(a));
  return (
    <div>
      <div class="card">
        <h3>Event</h3>
        <table class="kv stats"><tbody>
          <tr><td>Run</td><td>{e.run}</td></tr><tr><td>Lumi section</td><td>{e.lumi}</td></tr><tr><td>Event</td><td>{e.event}</td></tr>
          <tr><td>Position in file</td><td>{eventIndex.value + 1} of {b.events.length}</td></tr>
          <tr><td>Loaded in</td><td>{loadMs.value.toFixed(0)} ms</td></tr>
        </tbody></table>
      </div>
      <RunInfoCard />
      <Summaries />
      <div class="card">
        <h3>Displayed collections</h3>
        <table class="kv stats"><tbody>
          {[...groups].map(([group, layers]) => [
            <tr class="group"><td colSpan={2}>{group}</td></tr>,
            ...layers.map((d) => <tr title={`${d.table}: ${h.tables[d.table]?.doc ?? ""}`}><td>{d.label}</td><td>{n(d.table).toLocaleString()}</td></tr>),
          ])}
        </tbody></table>
        <details>
          <summary>All tables ({tables.length})</summary>
          <table class="kv stats mono"><tbody>
            {tables.map((name) => <tr title={h.tables[name]?.doc}><td>{name}</td><td>{n(name).toLocaleString()}</td></tr>)}
          </tbody></table>
        </details>
      </div>
      <div class="card">
        <h3>Source</h3>
        <table class="kv stats"><tbody>
          <tr><td>Profile</td><td>{h.profile}</td></tr>
          {h.source.created && <tr><td>Created</td><td>{h.source.created}</td></tr>}
        </tbody></table>
        {h.source.files.map((f) => <div class="path" title={f}>{f}</div>)}
      </div>
    </div>
  );
}
