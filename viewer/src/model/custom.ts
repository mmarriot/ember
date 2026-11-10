// User-defined additions, remembered per profile in this browser: columns computed from expressions, row filters,
// and which column colours each layer. Columns are added to every event as it is shown (one loop per column).
import { effect, signal } from "@preact/signals";
import type { Column, DisplayLayer, EventData, Table } from "../io/bundle";
import { compile } from "./expr";

export interface CustomColumn { table: string; name: string; expr: string }
export const customColumns = signal<CustomColumn[]>([]); // in order: later ones may use earlier ones
export const filters = signal<Record<string, string>>({}); // table -> expression; rows where it is 0 are hidden
export const colourBy = signal<Record<string, string>>({}); // display layer key -> column

const numeric = (c: Column): ArrayLike<number> =>
  c instanceof BigInt64Array || c instanceof BigUint64Array ? Float64Array.from(c as ArrayLike<bigint>, Number) : (c as ArrayLike<number>);

/** Values of `expr` for every row of `t`, or the reason it cannot be computed. */
export function evaluate(t: Table, expr: string): { values: Float32Array; boolean: boolean } | { error: string } {
  try {
    const c = compile(expr, Object.keys(t.columns));
    return { values: c.run(c.columns.map((k) => numeric(t.columns[k])), t.n), boolean: c.boolean };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** The event with the custom columns added (tables without any are shared, not copied). */
export function withCustomColumns(ev: EventData, defs: CustomColumn[]): EventData {
  if (!defs.length) return ev;
  const tables = { ...ev.tables };
  for (const { table, name, expr } of defs) {
    const t = tables[table];
    const r = t && !(name in t.columns) ? evaluate(t, expr) : null;
    if (r && "values" in r) tables[table] = { n: t.n, columns: { ...t.columns, [name]: r.values } };
  }
  return { ...ev, tables };
}

/** The display hint with the user's colour column, if one is chosen (replacing any categorical colouring). */
export function withColour(d: DisplayLayer, column: string | undefined): DisplayLayer {
  return column ? { ...d, colour: column, colourBy: undefined, palette: d.palette ?? "heat" } : d;
}

export const customDoc = (table: string, column: string) => {
  const c = customColumns.value.find((x) => x.table === table && x.name === column);
  return c ? `custom: ${c.expr}` : undefined;
};

// Persistence. localStorage can be missing or throw (private windows, blocked storage): then nothing is remembered.
let storageKey = "";
export function loadCustom(profile: string) {
  storageKey = "";
  let saved: Partial<{ columns: CustomColumn[]; filters: Record<string, string>; colourBy: Record<string, string> }> = {};
  try { saved = JSON.parse(localStorage.getItem(`evd.custom.${profile}`) ?? "{}"); } catch { /* defaults */ }
  customColumns.value = Array.isArray(saved.columns) ? saved.columns : [];
  filters.value = saved.filters ?? {};
  colourBy.value = saved.colourBy ?? {};
  storageKey = `evd.custom.${profile}`;
}
effect(() => {
  const data = JSON.stringify({ columns: customColumns.value, filters: filters.value, colourBy: colourBy.value });
  if (storageKey) try { localStorage.setItem(storageKey, data); } catch { /* not remembered */ }
});
