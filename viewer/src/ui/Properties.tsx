// An object's columns in the selection's card (Card.tsx): its main ones, then all of them folded, and for a reco
// object with energy fractions (e.g. a jet) those as one bar.
import type { Table } from "../io/format";
import { colourBy, customColumns, customDoc } from "../model/custom";
import { cellText, isCopied, isIndex } from "../model/describe";
import { bundle, layerKey, layerOf, sizeColumn } from "../model/store";

/** The summary's columns of an object: its layer's `inspect` columns (e.g. a jet's pT, η, φ), else what colours, places
 *  and sizes it; then its custom columns. Not raw indices, nor columns copied or derived from others (a PV's position
 *  copied into a jet, px from pT and φ): those are under "All columns". */
export function keyColumns(name: string, table: Table) {
  const h = bundle.value!.header,
    d = layerOf(name),
    custom = customColumns.value.filter((c) => c.table === name).map((c) => c.name);
  const colour = d ? (colourBy.value[layerKey(d)] ?? d.colour) : undefined;
  const category = d && typeof d.colourBy === "object" && "category" in d.colourBy ? d.colourBy.category : undefined;
  return [
    ...new Set([...(d?.inspect ?? [category, colour, ...(d?.position ?? []), sizeColumn(name, table)]), ...custom]),
  ].filter((c): c is string => !!c && c in table.columns && !isIndex(h, name, c) && !isCopied(h, name, c));
}
/** Columns of one row as a table of name, value, unit: units scaled to the value (µm, MeV), a sentinel as words ("no
 *  time"), a value with a name by it (model/describe.ts cellText). */
export function Rows({ name, table, row, columns }: { name: string; table: Table; row: number; columns: string[] }) {
  const h = bundle.value!.header,
    info = h.tables[name],
    d = layerOf(name),
    custom = customColumns.value.filter((c) => c.table === name).map((c) => c.name);
  return (
    <table class="kv">
      <tbody>
        {columns.map((c) => {
          const [value, unit] = cellText(h, d, name, table, c, row);
          return (
            <tr title={info.columns[c]?.doc ?? customDoc(name, c)}>
              <td>{custom.includes(c) ? <i>{c}</i> : c}</td>
              <td>{value}</td>
              <td class="unit">{unit}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** All its columns, folded (its key columns are in the physics block, Physics.tsx; a truth object's are here). */
export function Properties({ table, name, row }: { table: Table; name: string; row: number }) {
  const truth = !!layerOf(name)?.truth,
    n = Object.keys(table.columns).length;
  return (
    <section class="props">
      {truth && <Rows name={name} table={table} row={row} columns={keyColumns(name, table)} />}
      <details class="allcolumns">
        <summary>All {n} columns</summary>
        <Rows name={name} table={table} row={row} columns={Object.keys(table.columns)} />
      </details>
    </section>
  );
}
/** A reco object's energy fractions (layer hint `fractions`, e.g. a jet's charged and neutral hadrons, photons...) as
 *  one bar, in a neutral ramp (a reconstruction quantity, not a colour of the views), with the shares named under it. */
export function Fractions({ fractions, table, row }: { fractions: Record<string, string>; table: Table; row: number }) {
  const parts = Object.entries(fractions)
    .filter(([c]) => c in table.columns)
    .map(([c, name]) => [name, Number(table.columns[c][row])] as const)
    .filter(([, v]) => v >= 0.005);
  if (!parts.length) return null;
  const shade = (i: number) => `hsl(210, 8%, ${72 - (44 * i) / Math.max(1, parts.length - 1)}%)`;
  return (
    <div class="fractions" title="Energy fractions from the reconstruction (not truth)">
      <div class="fbar">
        {parts.map(([name, v], i) => (
          <span style={{ width: `${100 * v}%`, background: shade(i) }} title={`${name} ${(100 * v).toFixed(0)}%`} />
        ))}
      </div>
      <div class="flegend">
        <span class="badge reco">reco</span> energy:
        {parts.map(([name, v], i) => (
          <span>
            <i style={{ background: shade(i) }} />
            {name} {(100 * v).toFixed(0)}%
          </span>
        ))}
      </div>
    </div>
  );
}
