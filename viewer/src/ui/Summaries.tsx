// Per-event charts from the profile's `summaries`, e.g. energy per layer: rows of a table grouped by an integer
// column, counted or summed. Only rows that pass the layer's cut and filter count, so the chart matches the view.
import type { Summary } from "../io/bundle";
import { evaluate, filters } from "../model/custom";
import { bundle, cuts, event } from "../model/store";
import { cutMin, cutValues } from "./Viewport";

export function Summaries() {
  const b = bundle.value, ev = event.value;
  const list = (b?.header.summaries ?? []).filter((s) => ev?.tables[s.table]?.n);
  return <>{list.map((s) => <Chart s={s} />)}</>;
}

const fmt = (v: number) => (Math.abs(v) >= 100 || Number.isInteger(v) ? v.toFixed(0) : v.toPrecision(3));

function Chart({ s }: { s: Summary }) {
  const t = event.value!.tables[s.table], d = bundle.value!.header.display.find((l) => l.table === s.table);
  const group = t.columns[s.groupBy], value = s.value ? t.columns[s.value] : undefined;
  if (!group || (s.value && !value)) return null;
  const shownValues = d ? cutValues(d, t, filters.value[s.table]) : undefined;
  const min = d ? cutMin({ d, cutValues: shownValues }, cuts.value) : -Infinity;
  const where = s.where ? evaluate(t, s.where) : null;
  const totals = new Map<number, number>(), counts = new Map<number, number>();
  for (let i = 0; i < t.n; i++) {
    if (shownValues && shownValues[i] < min) continue;
    if (where && "values" in where && !where.values[i]) continue;
    const k = Number(group[i]);
    totals.set(k, (totals.get(k) ?? 0) + (value ? Number(value[i]) : 1));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  // The header shows the total, or for "mean" the mean over all rows.
  const sum = [...totals.values()].reduce((a, v) => a + v, 0) / (s.op === "mean" ? [...counts.values()].reduce((a, v) => a + v, 0) || 1 : 1);
  if (s.op === "mean") for (const [k, v] of totals) totals.set(k, v / counts.get(k)!);
  if (!totals.size) return null;
  // Every value between the first and last group, so gaps (e.g. an empty layer) show as empty bars.
  const keys = [...totals.keys()].sort((a, c) => a - c);
  const all = keys[keys.length - 1] - keys[0] < 100 ? Array.from({ length: keys[keys.length - 1] - keys[0] + 1 }, (_, i) => keys[0] + i) : keys;
  const top = Math.max(...totals.values(), 0) || 1;
  return (
    <div class="card">
      <h3>{s.title} <span class="count">{fmt(sum)}{s.unit ? ` ${s.unit}` : ""}</span></h3>
      <div class="bars" role="table" aria-label={s.title}>
        {all.map((k) => {
          const v = totals.get(k) ?? 0;
          return (
            <div class="bar" role="row" title={`${s.groupBy} ${k}: ${fmt(v)}${s.unit ? ` ${s.unit}` : ""}`}>
              <span role="cell">{k}</span>
              <span class="track" role="cell"><span style={{ width: `${Math.max(0, (100 * v) / top)}%` }} /></span>
              <span role="cell">{v ? fmt(v) : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
