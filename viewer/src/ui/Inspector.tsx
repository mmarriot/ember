// Floating card for the selected object: summary, all columns with documentation, related objects.
import { colourBy, customColumns, customDoc } from "../model/custom";
import { unitOf } from "../io/bundle";
import { bundle, describe, event, full, highlight, isHitLayer, labelOf, layerKey, layerOf, relatives, selection, sizeColumn, visible } from "../model/store";
import { bestFirst, type Related } from "../model/relations";
import { engine } from "./Viewport";
import { jump } from "./navigate";
import { Icon, Tabs } from "./widgets";

const weightsText = (w: Record<string, number>) => Object.entries(w).map(([k, v]) => `${k} ${Math.abs(v) < 5e-4 ? "0" : full(v)}`).join(" · ");

export function Inspector() {
  const b = bundle.value, ev = event.value, sel = selection.value, hl = highlight.value;
  if (!b || !ev || !sel || !ev.tables[sel.table]) return null;
  const info = b.header.tables[sel.table], table = ev.tables[sel.table];
  const d = layerOf(sel.table), truth = isTruth(sel.table), name = describe(sel.table, sel.row);
  const custom = customColumns.value.filter((c) => c.table === sel.table).map((c) => c.name);
  const colour = d ? colourBy.value[layerKey(d)] ?? d.colour : undefined;
  const category = d && typeof d.colourBy === "object" && "category" in d.colourBy ? d.colourBy.category : undefined;
  const key = [...new Set([category, colour, ...(d?.position ?? []), sizeColumn(sel.table, table), ...custom])]
    .filter((c): c is string => !!c && c in table.columns);
  const doc = (c: string) => info.columns[c]?.doc ?? customDoc(sel.table, c);
  const rows = (cols: string[]) => (
    <table class="kv"><tbody>
      {cols.map((c) => (
        <tr title={doc(c)}><td>{custom.includes(c) ? <i>{c}</i> : c}</td><td>{full(table.columns[c][sel.row])}</td><td class="unit">{unitOf(info.columns[c]?.doc)}</td></tr>
      ))}
    </tbody></table>
  );
  const parts = relatives.value;
  const without = (r: Related | undefined) => [...(r ?? [])].map(([t, set]) => [t, t === sel.table ? new Set([...set].filter((x) => x !== sel.row)) : set] as const).filter(([, set]) => set.size);
  const linked = without(parts?.linked);
  const sections: [string, string, (readonly [string, Set<number>])[]][] = [
    ["Made of", "what it is built from; highlighted in the view", without(parts?.madeOf)],
    ["Part of", "the objects that contain it (not highlighted, so they do not cover it)", without(parts?.partOf)],
    [truth ? "Reconstructed as" : linked.every(([t]) => isTruth(t)) ? "MC truth" : "Linked", "linked by an association (e.g. reco <-> truth); highlighted", linked],
  ];
  const nRelated = sections.reduce((s, [, , g]) => s + g.reduce((k, [, set]) => k + set.size, 0), 0);
  const matches = associations(sel.table, sel.row);
  const truthMatch = truth ? undefined : matches.find((m) => isTruth(m.table)), best = truthMatch?.rows[0];
  const content = !truth && parts ? truthInHits(parts.madeOf) : null;
  const chip = (t: string, r: number) => {
    const text = describe(t, r);
    return <button class="chip" title={text ? `#${r}` : undefined} onClick={() => jump({ table: t, row: r })}>{text || r}</button>;
  };

  return (
    <div class="inspector" role="dialog" aria-label="Selected object">
      <header>
        <div>
          <div class={truth ? "kind truth" : "kind"}>{labelOf(sel.table)}{truth && " (simulation)"}</div>
          <h2>#{sel.row}{name && <span class="describe"> · {name}</span>}</h2>
        </div>
        <div class="actions">
          <button class="icon-button" title="Zoom to it and its related objects (F)" onClick={() => hl && engine?.frame(hl, true)}><Icon name="focus" /></button>
          <button class="icon-button" title="Close (Esc)" onClick={() => (selection.value = null)}><Icon name="close" /></button>
        </div>
      </header>
      <p class="hint">{info.doc}</p>
      <Tabs tabs={[
        ["Summary", () => (
          <div>
            {best && <p class="truthline"><span class="badge truth">MC truth</span> best match {chip(truthMatch!.table, best.row)}
              <span class="muted">{weightsText(best.weights)}</span></p>}
            {content && content.particles.length > 0 && (
              <div class="truthcontent" title={`Each particle's ${content.weight} in this object's hits, summed over the hit layers shown`}>
                <p class="truthline"><span class="badge truth">MC truth</span> who made its hits (share of {content.weight}):</p>
                <ul class="matches">{content.particles.slice(0, 5).map(([p, e]) => (
                  <li>{chip(content.table, p)}<span class="muted">{(100 * e / content.total).toFixed(0)}%</span></li>
                ))}</ul>
                {content.particles.length > 5 && <p class="hint">… and {content.particles.length - 5} more particles</p>}
              </div>
            )}
            {rows(key)}
          </div>
        )],
        [`Columns · ${Object.keys(table.columns).length}`, () => rows(Object.keys(table.columns))],
        [`Related · ${nRelated}`, () => nRelated ? (
          <div>{sections.filter(([, , groups]) => groups.length).map(([title, hint, groups]) => (
            <section class="relsection">
              <h4 title={hint}>{title}</h4>
              {groups.map(([t, set]) => (
                <div class="related">
                  <h3 class={drawn(t) ? undefined : "muted"} title={drawn(t) ? undefined : "this layer is hidden (Layers tab)"}>{labelOf(t)} <span class="count">{set.size}</span>{!drawn(t) && " · hidden layer"}</h3>
                  <div>{[...set].slice(0, 30).map((r) => chip(t, r))}{set.size > 30 && " …"}</div>
                </div>
              ))}
            </section>
          ))}</div>
        ) : <p class="hint">Nothing related in this file.</p>],
        ...(matches.length ? [[`Matches · ${matches.reduce((s, m) => s + m.rows.length, 0)}`, () => (
          <div>{matches.map((m) => (
            <div class="related">
              <h3>{labelOf(m.table)} <span class="count">{m.rows.length}</span></h3>
              <ul class="matches">
                {m.rows.slice(0, 20).map(({ row, weights }) => (
                  <li>{chip(m.table, row)}<span class="muted">{weightsText(weights)}</span></li>
                ))}
              </ul>
              {m.rows.length > 20 && <p class="hint">… and {m.rows.length - 20} more</p>}
            </div>
          ))}</div>
        )] as [string, () => preact.JSX.Element]] : []),
      ]} />
    </div>
  );
}

/** The objects an association relation (e.g. reco <-> truth) links to this one, with the relation's weights, best
 *  first (by its `best` weight), one group per relation. */
function associations(table: string, row: number) {
  const b = bundle.value, ev = event.value;
  if (!b || !ev) return [];
  const out: { table: string; rows: { row: number; weights: Record<string, number> }[] }[] = [];
  for (const [name, info] of Object.entries(b.header.relations)) {
    const rel = ev.relations[name];
    if (!info.association || !rel || (info.from !== table && info.to !== table)) continue;
    const rows: { row: number; weights: Record<string, number> }[] = [];
    const weights = (k: number) => Object.fromEntries(Object.entries(rel.weights).map(([w, a]) => [w, a[k]]));
    if (info.from === table)
      for (let k = rel.offsets[row]; k < rel.offsets[row + 1]; k++) rows.push({ row: rel.indices[k], weights: weights(k) });
    else
      for (let f = 0; f + 1 < rel.offsets.length; f++)
        for (let k = rel.offsets[f]; k < rel.offsets[f + 1]; k++) if (rel.indices[k] === row) rows.push({ row: f, weights: weights(k) });
    if (!rows.length) continue;
    if (info.best) { const weight = info.best.weight, cmp = bestFirst(info.best); rows.sort((a, c) => cmp(a.weights[weight] ?? 0, c.weights[weight] ?? 0)); }
    const other = info.from === table ? info.to : info.from, same = out.find((o) => o.table === other);
    if (same) same.rows.push(...rows.filter((r) => !same.rows.some((x) => x.row === r.row)));
    else out.push({ table: other, rows });
  }
  return out;
}

/** What truth particles left in the given hits: per particle, the sum of the `best` weight of truth -> hit
 *  associations (e.g. simEnergy) over those hits, in drawn hit layers only (so a hit is not counted twice through
 *  two hit tables). Largest first. Null without such associations. */
function truthInHits(objects: Related) {
  const b = bundle.value, ev = event.value;
  if (!b || !ev) return null;
  const sums = new Map<number, number>();
  let table = "", weight = "", total = 0;
  for (const [name, info] of Object.entries(b.header.relations)) {
    const rel = ev.relations[name], rows = objects.get(info.to), w = info.best ? rel?.weights[info.best.weight] : undefined;
    if (!rel || !rows || !w || !info.association || !isTruth(info.from) || !drawn(info.to) || isTruth(info.to)) continue;
    if (!isHitLayer(layerOf(info.to))) continue;
    table = info.from;
    weight = info.best!.weight;
    for (let p = 0; p + 1 < rel.offsets.length; p++)
      for (let k = rel.offsets[p]; k < rel.offsets[p + 1]; k++)
        if (rows.has(rel.indices[k])) { sums.set(p, (sums.get(p) ?? 0) + w[k]); total += w[k]; }
  }
  return table ? { table, weight, total, particles: [...sums].sort((a, c) => c[1] - a[1]) } : null;
}

function drawn(table: string) {
  const b = bundle.value;
  return !!b?.header.display.some((l) => l.table === table && visible.value[layerKey(l)]);
}

const isTruth = (table: string) => !!layerOf(table)?.truth;
