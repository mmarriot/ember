// Layers tab: the colour mode and its key, presets, one card per kind of object with its layers (visibility, count,
// legend and colour choice), truth shortcuts, and the other reconstruction paths folded at the end.
import type { DisplayLayer } from "../io/bundle";
import { activePreset, colourBy, type ColourMode, RELATION } from "../model/custom";
import { applyPreset } from "../model/presets";
import { identities } from "../model/relations";
import { PALETTES, relatedColourText, tableName, type Legend } from "../render/colour";
import {
  activeMode, bundle, colourFirst, describe, event, focusLayers, layerKey, layerOf, legends, modes, setMode, short, showAll, shown, shownLayer,
  theme, visible,
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

const MODES: Record<ColourMode, [string, string]> = {
  truth: ["Truth particle", "One colour per truth-graph particle; hits, layer clusters and reconstructed objects take the colour of the particle linked to them"],
  reco: ["Reconstruction", "One colour per final reconstructed object (candidate); everything it is made of, and the truth particles it reconstructs, take its colour"],
  layers: ["Per layer", "Each layer coloured on its own (energies, particle types): colours are not shared between layers"],
};
/** What each layer takes its colour from, per mode, for the key. */
const HOW: Record<Exclude<ColourMode, "layers">, string[]> = {
  truth: ["hits: the particle that left the most simulated energy in them", "layer clusters: the particle with the most simulated energy in their hits (worked out here: the truth graph has no layer-cluster association)",
    "tracksters, candidates, tracks: their best truth match",
    "a particle shares the colour of its highest ancestor that left hits or is matched to a reco object: one colour per truth shower, e.g. a π⁺ that interacted before the calorimeter and its daughters"],
  reco: ["layer clusters, tracks, interpretations: their candidate", "hits: their layer cluster's candidate", "tracksters, linked tracksters: the candidate holding most of their layer clusters",
    "truth particles: the candidate that reconstructs the largest share of them"],
};

/** How many other objects take the colour of `row` (e.g. the descendants in a truth particle's branch). */
const branch = (key: Int32Array, row: number) => key.reduce((n, k, i) => n + (k === row && i !== row ? 1 : 0), 0);

/** The colour mode switch and, for the truth and reco modes, the key: which object each colour stands for. */
function ColourModes() {
  const { available, roots } = modes.value, mode = activeMode.value, b = bundle.value!, ev = event.value;
  if (available.length < 2) return null;
  const root = mode === "layers" ? undefined : roots[mode], d = root ? layerOf(root) : undefined, t = root ? ev?.tables[root] : undefined;
  const pal = PALETTES[theme.value], key = d && t && ev ? identities(shownLayer(d), t, ev, b.header, pal.identity.length, colourFirst.value.get(root!)) : null;
  return (
    <div class="card colourmode">
      <h3>Colour by</h3>
      <div class="segmented presets" role="group" aria-label="Colour mode">
        {available.map((m) => <button class={m === mode ? "on" : ""} title={MODES[m][1]} onClick={() => setMode(m)}>{MODES[m][0]}</button>)}
      </div>
      {key && root && mode !== "layers" && (
        <>
          <p class="hint">One colour each for the largest {tableName(b.header, root)}; the same colour in another layer means linked to it.</p>
          <ul class="key">
            {key.top.map((row, j) => {
              const below = branch(key.key, row);
              return <li><i style={{ background: pal.identity[j] }} /><button class="chip" onClick={() => jump({ table: root, row })}>{describe(root, row) || `#${row}`}</button>
                {below > 0 && <span title="particles below it that share its colour">+{below} below</span>}</li>;
            })}
            {key.others > 0 && <li><i style={{ background: pal.other }} />the other {key.others.toLocaleString()}</li>}
            <li><i class="small" style={{ background: pal.unassigned }} />small: nothing linked{mode === "truth" ? " (noise, or a particle not exported)" : ""}</li>
          </ul>
          <details class="how"><summary>How each layer is coloured</summary><ul>{HOW[mode].map((x) => <li>{x}</li>)}</ul></details>
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
