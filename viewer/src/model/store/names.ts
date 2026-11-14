// How tables, layers, objects and numbers are named in the page, from the open bundle's display hints. Plain
// functions: they read the signals when called, so a component that calls them re-renders when those change.
import { type DisplayLayer, kindName, type Table, unitOf } from "../../io/format";
import { bundle, event } from "./data";

/** The key of a display layer, unique in a bundle: "table:repr". Signals keyed per layer use it. */
export const layerKey = (d: Pick<DisplayLayer, "table" | "repr">) => `${d.table}:${d.repr}`;

/** The (first) display layer of a table. */
export const layerOf = (table: string) => bundle.value?.header.display.find((l) => l.table === table);

/** A layer's label with the reconstruction path that made it, if the profile names one: "CLUEstering (SoA)". */
export const layerName = (d: DisplayLayer) => `${d.label}${d.source ? ` (${d.source})` : ""}`;

/** Short name of a table's kind of object: its group for a layer with a kind ("Tracksters"), else its label. */
export const kindOf = (table: string) => {
  const d = layerOf(table);
  return d ? kindName(d) : table;
};

/** Name of a table for the UI: "Tracksters · CLUEstering (SoA)" for a layer with a kind, else its label. */
export const labelOf = (table: string) => {
  const d = layerOf(table);
  return !d ? table : d.kind ? `${d.group} · ${layerName(d)}` : d.label;
};

/** A table's kind, with its layer's name only where the kind has several collections ("PF clusters · ECAL"). */
export const stepName = (table: string) => {
  const all = bundle.value?.header.display.filter((l) => !l.alternative && kindOf(l.table) === kindOf(table)) ?? [];
  return new Set(all.map((l) => l.table)).size > 1 ? `${kindOf(table)} · ${layerOf(table)?.label}` : kindOf(table);
};

/** Whether a layer shows detector hits: drawn as cells, and not a background layer. */
export const isHitLayer = (d: DisplayLayer | undefined) => d?.repr === "cells" && !d.context;

/** The column that says how big an object of `table` is (e.g. its energy), to rank objects: its layer's cut column,
 *  else its colour column, else "energy"; undefined if the table has none of them. */
export const sizeColumn = (table: string, t: Table) => {
  const d = layerOf(table);
  return [d?.cut?.column, d?.colour, "energy"].find((c): c is string => !!c && c in t.columns);
};

/** Rows of `table`, largest first by its size column, if it has one. */
export function largestFirst(table: string, rows: number[]) {
  const t = event.value?.tables[table],
    c = t && sizeColumn(table, t),
    key = c ? t!.columns[c] : undefined;
  return key ? [...rows].sort((a, b) => Number(key[b]) - Number(key[a])) : rows;
}

/** A number in a few significant figures, for names, legends and charts. */
export const short = (v: number) => (Number.isInteger(v) || Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(3));

/** A value in full (3 decimals; exponent notation when very large or small), for tables of values. */
export const full = (v: number | bigint) =>
  typeof v === "bigint"
    ? v.toString()
    : Number.isInteger(v)
      ? v.toLocaleString()
      : Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 1e-3)
        ? v.toExponential(3)
        : v.toFixed(3);

/** A short name for one object, from its layer's `describe` hint (e.g. "π+ · 88.9 GeV"), or "" without one. `skip`:
 *  columns to leave out (those shown next to it anyway, e.g. in object rows). */
export function describe(table: string, row: number, skip: string[] = []): string {
  const b = bundle.value,
    t = event.value?.tables[table],
    hint = layerOf(table)?.describe;
  if (!b || !t || !hint || row >= t.n) return "";
  return hint.columns
    .filter((c) => c in t.columns && !skip.includes(c))
    .map((c) => {
      const v = Number(t.columns[c][row]),
        name = hint.names?.[c]?.[String(v)];
      if (name) return name;
      const unit = unitOf(b.header.tables[table]?.columns[c]?.doc);
      return `${short(v)}${unit ? ` ${unit}` : ""}`;
    })
    .join(" · ");
}
