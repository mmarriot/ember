// An expression on one table (behind a collection's ⋯), with live feedback on the current event: as a filter (rows
// where it is 0 are hidden, on top of the cuts) or as a new column, computed in the browser for every event, shown in
// the inspector and usable for colour and filters.
import { useState } from "preact/hooks";
import { customColumns, evaluate, setFilter } from "../model/custom";
import { FUNCTION_NAMES } from "../model/expr";
import { event, full } from "../model/store";

export const SYNTAX = `Column names of the table, numbers, pi, + - * / % ^, comparisons < <= > >= == != (1 if true, 0 if false), && || !, parentheses, and ${FUNCTION_NAMES.join(", ")}`;

export function ExprForm({ table }: { table: string }) {
  const [name, setName] = useState(""),
    [expr, setExpr] = useState("");
  const t = event.value?.tables[table],
    columns = Object.keys(t?.columns ?? {});
  const nameError = !name
    ? ""
    : !/^[A-Za-z_]\w*$/.test(name)
      ? "Letters, digits and _ only"
      : columns.includes(name)
        ? "Name already used"
        : "";
  const result = t && expr.trim() ? evaluate(t, expr) : null;
  const ok = !!result && !("error" in result);
  const feedback = !result
    ? t
      ? ""
      : "Not in this event"
    : "error" in result
      ? result.error
      : summary(result.values, result.boolean);
  const done = () => {
    setName("");
    setExpr("");
  };
  const named = ok && !!name && !nameError;
  const addColumn = () => {
    if (named) {
      customColumns.value = [...customColumns.value, { table, name, expr: expr.trim() }];
      done();
    }
  };
  // Enter in the expression filters (the submit button); Enter in the name adds the column.
  return (
    <form
      class="exprform"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) {
          setFilter(table, expr.trim());
          done();
        }
      }}
    >
      <input
        class="expr"
        placeholder="e.g. energy / sigmaNoise > 5"
        title={SYNTAX}
        value={expr}
        spellcheck={false}
        onInput={(e) => setExpr((e.target as HTMLInputElement).value)}
      />
      <div class={`feedback ${result && "error" in result ? "bad" : ""}`}>{nameError || feedback}</div>
      <div class="row">
        <button type="submit" class="primary" disabled={!ok} title="Show only the rows where it holds">
          Filter
        </button>
        <input
          class="name"
          placeholder="column name"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addColumn();
            }
          }}
        />
        <button
          type="button"
          disabled={!named}
          title="Add it to this table as a column, for every event"
          onClick={addColumn}
        >
          Add column
        </button>
      </div>
      <details>
        <summary>Columns of this table ({columns.length})</summary>
        <div>
          {columns.map((c) => (
            <button
              type="button"
              class="chip"
              onClick={() => setExpr((x) => (x && !/[\s(]$/.test(x) ? `${x} ${c}` : x + c))}
            >
              {c}
            </button>
          ))}
        </div>
      </details>
    </form>
  );
}

/** What an expression gives on the current event: how often it holds, or its range. */
function summary(v: Float32Array, boolean: boolean) {
  if (!v.length) return "No rows in this event";
  if (boolean) {
    let k = 0;
    for (const x of v) if (x) k++;
    return `True for ${k.toLocaleString()} of ${v.length.toLocaleString()} rows in this event`;
  }
  let lo = Infinity,
    hi = -Infinity,
    bad = 0;
  for (const x of v)
    if (Number.isFinite(x)) {
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    } else bad++;
  return `${lo <= hi ? `${full(lo)} … ${full(hi)}` : "no finite values"} in this event${bad ? ` · ${bad} not finite` : ""}`;
}
