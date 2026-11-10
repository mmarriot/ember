// Layers tab: presets, one card per kind of object with its layers (visibility, count, legend and colour choice),
// truth shortcuts, and the other reconstruction paths folded at the end.
import type { DisplayLayer } from "../io/bundle";
import { activePreset, colourBy, RELATION } from "../model/custom";
import { applyPreset } from "../model/presets";
import { relationInto } from "../model/relations";
import { PALETTES, relatedColourText, type Legend } from "../render/colour";
import { bundle, event, focusLayers, isHitLayer, layerKey, legends, short, showAll, shown, theme, visible } from "../model/store";

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
  return (
    <div class={on ? "layer" : "layer off"}>
      <label title={b.header.tables[d.table]?.doc ?? d.table}>
        <input type="checkbox" checked={on} disabled={!n} onChange={() => (visible.value = { ...visible.value, [key]: !on })} />
        <span class="glyph" aria-hidden="true">{glyph(d)}</span>
        <span class="name">{label}{d.source && <span class="tag" title="Reconstruction path">{d.source}</span>}</span>
        <span class="count">{on && s !== undefined && s !== n ? `${s.toLocaleString()} / ` : ""}{n.toLocaleString()}</span>
      </label>
      {!on && focusLayers.value.has(key) && <div class="sub muted">shown for the focus</div>}
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
  const hitRels = b.header.display.filter((d) => isHitLayer(d) && !d.alternative).flatMap((d) => {
    const rel = relationInto(b.header, truthTables, d.table);
    return rel ? [[layerKey(d), `${RELATION}${rel}`] as const] : [];
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
        title="Draw every particle that passes the filter, not only those related to the selection">All particles</button>}
    </div>
  );
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
  const current = typeof d.colourBy === "object" && "relation" in d.colourBy ? d.colourBy.relation : "";
  const related = [...byTable].filter(([, name]) => name !== current)
    .map(([other, name]) => [`${RELATION}${name}`, relatedColourText(header, other)]);
  const choose = (c: string) => { const { [key]: _, ...rest } = colourBy.value; colourBy.value = c ? { ...rest, [key]: c } : rest; };
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
          <span>{legend.range.scale === "log" ? `${short(10 ** legend.range.lo)} – ${short(10 ** legend.range.hi)}` : `${short(legend.range.lo)} – ${short(legend.range.hi)}`} {legend.unit}</span>
        </>
      )}
    </div>
  );
}
