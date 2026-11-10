// Cuts tab: a log-scale slider (plus exact input) per cut group of the profile, and per-table filters.
import { computed } from "@preact/signals";
import { filters, removeFilter, setFilter } from "../model/custom";
import { bundle, cutGroups, cuts, event, labelOf, layerName, short } from "../model/store";
import { ExprForm } from "./Columns";
import { Icon } from "./widgets";

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

export function Cuts() {
  const groups = cutGroups.value;
  return (
    <div>
      {groups.size > 0 && <p class="hint">Each cut applies to every layer listed under it.</p>}
      {[...groups].map(([name, g]) => {
        const v = cuts.value[name] ?? g.default, [lo, hi] = sliderRanges.value.get(name) ?? [-4, 2];
        const set = (x: number) => (cuts.value = { ...cuts.value, [name]: Math.max(0, x) });
        const toSlider = (x: number) => (x > 0 ? Math.log10(x) : lo), fromSlider = (s: number) => (s <= lo ? 0 : 10 ** s);
        return (
          <div class="card">
            <h3>{name}</h3>
            <div class="cutrow">
              <input type="range" min={lo} max={hi} step={0.01} value={toSlider(v)} onInput={(e) => set(fromSlider(Number((e.target as HTMLInputElement).value)))} />
              <input type="number" class="cutvalue" min={0} step="any" value={short(v)} onChange={(e) => set(Number((e.target as HTMLInputElement).value))} />
              <span class="muted">{g.unit}</span>
            </div>
            <p class="hint">Applies to: {g.layers.map(layerName).join(", ")}</p>
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
  if (!b) return <p class="hint">No data loaded.</p>;
  const tables = [...new Set(b.header.display.map((d) => d.table))];
  return (
    <div class="card">
      <h3>Filters</h3>
      <p class="hint">Show only the objects for which an expression holds, e.g. <code>energy / sigmaNoise &gt; 5</code>.</p>
      {Object.entries(filters.value).filter(([t, expr]) => expr && tables.includes(t)).map(([t, expr]) => (
        <div class="defn"><span class="muted">{labelOf(t)}</span><code>{expr}</code><button class="icon-button small" title="Remove filter" onClick={() => removeFilter(t)}><Icon name="close" /></button></div>
      ))}
      <ExprForm tables={tables} submit={setFilter} action="Apply filter" placeholder="e.g. layer == 26" />
    </div>
  );
}
