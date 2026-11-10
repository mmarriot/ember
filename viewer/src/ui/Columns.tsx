// Columns tab: custom columns, computed in the browser for every event, shown in the inspector, usable for colour
// and filters; and the expression form shared with the filters.
import { useState } from "preact/hooks";
import { customColumns, evaluate } from "../model/custom";
import { FUNCTION_NAMES } from "../model/expr";
import { bundle, event, full, labelOf } from "../model/store";
import { Icon } from "./widgets";

export function Columns() {
  const b = bundle.value;
  if (!b) return <p class="hint">No data loaded.</p>;
  const shown = [...new Set(b.header.display.map((d) => d.table))];
  const tables = [...shown, ...Object.keys(b.header.tables).filter((t) => !shown.includes(t))];
  const defs = customColumns.value;
  return (
    <div>
      <p class="hint">Define columns from existing ones. They appear in the inspector, can colour a layer (Layers tab) and can be used in filters (Cuts tab).</p>
      <div class="card">
        <h3>New column</h3>
        <ExprForm tables={tables} named action="Add column" placeholder="e.g. energy / sigmaNoise"
          submit={(table, expr, name) => (customColumns.value = [...defs, { table, name: name!, expr }])} />
      </div>
      {defs.length > 0 && (
        <div class="card">
          <h3>Your columns</h3>
          {defs.map((c, i) => (
            <div class="defn" title={b.header.tables[c.table] ? undefined : "This data set has no such table"}>
              <span class="muted">{labelOf(c.table)}</span><code>{c.name} = {c.expr}</code>
              <button class="icon-button small" title="Remove column" onClick={() => (customColumns.value = defs.filter((_, k) => k !== i))}><Icon name="close" /></button>
            </div>
          ))}
        </div>
      )}
      <details class="card">
        <summary>Expression syntax</summary>
        <p class="hint">Column names of the table, numbers, <code>pi</code>, operators <code>+ - * / % ^</code>, comparisons <code>&lt; &lt;= &gt; &gt;= == !=</code>
          (1 if true, 0 if false), <code>&amp;&amp; || !</code>, parentheses, and the functions {FUNCTION_NAMES.join(", ")}.</p>
      </details>
    </div>
  );
}

/** Table choice, optional name, expression with live feedback on the current event, and a submit button. */
export function ExprForm({ tables, named = false, action, placeholder, submit }: {
  tables: string[]; named?: boolean; action: string; placeholder: string; submit: (table: string, expr: string, name?: string) => void;
}) {
  const [table, setTable] = useState(tables[0] ?? ""), [name, setName] = useState(""), [expr, setExpr] = useState("");
  const t = event.value?.tables[table], columns = Object.keys(t?.columns ?? {});
  const nameError = !named ? "" : !name ? "Give it a name" : !/^[A-Za-z_]\w*$/.test(name) ? "Letters, digits and _ only" : columns.includes(name) ? "Name already used" : "";
  const result = t && expr.trim() ? evaluate(t, expr) : null;
  const ok = !!result && !("error" in result) && !nameError;
  const feedback = !result ? (t ? "" : "Not in this event") : "error" in result ? result.error : summary(result.values, result.boolean);
  return (
    <form class="exprform" onSubmit={(e) => { e.preventDefault(); if (ok) { submit(table, expr.trim(), name); setName(""); setExpr(""); } }}>
      <div class="row">
        <select value={table} onChange={(e) => setTable((e.target as HTMLSelectElement).value)} title="Table">
          {tables.map((x) => <option value={x}>{labelOf(x)}{labelOf(x) !== x ? ` (${x})` : ""}</option>)}
        </select>
        {named && <input class="name" placeholder="name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />}
      </div>
      <input class="expr" placeholder={placeholder} value={expr} spellcheck={false} onInput={(e) => setExpr((e.target as HTMLInputElement).value)} />
      <div class={`feedback ${result && "error" in result ? "bad" : ""}`}>{(expr && named && nameError) || feedback}</div>
      <details>
        <summary>Columns of this table ({columns.length})</summary>
        <div>{columns.map((c) => <button type="button" class="chip" onClick={() => setExpr((x) => (x && !/[\s(]$/.test(x) ? `${x} ${c}` : x + c))}>{c}</button>)}</div>
      </details>
      <button type="submit" class="primary" disabled={!ok}>{action}</button>
    </form>
  );
}

/** What an expression gives on the current event: how often it holds, or its range. */
function summary(v: Float32Array, boolean: boolean) {
  if (!v.length) return "No rows in this event";
  if (boolean) { let k = 0; for (const x of v) if (x) k++; return `True for ${k.toLocaleString()} of ${v.length.toLocaleString()} rows in this event`; }
  let lo = Infinity, hi = -Infinity, bad = 0;
  for (const x of v) if (Number.isFinite(x)) { lo = Math.min(lo, x); hi = Math.max(hi, x); } else bad++;
  return `${lo <= hi ? `${full(lo)} … ${full(hi)}` : "no finite values"} in this event${bad ? ` · ${bad} not finite` : ""}`;
}
