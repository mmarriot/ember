// How tables, layers, objects and numbers are named in the page, from the open bundle's display hints. Plain
// functions: they read the signals when called, so a component that calls them re-renders when those change.
import { computed } from "@preact/signals";
import { type DisplayLayer, kindName, type Table } from "../../io/format";
import { cardName, chipName, describeRow, labelName, objectName } from "../event/describe";
import { ranks } from "../event/objects";
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
  const all = bundle.value?.header.display.filter((l) => kindOf(l.table) === kindOf(table)) ?? [];
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

/** The column an object's number ranks by, the one its side-panel rows are sorted by (so a list runs 1, 2, 3): its
 *  layer's list sort, else its size column, else pT. Undefined (numbered by row) for hits and truth particles, whose
 *  numbers no list shows and would cost a sort of up to 10⁵ rows on a hover, and for a sort column the table lacks
 *  (CMSSW's leading primary vertex stays 1). */
export function rankColumn(d: DisplayLayer, t: Table) {
  if (isHitLayer(d) || d.truth) return undefined;
  return d.list?.sort ?? sizeColumn(d.table, t) ?? ("pt" in t.columns ? "pt" : undefined);
}

/** Per event, each table's ranks by its rank column (null: none), sorted when first asked for. */
const rankCache = computed(() => {
  bundle.value;
  event.value;
  return new Map<string, Uint32Array | null>();
});

/** An object's number in its name, from 1: its rank by its rank column, else its row + 1. Addresses keep the row. */
export function numberOf(table: string, row: number) {
  const t = event.value?.tables[table],
    d = layerOf(table),
    cache = rankCache.value;
  if (!t || !d || row >= t.n) return row + 1;
  let r = cache.get(table);
  if (r === undefined) {
    const c = rankColumn(d, t);
    r = c && c in t.columns ? ranks(t.columns[c], t.n) : null;
    cache.set(table, r);
  }
  return r ? r[row] : row + 1;
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

/** A truth particle's name (docs/truth.md "Words"): by its pT and η ("μ⁺ · pT 96.6 · η 1.11"); with `energy`, next to
 *  a calorimeter object, by its energy ("μ⁺ · E 162 GeV"). Its `describe` name without pT and η columns. */
export function truthText(table: string, row: number, energy = false): string {
  const t = event.value?.tables[table],
    pdg = t?.columns.pdgId,
    pt = t?.columns.pt,
    eta = t?.columns.eta,
    e = t?.columns.energy;
  if (!t || row >= t.n || !pdg || !pt || !eta) return describe(table, row);
  const id = String(pdg[row]),
    name = layerOf(table)?.describe?.names?.pdgId?.[id] ?? `pdgId ${id}`;
  // A beam particle (pT 0, η "infinite" by the ROOT convention) is named by its energy too.
  return e && (energy || !(Number(pt[row]) > 1e-6) || Math.abs(Number(eta[row])) > 20)
    ? `${name} · E ${short(Number(e[row]))} GeV`
    : `${name} · pT ${short(Number(pt[row]))} · η ${short(Number(eta[row]))}`;
}

/** A short name for one object's values (event/describe.ts describeRow): "π+ · E 88.9 GeV". `skip`: columns to leave
 *  out. */
export function describe(table: string, row: number, skip: string[] = []): string {
  const b = bundle.value;
  return b ? describeRow(b.header, layerOf(table), event.value?.tables[table], row, skip) : "";
}

/** An object's one name (event/describe.ts objectName): "Jet 1 · AK4 · pT 99.6 GeV". A table without a layer: its name
 *  and number. */
export function nameOf(ref: { table: string; row: number }, skip: string[] = [], cmssw = false) {
  const b = bundle.value,
    d = layerOf(ref.table);
  return b && d
    ? objectName(b.header, d, numberOf(ref.table, ref.row), describe(ref.table, ref.row, skip), cmssw)
    : `${ref.table} ${ref.row + 1}`;
}

/** An object's label in the view (event/describe.ts labelName): "Jet 1 · pT 46 GeV". */
export function labelText(ref: { table: string; row: number }, skip: string[], labelled: DisplayLayer[]) {
  const b = bundle.value,
    d = layerOf(ref.table);
  return b && d
    ? labelName(b.header, d, numberOf(ref.table, ref.row), describe(ref.table, ref.row, skip), labelled)
    : `${ref.table} ${ref.row + 1}`;
}

/** The card's header (event/describe.ts cardName): [name with its values, its collection]. */
export function cardNameOf(ref: { table: string; row: number }): [string, string] {
  const b = bundle.value,
    d = layerOf(ref.table);
  return b && d
    ? cardName(b.header, d, numberOf(ref.table, ref.row), describe(ref.table, ref.row))
    : [`${ref.table} ${ref.row + 1}`, ""];
}

/** An object's name in a list of its kind (event/describe.ts chipName): "AK4 CHS · pT 52.8 GeV". */
export function chipText(table: string, row: number) {
  const b = bundle.value,
    d = layerOf(table);
  return b && d ? chipName(b.header, d, numberOf(table, row), describe(table, row)) : `${table} ${row + 1}`;
}
