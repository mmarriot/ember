// A side-panel tab's objects as rows: the event in one line over the collections (Headline), and a collection's
// largest objects, one row each with its columns (ObjectRows). A click on a row selects the object; pointing at one
// rings it in the view.
import { type DisplayLayer, kindName, unitOf } from "../io/format";
import { filterMask, filters } from "../model/custom";
import { columnName, passes, topRows } from "../model/objects";
import {
  bundle,
  cuts,
  describe,
  event,
  labelOf,
  layerKey,
  selection,
  short,
  sizeColumn,
  visible,
} from "../model/store";
import { rowHover } from "./Labels";
import { jump } from "../control/navigate";

/** A layer's rows that pass its cut and filter (model/objects.ts). */
export function passing(d: DisplayLayer) {
  const t = event.value?.tables[d.table];
  if (!t) return null;
  return { t, pass: passes(d, t, d.cut ? (cuts.value[d.cut.group] ?? 0) : 0, filterMask(t, filters.value[d.table])) };
}

/** The event in one line, from the ticked layers with object rows (`list`): how many objects of each kind pass the cuts
 *  and filters ("Jets 4", the layers of a kind summed, e.g. barrel and endcap electrons), or the value of a one-object
 *  table ("Puppi MET 42.2 GeV"). As [name, value] pairs. */
export function headline(layers: DisplayLayer[]): [string, string][] {
  const parts = new Map<string, number | string>();
  for (const d of layers.filter((l) => l.list && visible.value[layerKey(l)])) {
    const p = passing(d);
    if (!p) continue;
    if (d.list!.headline === "value") {
      const c = d.list!.columns[0],
        col = p.t.columns[c];
      if (!col || !p.t.n) continue;
      const unit = unitOf(bundle.value!.header.tables[d.table]?.columns[c]?.doc);
      parts.set(d.label, `${short(Number(col[0]))}${unit ? ` ${unit}` : ""}`);
      continue;
    }
    let n = 0;
    for (let i = 0; i < p.t.n; i++) if (p.pass(i)) n++;
    const name = kindName(d);
    parts.set(name, (Number(parts.get(name)) || 0) + n);
  }
  return [...parts].map(([label, value]) => [label, typeof value === "number" ? value.toLocaleString() : value]);
}

export function Headline({ layers }: { layers: DisplayLayer[] }) {
  const parts = headline(layers);
  return parts.length ? (
    <p class="headline">
      {parts.map(([label, value], i) => (
        <>
          {i > 0 && " · "}
          {label} <b>{value}</b>
        </>
      ))}
    </p>
  ) : null;
}

/** The largest objects of a layer with a `list` hint, one row each with its columns; a click selects (and frames) it,
 *  the pointer over a row rings the object in the view. */
export function ObjectRows({ d, list = d.list! }: { d: DisplayLayer; list?: NonNullable<DisplayLayer["list"]> }) {
  const p = passing(d),
    sel = selection.value;
  if (!p) return null;
  const cols = list.columns.filter((c) => c in p.t.columns);
  const rows = topRows(p.t, list.sort ?? sizeColumn(d.table, p.t), p.pass, list.max ?? 10);
  if (!rows.length) return null;
  const more = (() => {
    let n = 0;
    for (let i = 0; i < p.t.n; i++) if (p.pass(i)) n++;
    return n - rows.length;
  })();
  return (
    <table class="objects">
      <thead>
        <tr>
          <th />
          {cols.map((c) => (
            <th title={bundle.value!.header.tables[d.table]?.columns[c]?.doc}>{columnName(c)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, k) => (
          <tr
            class={sel?.table === d.table && sel.row === r ? "selected" : undefined}
            onClick={() => jump({ table: d.table, row: r })}
            onMouseEnter={() => (rowHover.value = { table: d.table, row: r })}
            onMouseLeave={() => (rowHover.value = null)}
            title={`${labelOf(d.table)} #${r}: select it (pointed at in the view)`}
          >
            {/* its name without the columns shown next to it (a jet: none, so its rank; a PF candidate: its type) */}
            <td>{describe(d.table, r, cols) || `${k + 1}`}</td>
            {cols.map((c) => (
              <td>{short(Number(p.t.columns[c][r]))}</td>
            ))}
          </tr>
        ))}
        {more > 0 && (
          <tr class="more">
            <td colSpan={cols.length + 1}>… and {more.toLocaleString()} more</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
