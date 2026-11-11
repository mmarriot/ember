// Layers tab: the colour mode and its key, presets, one card per kind of object with its layers (visibility, count,
// legend and colour choice), truth shortcuts, and the other reconstruction paths folded at the end.
import type { DisplayLayer } from "../io/bundle";
import { activePreset, colourBy, type ColourMode, RELATION } from "../model/custom";
import { applyPreset } from "../model/presets";
import { PAIR, type PairClass } from "../model/pair";
import { PALETTES, relatedColourText, type Legend } from "../render/colour";
import {
  activeMode, bundle, describe, event, focusHidden, focusLayers, focusLevel, layerKey, layerOf, legends, levels, modes, pairView, setMode, short,
  showAll, shown, shownLayer, theme, visible,
} from "../model/store";
import { jump } from "./navigate";

export function Layers() {
  const b = bundle.value;
  if (!b) return <p class="hint">No data loaded.</p>;
  // Alternatives (e.g. legacy next to SoA) are folded into one section at the end, so the cards read as the chain.
  const groups = new Map<string, DisplayLayer[]>();
  for (const d of b.header.display.filter((l) => !l.alternative)) groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
  const alternatives = b.header.display.filter((l) => l.alternative);
  const presets = b.header.presets ?? [];
  return (
    <div>
      <ColourModes />
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
          <p class="hint">The same kinds of object from another path; hidden by default.</p>
          {alternatives.map((d) => <LayerRow d={d} label={`${d.group} · ${d.label}`} />)}
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
  const b = bundle.value!, key = layerKey(d), n = event.value?.tables[d.table]?.n ?? 0, legend = legends.value[key];
  const on = !!visible.value[key], s = shown.value[key];
  // A layer of one of the focus's levels: ticking it (or the link under it) shows that level.
  const level = levels.value.find((l) => l.layers.includes(d))?.name, showLevel = () => level && (focusLevel.value = level);
  return (
    <div class={on ? "layer" : "layer off"}>
      <label title={b.header.tables[d.table]?.doc ?? d.table}>
        <input type="checkbox" checked={on} disabled={!n} onChange={() => { visible.value = { ...visible.value, [key]: !on }; if (!on) showLevel(); }} />
        <span class="glyph" aria-hidden="true">{glyph(d)}</span>
        <span class="name">{label}{d.source && <span class="tag" title="Reconstruction path">{d.source}</span>}</span>
        <span class="count">{on && s !== undefined && s !== n ? `${s.toLocaleString()} / ` : ""}{n.toLocaleString()}</span>
      </label>
      {!on && focusLayers.value.has(key) && <div class="sub muted">shown for the focus</div>}
      {on && focusHidden.value.has(key) && (
        <div class="sub muted">hidden for the focus, which shows one level at a time · <button class="link" onClick={showLevel}>show {level}</button></div>
      )}
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

const MODES: Record<ColourMode, [string, string]> = {
  pid: ["Particle type", "Candidates by particle type, and everything they are made of in the same colour; select anything to see its truth <-> reco pair"],
  layers: ["Per layer", "Each layer coloured on its own (energies, particle types): colours are not shared between layers"],
};
/** The pair view's classes: colour, name, meaning. */
const CLASSES: [Exclude<PairClass, 0>, string, string][] = [
  [PAIR.matched, "matched", "the particle's hits in its candidate"],
  [PAIR.contamination, "contamination", "in the candidate, from other particles or none"],
  [PAIR.split, "split", "the particle's hits in other candidates"],
  [PAIR.missed, "missed", "the particle's hits in no candidate"],
];
const pct = (x: number, total: number) => `${total > 0 ? Math.round((100 * x) / total) : 0}%`;

/** The colour mode switch and its key: particle types with nothing selected; the selection's pair otherwise. */
function ColourModes() {
  const { available, roots } = modes.value, mode = activeMode.value, pair = pairView.value, pal = PALETTES[theme.value];
  if (available.length < 2) return null;
  const candLayer = roots.reco ? layerOf(roots.reco) : undefined, pid = candLayer ? legends.value[layerKey(candLayer)] : undefined;
  const chip = (t: string | undefined, r: number) => (t && r >= 0 ? <button class="chip" onClick={() => jump({ table: t, row: r })}>{describe(t, r) || `#${r}`}</button> : null);
  const eff = pair?.efficiency, effTotal = eff ? eff.candidate + eff.others + eff.missed : 0, pur = pair?.purity;
  return (
    <div class="card colourmode">
      <h3>Colour by</h3>
      <div class="segmented presets" role="group" aria-label="Colour mode">
        {available.map((m) => <button class={m === mode ? "on" : ""} title={MODES[m][1]} onClick={() => setMode(m)}>{MODES[m][0]}</button>)}
      </div>
      {mode === "pid" && !pair && (
        <>
          <p class="hint">Candidates by particle type; their interpretations, tracksters, layer clusters, hits and tracks take the same
            colour. Small grey: in no candidate. Select anything to see its truth ↔ reco pair.</p>
          {pid?.kind === "category" && pid.items && <ul class="key">{pid.items.map((it) => <li><i style={{ background: it.colour }} />{it.label}</li>)}</ul>}
        </>
      )}
      {pair && (
        <>
          <p class="pairline"><span class="badge truth">truth graph</span> {chip(pair.truth, pair.particle) ?? <span class="muted">no particle</span>}
            <span aria-hidden="true">↔</span> {chip(pair.reco, pair.candidate) ?? <span class="muted">no candidate</span>}</p>
          {pair.particle < 0 && <p class="hint">{pair.truth ? "No truth particle matched" : "No truth in this file"}: the candidate's own objects are shown as matched.</p>}
          <ul class="key">
            {CLASSES.filter(([c]) => pair.particle >= 0 || c === PAIR.matched)
              .map(([c, name, what]) => <li><i style={{ background: pal.pair[c] }} /><b>{pair.particle < 0 ? "in the candidate" : name}</b> {pair.particle >= 0 && <span>{what}</span>}</li>)}
            <li><i class="small" style={{ background: pal.unassigned }} />everything else</li>
          </ul>
          {eff && effTotal > 0 && <p class="hint" title="The particle's simulated energy over its whole shower, in exported hits">
            Particle's energy: {pct(eff.candidate, effTotal)} in its candidate, {pct(eff.others, effTotal)} in other candidates, {pct(eff.missed, effTotal)} in none.</p>}
          {pur && pur.particle + pur.other > 0 && <p class="hint" title="The candidate's hit energy, by the particle that left the most simulated energy in each hit">
            Candidate's energy: {pct(pur.particle, pur.particle + pur.other)} from the particle.</p>}
        </>
      )}
    </div>
  );
}

/** Truth shortcut: every truth particle drawn, not only those related to the selection. */
function TruthActions() {
  const b = bundle.value!;
  const truthLayers = b.header.display.filter((d) => d.truth && d.onSelection && visible.value[layerKey(d)]);
  const allDrawn = truthLayers.length > 0 && truthLayers.every((d) => showAll.value[layerKey(d)]);
  const toggleAll = () => {
    const next = { ...showAll.value };
    for (const d of truthLayers) next[layerKey(d)] = !allDrawn;
    showAll.value = next;
  };
  return truthLayers.length > 0 ? (
    <div class="actions-row">
      <button class={allDrawn ? "pill active" : "pill"} onClick={toggleAll}
        title="Draw every particle that passes the filter, not only those related to the selection">All particles</button>
    </div>
  ) : null;
}

/** The layer's colour scale, and a choice of what sets it: any column (custom ones too) or a related object. */
function LegendRow({ d, legend }: { d: DisplayLayer; legend: Legend }) {
  const pal = PALETTES[theme.value], key = layerKey(d), chosen = colourBy.value[key] ?? "", header = bundle.value!.header;
  const columns = Object.keys(event.value?.tables[d.table]?.columns ?? {});
  // One choice per related drawn table; of two relations between the same tables (e.g. reco -> truth best match, and
  // truth -> reco sharing), the one that points from this layer wins.
  const drawnTables = new Set(header.display.map((l) => l.table)), byTable = new Map<string, string>();
  for (const [name, r] of Object.entries(header.relations)) {
    const other = r.from === d.table ? r.to : r.from;
    if ((r.from === d.table) === (r.to === d.table) || !drawnTables.has(other)) continue;
    if (!byTable.has(other) || r.from === d.table) byTable.set(other, name);
  }
  const shown = shownLayer(d, activeMode.value, {}), byMode = shown.colourBy !== d.colourBy;
  // Identity colours (directly, or taken along a chain in a colour mode) show the identity palette.
  const identity = shown.colourBy === "identity" || (byMode && !!shown.colourBy);
  const current = typeof shown.colourBy === "object" && "relation" in shown.colourBy ? shown.colourBy.relation : "";
  const related = [...byTable].filter(([, name]) => name !== current)
    .map(([other, name]) => [`${RELATION}${name}`, relatedColourText(header, other, name)]);
  const choose = (c: string) => { const { [key]: _, ...rest } = colourBy.value; colourBy.value = c ? { ...rest, [key]: c } : rest; };
  return (
    <div class="legend">
      <select class="colourby" title="Colour by" value={chosen} onChange={(e) => choose((e.target as HTMLSelectElement).value)}>
        <option value="">{byMode ? "colour mode" : d.colourBy ? "by object" : d.colour ?? "default"}</option>
        {related.length > 0 && <optgroup label="Related objects">{related.map(([v, text]) => <option value={v}>{text}</option>)}</optgroup>}
        {columns.filter((c) => d.colourBy || c !== d.colour).map((c) => <option value={c}>{c}</option>)}
      </select>
      {legend.kind === "category" && legend.items && !legend.items.some((it) => it.ref) ? (
        <span class="items">{legend.items.map((it) => <span><i style={{ background: it.colour }} />{it.label}</span>)}</span>
      ) : legend.kind === "category" ? (
        <><span class="dots">{(identity ? pal.identity : pal.categories).slice(0, 5).map((c) => <i style={{ background: c }} />)}</span>
          {legend.text}{legend.note && `; ${legend.note}`}</>
      ) : (
        <>
          <span class="ramp" style={{ background: `linear-gradient(to right, ${pal.ramps[legend.palette].join(",")})` }} />
          <span>{legend.range.scale === "log" ? `${short(10 ** legend.range.lo)} – ${short(10 ** legend.range.hi)}` : `${short(legend.range.lo)} – ${short(legend.range.hi)}`} {legend.unit}</span>
        </>
      )}
    </div>
  );
}
