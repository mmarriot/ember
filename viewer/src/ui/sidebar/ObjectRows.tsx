// A side-panel tab's objects as rows: the event in one line over the collections (Headline), and a collection's
// largest objects, one row each with its columns (ObjectRows).
import { type DisplayLayer, kindName, unitOf } from "../../io/format";
import { filterMask, filters } from "../../model/custom/custom";
import { columnName, passes, topRows, whyHidden } from "../../model/event/objects";
import { plain } from "../../model/event/describe";
import {
  bundle,
  cuts,
  describe,
  event,
  layerKey,
  nameOf,
  numberOf,
  selection,
  sizeColumn,
  visible,
} from "../../model/store";
import { rowHover } from "../viewport/Labels";
import { jump } from "../../control/navigate";

/** A layer's rows that pass its cut and filter (model/event/objects.ts). */
export function passing(d: DisplayLayer) {
  const t = event.value?.tables[d.table];
  if (!t) return null;
  const min = d.cut ? (cuts.value[d.cut.group] ?? 0) : 0,
    keep = filterMask(t, filters.value[d.table]);
  return { t, min, keep, pass: passes(d, t, min, keep) };
}

/** How many rows pass. */
function countPassing(p: NonNullable<ReturnType<typeof passing>>) {
  let n = 0;
  for (let i = 0; i < p.t.n; i++) if (p.pass(i)) n++;
  return n;
}

/** The event in one line, from the ticked layers with a `list`: per kind, how many objects pass the cuts and filters
 *  ("Jets 4"), or a one-object table's value ("Puppi MET 42.2 GeV"). `note`: why a selected object is not counted. */
export function headline(layers: DisplayLayer[]): [string, string, string?][] {
  const parts = new Map<string, number | string>(),
    sel = selection.value,
    hidden = new Map<string, string>(); // a kind whose selected object its cut or filter leaves out: why
  for (const d of layers.filter((l) => l.list && visible.value[layerKey(l)])) {
    const p = passing(d);
    if (!p) continue;
    if (d.list!.headline === "value") {
      const c = d.list!.columns[0],
        col = p.t.columns[c];
      if (!col || !p.t.n) continue;
      const unit = unitOf(bundle.value!.header.tables[d.table]?.columns[c]?.doc);
      parts.set(d.label, `${plain(Number(col[0]))}${unit ? ` ${unit}` : ""}`);
      continue;
    }
    const name = kindName(d);
    parts.set(name, (Number(parts.get(name)) || 0) + countPassing(p));
    const why = sel?.table === d.table && sel.row < p.t.n ? whyHidden(d, p.t, p.min, p.keep, sel.row) : undefined;
    if (why)
      hidden.set(
        name,
        `${why === "filter" ? "" : `below the ${d.cut!.label ?? d.cut!.column} cut`}${why === "both" ? " and " : ""}${why === "cut" ? "" : "left out by the filter"}`,
      );
  }
  return [...parts].map(([label, value]) => [
    label,
    typeof value === "number" ? value.toLocaleString() : value,
    hidden.get(label),
  ]);
}

export function Headline({ layers }: { layers: DisplayLayer[] }) {
  const parts = headline(layers);
  return parts.length ? (
    <p class="headline">
      {parts.map(([label, value, note], i) => (
        <>
          {i > 0 && " · "}
          {label} <b>{value}</b>
          {note && <span class="muted"> (+1 selected, {note})</span>}
        </>
      ))}
    </p>
  ) : null;
}

/** A layer's largest objects, one row each with its columns; a click selects it, pointing at a row rings it in the
 *  view. */
export function ObjectRows({ d, list = d.list! }: { d: DisplayLayer; list?: NonNullable<DisplayLayer["list"]> }) {
  const p = passing(d),
    sel = selection.value;
  if (!p) return null;
  const cols = list.columns.filter((c) => c in p.t.columns);
  const rows = topRows(p.t, list.sort ?? sizeColumn(d.table, p.t), p.pass, list.max ?? 10);
  if (!rows.length) return null;
  const more = countPassing(p) - rows.length;
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
        {rows.map((r) => (
          <tr
            class={sel?.table === d.table && sel.row === r ? "selected" : undefined}
            onClick={() => jump({ table: d.table, row: r })}
            onMouseEnter={() => (rowHover.value = { table: d.table, row: r })}
            onMouseLeave={() => (rowHover.value = null)}
            title={`${nameOf({ table: d.table, row: r })}: select it (pointed at in the view)`}
          >
            {/* its name without the columns shown next to it (a jet: none, so its number, by pT as everywhere; a PF
                candidate: its type) */}
            <td>{describe(d.table, r, cols) || numberOf(d.table, r)}</td>
            {cols.map((c) => (
              <td>{plain(Number(p.t.columns[c][r]))}</td>
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
