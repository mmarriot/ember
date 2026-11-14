// A collection's colours: its scale under its row (Scale), and behind its ⋯ what colours it, with a filter or a new
// column for its table (Options, ExprForm.tsx) and the table's custom columns.
import { type DisplayLayer } from "../io/format";
import { colourBy, customColumns, RELATION } from "../model/custom";
import { PALETTES, relatedColourText, type Legend } from "../render/colour";
import { activeMode, bundle, event, layerKey, modes, pairView, short, shownLayer, theme } from "../model/store";
import { ExprForm } from "./ExprForm";
import { Icon } from "./widgets";

/** Whether the colour key at the bottom of the panel explains the layer's colours (particle type, generator
 *  particle, or the pair view), so its own legend would only repeat it. */
export function keyed(d: DisplayLayer) {
  const mode = activeMode.value;
  if (mode === "layers" || d.context || colourBy.value[layerKey(d)]) return false;
  if (pairView.value?.classes.has(d.table)) return true;
  if (mode === "truth") {
    const c = shownLayer(d).colourBy;
    return d.table === modes.value.roots.truth || (c !== d.colourBy && c !== "none");
  }
  return !d.truth && (d.table === modes.value.roots.reco || shownLayer(d).colourBy !== d.colourBy);
}

/** Behind ⋯: what colours the layer (any column, custom ones too, or a related object), with its scale; a filter or a
 *  new column for its table; the table's custom columns. */
export function Options({ d, legend }: { d: DisplayLayer; legend?: Legend }) {
  const key = layerKey(d),
    chosen = colourBy.value[key] ?? "",
    header = bundle.value!.header;
  const columns = Object.keys(event.value?.tables[d.table]?.columns ?? {});
  // One choice per related drawn table; of two relations between the same tables (e.g. reco -> truth best match, and
  // truth -> reco sharing), the one that points from this layer wins.
  const drawnTables = new Set(header.display.map((l) => l.table)),
    byTable = new Map<string, string>();
  for (const [name, r] of Object.entries(header.relations)) {
    const other = r.from === d.table ? r.to : r.from;
    if ((r.from === d.table) === (r.to === d.table) || !drawnTables.has(other)) continue;
    if (!byTable.has(other) || r.from === d.table) byTable.set(other, name);
  }
  const shownD = shownLayer(d, activeMode.value, {}),
    byMode = shownD.colourBy !== d.colourBy;
  const current = typeof shownD.colourBy === "object" && "relation" in shownD.colourBy ? shownD.colourBy.relation : "";
  const related = [...byTable]
    .filter(([, name]) => name !== current)
    .map(([other, name]) => [`${RELATION}${name}`, relatedColourText(header, other, name)]);
  const choose = (c: string) => {
    const { [key]: _, ...rest } = colourBy.value;
    colourBy.value = c ? { ...rest, [key]: c } : rest;
  };
  const defs = customColumns.value.filter((c) => c.table === d.table);
  return (
    <div class="options">
      <div class="legend">
        <select
          class="colourby"
          title="Colour by"
          value={chosen}
          onChange={(e) => choose((e.target as HTMLSelectElement).value)}
        >
          <option value="">
            {(byMode && shownD.colourBy !== "none") ||
            (activeMode.value === "pid" && d.table === modes.value.roots.reco)
              ? "colour key"
              : d.colourBy
                ? "by object"
                : (d.colour ?? "default")}
          </option>
          {related.length > 0 && (
            <optgroup label="Related objects">
              {related.map(([v, text]) => (
                <option value={v}>{text}</option>
              ))}
            </optgroup>
          )}
          {columns
            .filter((c) => d.colourBy || c !== d.colour)
            .map((c) => (
              <option value={c}>{c}</option>
            ))}
        </select>
        {legend && <Scale d={d} legend={legend} full />}
      </div>
      <ExprForm table={d.table} />
      {defs.map((c) => (
        <div class="defn">
          <code>
            {c.name} = {c.expr}
          </code>
          <button
            class="icon-button small"
            title="Remove column"
            onClick={() => (customColumns.value = customColumns.value.filter((x) => x !== c))}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** A layer's colours: its categories, or a few swatches and what they stand for, or a value ramp with its range (and
 *  its column, unless `full`: there the colour choice above names it). */
export function Scale({ d, legend, full = false }: { d: DisplayLayer; legend: Legend; full?: boolean }) {
  const pal = PALETTES[theme.value],
    shownD = shownLayer(d, activeMode.value, colourBy.value);
  // Identity colours (directly, or taken along a chain in the colour mode) show the identity palette.
  const identity =
    shownD.colourBy === "identity" || (typeof shownD.colourBy === "object" && shownD.colourBy !== d.colourBy);
  if (shownD.fixedColour && (shownD.colourBy === undefined || shownD.colourBy === "none")) return null; // its kind's colour: nothing to explain
  if (shownD.colourBy === "none")
    return (
      <>
        <span class="dots">
          <i style={{ background: pal.other }} />
        </span>
        {legend.kind === "category" ? legend.text : ""}
      </>
    );
  if (legend.kind === "category" && legend.items && !legend.items.some((it) => it.ref))
    return (
      <span class="items">
        {legend.items.map((it) => (
          <span>
            <i style={{ background: it.colour }} />
            {it.label}
          </span>
        ))}
      </span>
    );
  if (legend.kind === "category")
    return (
      <>
        <span class="dots">
          {(identity ? pal.identity : pal.categories).slice(0, 5).map((c) => (
            <i style={{ background: c }} />
          ))}
        </span>
        {legend.text}
        {legend.note && `; ${legend.note}`}
      </>
    );
  return (
    <>
      <span class="ramp" style={{ background: `linear-gradient(to right, ${pal.ramps[legend.palette].join(",")})` }} />
      <span>
        {legend.column && !full ? `${legend.column} ` : ""}
        {legend.range.scale === "log"
          ? `${short(10 ** legend.range.lo)} – ${short(10 ** legend.range.hi)}`
          : `${short(legend.range.lo)} – ${short(legend.range.hi)}`}{" "}
        {legend.unit}
      </span>
    </>
  );
}
