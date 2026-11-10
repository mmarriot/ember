// Floating card for the selected object: summary, all columns with documentation, related objects.
import { colourBy, customColumns, customDoc } from "../model/custom";
import { bundle, event, highlight, labelOf, layerKey, selection } from "../model/store";
import { engine } from "./Viewport";
import { Icon, Tabs } from "./widgets";

const fmt = (v: number | bigint) =>
  typeof v === "bigint" ? v.toString() : Number.isInteger(v) ? v.toLocaleString() : Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(3) : v.toFixed(3);
const unitOf = (doc = "") => doc.match(/\[([^\]]+)\]/)?.[1] ?? "";

export function Inspector() {
  const b = bundle.value, ev = event.value, sel = selection.value, hl = highlight.value;
  if (!b || !ev || !sel || !ev.tables[sel.table]) return null;
  const info = b.header.tables[sel.table], table = ev.tables[sel.table];
  const d = b.header.display.find((l) => l.table === sel.table);
  const custom = customColumns.value.filter((c) => c.table === sel.table).map((c) => c.name);
  const colour = d ? colourBy.value[layerKey(d)] ?? d.colour : undefined;
  const category = d && typeof d.colourBy === "object" && "category" in d.colourBy ? d.colourBy.category : undefined;
  const key = [...new Set([category, colour, ...(d?.position ?? []), ...Object.keys(table.columns).filter((c) => /(energy|mips)$/i.test(c)), ...custom])]
    .filter((c): c is string => !!c && c in table.columns);
  const doc = (c: string) => info.columns[c]?.doc ?? customDoc(sel.table, c);
  const rows = (cols: string[]) => (
    <table class="kv"><tbody>
      {cols.map((c) => (
        <tr title={doc(c)}><td>{custom.includes(c) ? <i>{c}</i> : c}</td><td>{fmt(table.columns[c][sel.row])}</td><td class="unit">{unitOf(info.columns[c]?.doc)}</td></tr>
      ))}
    </tbody></table>
  );
  const related = [...(hl ?? [])].filter(([t]) => t !== sel.table);

  return (
    <div class="inspector" role="dialog" aria-label="Selected object">
      <header>
        <div>
          <div class="kind">{labelOf(sel.table)}</div>
          <h2>#{sel.row}</h2>
        </div>
        <div class="actions">
          <button class="icon-button" title="Zoom to it and its related objects (F)" onClick={() => hl && engine?.frame(hl, true)}><Icon name="focus" /></button>
          <button class="icon-button" title="Close (Esc)" onClick={() => (selection.value = null)}><Icon name="close" /></button>
        </div>
      </header>
      <p class="hint">{info.doc}</p>
      <Tabs tabs={[
        ["Summary", () => rows(key)],
        [`Columns · ${Object.keys(table.columns).length}`, () => rows(Object.keys(table.columns))],
        [`Related · ${related.reduce((s, [, r]) => s + r.size, 0)}`, () => related.length ? (
          <div>{related.map(([t, set]) => (
            <div class="related">
              <h3>{labelOf(t)} <span class="count">{set.size}</span></h3>
              <div>{[...set].slice(0, 30).map((r) => <button class="chip" onClick={() => (selection.value = { table: t, row: r })}>{r}</button>)}{set.size > 30 && " …"}</div>
            </div>
          ))}</div>
        ) : <p class="hint">Nothing related in this file.</p>],
      ]} />
    </div>
  );
}
