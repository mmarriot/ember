// A collection's colours: its scale under its row (Scale), and behind its ⋯ what colours it, a filter or a new column
// for its table (ExprForm.tsx) and the table's custom columns (Options).
import { type DisplayLayer } from "../../io/format";
import { colourBy, type CustomColumn, customColumns, RELATION } from "../../model/custom/custom";
import { PALETTES, relatedColourText, type Legend } from "../../render/colour";
import { layerEntries } from "../../model/colour/key";
import { activeMode, bundle, event, layerKey, modes, shownLayer, theme } from "../../model/store";
import { ExprForm } from "./ExprForm";
import { Swatch } from "./Key";
import { Icon } from "../common/widgets";

/** Behind ⋯: what colours the layer (any column, or a related object), with its scale; the expression form; the
 *  table's custom columns. */
export function Options({ d, legend }: { d: DisplayLayer; legend?: Legend }) {
  const key = layerKey(d),
    chosen = colourBy.value[key] ?? "",
    header = bundle.value!.header;
  const columns = Object.keys(event.value?.tables[d.table]?.columns ?? {});
  // One choice per related drawn table; of two relations between the same tables, the one from this layer wins.
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
        <ColumnDef c={c} />
      ))}
    </div>
  );
}

/** A custom column's definition, with a button that removes it. `withTable`: its table named before it. */
export function ColumnDef({ c, withTable, title }: { c: CustomColumn; withTable?: boolean; title?: string }) {
  return (
    <div class="defn" title={title}>
      {withTable && <span class="muted">{c.table}</span>}
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
  );
}

/** A layer's colours: its categories, a few swatches, or a value ramp with its range (and its column, unless `full`:
 *  the colour choice above names it). A kind's own colour needs none. */
export function Scale({ d, legend, full = false }: { d: DisplayLayer; legend: Legend; full?: boolean }) {
  const shownD = shownLayer(d, activeMode.value, colourBy.value);
  if (shownD.fixedColour && (shownD.colourBy === undefined || shownD.colourBy === "none")) return null;
  return (
    <span class="items">
      {layerEntries(d, legend, PALETTES[theme.value], !full).map((e) => (
        <span>
          <Swatch e={e} />
          {e.label}
        </span>
      ))}
    </span>
  );
}
