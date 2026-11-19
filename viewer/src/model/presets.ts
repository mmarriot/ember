// Named ways of looking at the data from the profile (`presets`): which column colours each table's layers and which
// rows are shown. Applying one sets the same per-layer colour choices and per-table filters a user can set by hand.
import { activePreset, colourBy, filters, resetFilter } from "./custom";
import { bundle, layerKey, visible } from "./store";

export function applyPreset(i: number) {
  const b = bundle.peek(),
    presets = b?.header.presets;
  if (!b || !presets?.[i]) return;
  // Tables any preset touches start from their defaults, so switching presets never leaves the previous one's settings.
  const touched = new Set(presets.flatMap((p) => [...Object.keys(p.colour ?? {}), ...Object.keys(p.filters ?? {})]));
  const by = { ...colourBy.peek() },
    rows = { ...filters.peek() };
  for (const d of b.header.display) if (touched.has(d.table)) delete by[layerKey(d)];
  for (const t of touched) resetFilter(rows, t);
  for (const [table, column] of Object.entries(presets[i].colour ?? {}))
    for (const d of b.header.display) if (d.table === table && !d.context) by[layerKey(d)] = column;
  Object.assign(rows, presets[i].filters ?? {});
  // Layers any preset ticks (`show`) start from their default tick; this one's are ticked (e.g. the PF candidates for
  // "What PUPPI removed", which start unticked).
  const shownBy = new Set(presets.flatMap((p) => p.show ?? [])),
    ticks = { ...visible.peek() };
  for (const d of b.header.display)
    if (shownBy.has(d.table)) ticks[layerKey(d)] = !!d.visible || !!presets[i].show?.includes(d.table);
  colourBy.value = by;
  filters.value = rows;
  visible.value = ticks;
  activePreset.value = i;
}
