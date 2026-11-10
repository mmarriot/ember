// Named ways of looking at the data from the profile (`presets`): which column colours each table's layers and which
// rows are shown. Applying one sets the same per-layer colour choices and per-table filters a user can set by hand.
import { signal } from "@preact/signals";
import { colourBy, filters } from "./custom";
import { bundle, layerKey } from "./store";

export const activePreset = signal(0);

export function applyPreset(i: number) {
  const b = bundle.peek(), presets = b?.header.presets;
  if (!b || !presets?.[i]) return;
  // Tables any preset touches start from their defaults, so switching presets never leaves the previous one's settings.
  const touched = new Set(presets.flatMap((p) => [...Object.keys(p.colour ?? {}), ...Object.keys(p.filters ?? {})]));
  const by = { ...colourBy.peek() }, rows = { ...filters.peek() };
  for (const d of b.header.display) if (touched.has(d.table)) delete by[layerKey(d)];
  for (const t of touched) { // back to the data set's default filter (display hint `filter`), if any
    const d = b.header.display.find((l) => l.table === t && l.filter);
    if (d) rows[t] = d.filter!; else delete rows[t];
  }
  for (const [table, column] of Object.entries(presets[i].colour ?? {}))
    for (const d of b.header.display) if (d.table === table && !d.context) by[layerKey(d)] = column;
  Object.assign(rows, presets[i].filters ?? {});
  colourBy.value = by;
  filters.value = rows;
  activePreset.value = i;
}
