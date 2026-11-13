// Event tab: event identity, run information and summary charts (where the bundle has them), provenance with every
// table of the event, and the custom columns no collection lists. (Each collection's count is on its row in its tab.)
import type { Summary } from "../io/bundle";
import { customColumns, evaluate, filters } from "../model/custom";
import { cutMin, cutValues } from "../model/cuts";
import { bundle, cuts, event, eventIndex, layerOf, loadMs, short } from "../model/store";
import { provenance } from "./Chooser";
import { Icon } from "./widgets";

export function EventInfo() {
  const b = bundle.value, ev = event.value, e = b?.events[eventIndex.value];
  if (!b || !ev || !e) return <p class="hint">No event loaded.</p>;
  const h = b.header, n = (table: string) => ev.tables[table]?.n ?? 0;
  const tables = Object.keys(ev.tables).filter(n).sort((a, c) => n(c) - n(a));
  return (
    <div>
      <section>
        <h3>Run {e.run} · Lumi section {e.lumi} · Event {e.event}</h3>
        <p class="hint">{eventIndex.value + 1} of {b.events.length} in the file · loaded in {loadMs.value.toFixed(0)} ms</p>
      </section>
      <RunInfo />
      {(h.summaries ?? []).map((s) => <Chart s={s} />)}
      <section>
        <h3>Source</h3>
        <table class="kv prov"><tbody>{provenance().map(([k, v]) => <tr><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
        <details>
          <summary>Tables in this event ({tables.length})</summary>
          <table class="kv stats mono"><tbody>
            {tables.map((name) => <tr title={h.tables[name]?.doc}><td>{name}</td><td>{n(name).toLocaleString()}</td></tr>)}
          </tbody></table>
        </details>
      </section>
      <OtherColumns />
    </div>
  );
}

/** Custom columns on tables that are not drawn (their collections' ⋯ list the others), e.g. saved with another data
 *  set of the same profile: still computed where the table exists, and removable here. */
function OtherColumns() {
  const h = bundle.value!.header, drawn = new Set(h.display.map((d) => d.table));
  const defs = customColumns.value.filter((c) => !drawn.has(c.table));
  if (!defs.length) return null;
  return (
    <section>
      <h3>Other custom columns</h3>
      {defs.map((c) => (
        <div class="defn" title={h.tables[c.table] ? undefined : "This data set has no such table"}>
          <span class="muted">{c.table}</span><code>{c.name} = {c.expr}</code>
          <button class="icon-button small" title="Remove column" onClick={() => (customColumns.value = customColumns.value.filter((x) => x !== c))}><Icon name="close" /></button>
        </div>
      ))}
    </section>
  );
}

/** What is known about the run of the shown event (from the bundle index), if anything. */
function RunInfo() {
  const b = bundle.value!, e = b.events[eventIndex.value], info = b.runInfo(e.run);
  if (!Object.keys(info).length) return null;
  const title = b.runTitle(e.run);
  return (
    <section>
      <h3>Run {e.run} {title && <span class="count">{title}</span>}</h3>
      <table class="kv stats"><tbody>
        {(b.header.runFields ?? Object.keys(info)).filter((k) => k in info).map((k) => <tr title={`${k}: ${info[k]}`}><td>{k}</td><td>{String(info[k])}</td></tr>)}
      </tbody></table>
    </section>
  );
}

/** A per-event chart from the profile's `summaries` (e.g. energy per layer): rows grouped by an integer column,
 *  counted, summed or averaged. Only rows that pass the layer's cut and filter count, so it matches the view. */
function Chart({ s }: { s: Summary }) {
  const t = event.value!.tables[s.table], d = layerOf(s.table);
  const group = t?.columns[s.groupBy], value = s.value ? t.columns[s.value] : undefined;
  if (!t?.n || !group || (s.value && !value)) return null;
  const passing = d ? cutValues(d, t, filters.value[s.table]) : undefined;
  const min = d ? cutMin(d, passing, cuts.value) : -Infinity;
  const where = s.where ? evaluate(t, s.where) : null;
  const totals = new Map<number, number>(), counts = new Map<number, number>();
  for (let i = 0; i < t.n; i++) {
    if (passing && passing[i] < min) continue;
    if (where && "values" in where && !where.values[i]) continue;
    const k = Number(group[i]);
    totals.set(k, (totals.get(k) ?? 0) + (value ? Number(value[i]) : 1));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (!totals.size) return null;
  // The header shows the total, or for "mean" the mean over all rows.
  const sum = [...totals.values()].reduce((a, v) => a + v, 0) / (s.op === "mean" ? [...counts.values()].reduce((a, v) => a + v, 0) : 1);
  if (s.op === "mean") for (const [k, v] of totals) totals.set(k, v / counts.get(k)!);
  // Every value between the first and last group, so gaps (e.g. an empty layer) show as empty bars.
  const keys = [...totals.keys()].sort((a, c) => a - c), lo = keys[0], hi = keys[keys.length - 1];
  const all = hi - lo < 100 ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : keys;
  const top = Math.max(...totals.values(), 0) || 1, unit = s.unit ? ` ${s.unit}` : "";
  return (
    <section>
      <h3>{s.title} <span class="count">{short(sum)}{unit}</span></h3>
      <div class="bars" role="table" aria-label={s.title}>
        {all.map((k) => {
          const v = totals.get(k) ?? 0;
          return (
            <div class="bar" role="row" title={`${s.groupBy} ${k}: ${short(v)}${unit}`}>
              <span role="cell">{k}</span>
              <span class="track" role="cell"><span style={{ width: `${Math.max(0, (100 * v) / top)}%` }} /></span>
              <span role="cell">{v ? short(v) : ""}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
