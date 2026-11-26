// The card's physics block (docs/viewer.md): a reco object's main numbers, what it is made of, and for MET the angle to
// the jets. Its profile's groups of columns (`inspectGroups`: b-tags, e/γ ID) and what holds it or shares its parts
// are under the card's More (PhysicsMore).
import { kindName } from "../../io/format";
import { plain } from "../../model/event/describe";
import { constituents, deltaPhi, memberships } from "../../model/event/physics";
import { bundle, drawnLayers, event, layerKey, layerOf, nameOf, stepName } from "../../model/store";
import { ranked } from "../../control/navigate";
import { chip, ObjChip } from "./chips";
import { Fractions, keyColumns, Numbers, Rows } from "./Properties";
import { Shares } from "./Relations";

export function Physics({ table, row }: { table: string; row: number }) {
  const b = bundle.value,
    ev = event.value,
    d = layerOf(table),
    t = ev?.tables[table];
  if (!b || !ev || !d || !t || d.truth) return null;
  const key = keyColumns(table, t).filter((c) => !d.describe?.columns.includes(c)), // the card's name gives those
    parts = constituents(ev, b.header, table, row).filter((p) => p.types.length);
  return (
    <section class="physics" aria-label="Reconstruction">
      <Numbers name={table} table={t} row={row} columns={key} />
      {d.fractions && <Fractions fractions={d.fractions} table={t} row={row} />}
      {parts.map((p) => (
        <p class="physline">
          <span class="rkind">{stepName(p.table)}</span> {p.n}
          <span class="muted">
            {": "}
            {p.types.map(([name, n]) => `${name} ${n}`).join(" · ")}
          </span>
          {p.kept !== null && p.kept < p.n && (
            <span title={`Their layer's filter keeps the rows where ${p.filter} (e.g. PUPPI's weight above 0)`}>
              {" "}
              · <b>{p.kept}</b> kept by <code>{p.filter}</code>
            </span>
          )}
        </p>
      ))}
      <Met table={table} row={row} />
    </section>
  );
}

/** Under the card's More: a reco object's groups of columns (its profile's `inspectGroups`), what holds it (with the
 *  weights, e.g. PUPPI's) and the objects with exactly its parts. */
export function PhysicsMore({ table, row }: { table: string; row: number }) {
  const b = bundle.value,
    ev = event.value,
    d = layerOf(table),
    t = ev?.tables[table];
  if (!b || !ev || !d || !t || d.truth) return null;
  const groups = (d.inspectGroups ?? [])
      .map((g) => ({ ...g, columns: g.columns.filter((c) => c in t.columns) }))
      .filter((g) => g.columns.length),
    holders = memberships(ev, b.header, table, row).filter((h) => h.weight !== undefined);
  return (
    <>
      {groups.map((g) => (
        <div class="pgroup">
          <h5>{g.name}</h5>
          <Rows name={table} table={t} row={row} columns={g.columns} />
        </div>
      ))}
      {holders.length > 0 && (
        <p class="physline">
          {holders.slice(0, 4).map((h, i) => (
            <>
              {i > 0 && " · "}
              in <ObjChip table={h.table} row={h.row} text={nameOf(h)} />
              <span class="muted">
                {" "}
                {h.weightName} {plain(h.weight!)}
              </span>
            </>
          ))}
        </p>
      )}
      <Shares table={table} row={row} />
    </>
  );
}

/** A one-object kind with an azimuth (MET): the other collections of its kind, and the angle to the leading jets of
 *  the drawn jet layers. */
function Met({ table, row }: { table: string; row: number }) {
  const b = bundle.value!,
    ev = event.value!,
    d = layerOf(table)!,
    phi = ev.tables[table]?.columns.phi;
  if (d.list?.headline !== "value" || !phi) return null;
  const others = b.header.display.filter(
    (l) => l.table !== table && kindName(l) === kindName(d) && ev.tables[l.table]?.n,
  );
  const drawn = drawnLayers.value,
    jets = b.header.display.filter((l) => l.kind === "jet" && drawn[layerKey(l)]);
  const at = Number(phi[row]);
  return (
    <>
      {others.length > 0 && (
        <p class="physline">
          other: {others.map((o) => chip(o.table, 0))}
          {others.map((o) => {
            const p = ev.tables[o.table].columns.phi;
            return p ? <span class="muted"> Δφ {plain(deltaPhi(at, Number(p[0])))}</span> : null;
          })}
        </p>
      )}
      {jets.map((j) => {
        const rows = ranked(j, 4),
          p = ev.tables[j.table]?.columns.phi;
        if (!rows.length || !p) return null;
        return (
          <p class="physline">
            <span class="rkind">Δφ to {j.label}</span>{" "}
            {rows.map((r, i) => (
              <span>
                {i > 0 && " · "}
                <ObjChip table={j.table} row={r} text={nameOf({ table: j.table, row: r }, ["eta"])} />{" "}
                <b>{plain(deltaPhi(at, Number(p[r])))}</b>
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}
