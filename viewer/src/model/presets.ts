// Named ways of looking at the data from the profile (`presets`): which column colours each table's layers and which
// rows are shown. Applying one sets the same per-layer colour choices and per-table filters a user can set by hand.
import type { DisplayLayer, Header, Preset } from "../io/format";
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
  // Layers any preset ticks start from their default tick; this one's are ticked: those it shows (e.g. the PF
  // candidates for "What PUPPI removed", which start unticked) and those it colours (the AK4 CHS jets of "b-tags").
  const ticks = { ...visible.peek() },
    ticksOf = (p: Preset, d: DisplayLayer) => !!p.show?.includes(d.table) || (!d.context && !!p.colour?.[d.table]);
  for (const d of b.header.display)
    if (presets.some((p) => ticksOf(p, d))) ticks[layerKey(d)] = !!d.visible || ticksOf(presets[i], d);
  colourBy.value = by;
  filters.value = rows;
  visible.value = ticks;
  activePreset.value = i;
}

/** Whether the bundle has what preset `p` uses: every table it colours or ticks, and every column it colours by (a
 *  related object, "rel:…", is not a column). A data set without b-tag columns is not offered "b-tags". */
export function presetFits(p: Preset, h: Pick<Header, "tables">): boolean {
  const has = (t: string) => !!h.tables[t];
  return (
    (p.show ?? []).every(has) &&
    Object.entries(p.colour ?? {}).every(([t, c]) => has(t) && (c.startsWith("rel:") || !!h.tables[t].columns[c]))
  );
}
