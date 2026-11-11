// User-defined additions, remembered per profile in this browser: columns computed from expressions, row filters,
// which column colours each layer and the chosen preset. Columns are added to every event as it is
// shown (one loop per column).
import { effect, signal } from "@preact/signals";
import type { Column, DisplayLayer, EventData, Table } from "../io/bundle";
import { compile } from "./expr";

export interface CustomColumn { table: string; name: string; expr: string }
export const customColumns = signal<CustomColumn[]>([]); // in order: later ones may use earlier ones
/** Table -> expression; rows where it is 0 are hidden. "" marks a default filter the user removed. */
export const filters = signal<Record<string, string>>({});
export const colourBy = signal<Record<string, string>>({}); // display layer key -> column, or RELATION + relation
export const activePreset = signal(0); // index into the profile's presets
/** pid: candidates by particle type, a selection as its truth <-> reco pair (bundles with candidates); layers: each
 *  layer coloured on its own (the others). Set by the bundle (store.ts activeMode), not by the user. */
export type ColourMode = "pid" | "layers";
let defaultFilters: Record<string, string> = {}; // from the display hints (`filter`) of the open bundle

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

/** The values of a filter expression on `t` (0: hidden), or null without a usable one. */
export function filterMask(t: Table, expr: string | undefined): Float32Array | null {
  const r = expr ? evaluate(t, expr) : null;
  return r && "values" in r ? r.values : null;
}

export const setFilter = (table: string, expr: string) => (filters.value = { ...filters.value, [table]: expr });
export function removeFilter(table: string) {
  const { [table]: _, ...rest } = filters.value;
  filters.value = table in defaultFilters ? { ...rest, [table]: "" } : rest; // else the default would come back on load
}
/** The table's filter back to its default (none if it has none). */
export function resetFilter(rows: Record<string, string>, table: string) {
  if (table in defaultFilters) rows[table] = defaultFilters[table];
  else delete rows[table];
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

export const RELATION = "rel:";
/** The display hint with the user's colour choice, if any: a column (a value scale, replacing any categorical
 *  colouring), or RELATION + relation name (the colour of the related object, e.g. a trackster's truth particle). */
export function withColour(d: DisplayLayer, column: string | undefined): DisplayLayer {
  if (column?.startsWith(RELATION)) return { ...d, colourBy: { relation: column.slice(RELATION.length) } };
  return column ? { ...d, colour: column, colourBy: undefined, palette: d.palette ?? "heat" } : d;
}

export const customDoc = (table: string, column: string) => {
  const c = customColumns.value.find((x) => x.table === table && x.name === column);
  return c ? `custom: ${c.expr}` : undefined;
};

// Persistence. localStorage can be missing or throw (private windows, blocked storage): then nothing is remembered.
let storageKey = "";
/** The user's choices for a profile; `defaults` (table -> filter expression) apply where the user has set none. */
export function loadCustom(profile: string, defaults: Record<string, string>) {
  storageKey = "";
  let saved: Partial<{ columns: CustomColumn[]; filters: Record<string, string>; colourBy: Record<string, string>; preset: number }> = {};
  try { saved = JSON.parse(localStorage.getItem(`evd.custom.${profile}`) ?? "{}"); } catch { /* defaults */ }
  defaultFilters = defaults;
  customColumns.value = Array.isArray(saved.columns) ? saved.columns : [];
  filters.value = { ...defaults, ...(saved.filters ?? {}) };
  colourBy.value = saved.colourBy ?? {};
  activePreset.value = typeof saved.preset === "number" ? saved.preset : 0;
  storageKey = `evd.custom.${profile}`;
}
effect(() => {
  const data = JSON.stringify({ columns: customColumns.value, filters: filters.value, colourBy: colourBy.value, preset: activePreset.value });
  if (storageKey) try { localStorage.setItem(storageKey, data); } catch { /* not remembered */ }
});
