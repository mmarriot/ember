// The card of the selected object: the one place that says where it sits and what the truth says about it. It
// carries names and numbers; what each thing is, and how it is counted, is behind an "i" or the tag itself (Info.tsx).
// From the top:
// - its chain (Chain.tsx), or for a truth object its lineage and what was reconstructed from it (TruthSide, below);
// - the levels drawn in the view, when they are not the chain's own steps (ViewLevels);
// - the truth <-> reco pair the view is coloured by (PairBars.tsx);
// - for a reco object, its truth match (TruthCard.tsx);
// - every association it has, with the relation's weights (Associations), and its columns (Columns.tsx);
// - at the bottom edge, the object looked at from the card, while there is one (Looking).
//
// Which object it describes comes from the store: `subject` is the card's object and `selection` the object the view
// shows. They are the same unless another object is looked at from the card; `anchor` then holds the card's object.
import { percent } from "../model/match";
import { bestFirst, sameRef, type Ref } from "../model/relations";
import {
  anchor,
  bundle,
  describe,
  event,
  focusBar,
  focusHistory,
  focusLevel,
  full,
  highlight,
  kindOf,
  labelOf,
  layerOf,
  levelTop,
  modes,
  openCard,
  reconstructed,
  selection,
  shownLevel,
  stepName,
  subject,
  truthName,
  truthStatuses,
} from "../model/store";
import { Chain } from "./Chain";
import { ObjChip } from "./chips";
import { keyColumns, Properties, Rows } from "./Columns";
import { Info } from "./Info";
import { back } from "./navigate";
import { PairBars } from "./PairBars";
import { Lineage, TruthCard } from "./TruthCard";
import { engine } from "./Viewport";
import { Icon } from "./widgets";

const name = (r: Ref) => {
  const n = describe(r.table, r.row);
  return `${kindOf(r.table)}${n ? ` · ${n}` : ` #${r.row}`}`;
};
const chip = (t: string, r: number, title = "") => <ObjChip table={t} row={r} title={title} />;

export function Navigator() {
  const b = bundle.value,
    ev = event.value,
    sel = subject.value,
    hl = highlight.value;
  if (!b || !ev || !sel || !ev.tables[sel.table]) return null;
  const info = b.header.tables[sel.table],
    table = ev.tables[sel.table];
  const d = layerOf(sel.table),
    truth = !!d?.truth,
    text = describe(sel.table, sel.row),
    prev = !anchor.value && focusHistory.value.at(-1);
  return (
    <div class="inspector" role="dialog" aria-label="Selected object">
      <header>
        <div>
          {prev && (
            <button class="link backlink" onClick={back} title={`Back to ${name(prev)} (B)`}>
              ← {name(prev)}
            </button>
          )}
          <div class={truth ? "kind truth" : "kind"}>
            {labelOf(sel.table)}
            {truth && " (simulation)"}{" "}
            {info.doc && (
              <Info title={labelOf(sel.table)}>
                <p>{info.doc}</p>
              </Info>
            )}
          </div>
          <h2>
            #{sel.row}
            {text && <span class="describe"> · {text}</span>}
          </h2>
        </div>
        <div class="actions">
          <button
            class="icon-button"
            title="Zoom to what the view shows (F)"
            onClick={() => hl && engine?.frame(hl, true)}
          >
            <Icon name="focus" />
          </button>
          <button class="icon-button" title="Close (Esc)" onClick={() => (selection.value = null)}>
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div class="navbody">
        {truth ? <TruthSide table={sel.table} row={sel.row} /> : <Chain />}
        <ViewLevels />
        <PairBars />
        {!truth && (
          <section class="matchcard">
            <TruthCard table={sel.table} row={sel.row} />
          </section>
        )}
        <Associations table={sel.table} row={sel.row} />
        <Properties table={table} name={sel.table} row={sel.row} />
      </div>
      <Looking />
    </div>
  );
}

/** The object looked at from this card (a click on one of its objects): what it is, its own truth match and its main
 *  numbers, with the way into its own card and back. The view shows it as a selection. It sits at the bottom edge of
 *  the card, over its content: nothing in the card moves when it appears, so the second click of a double click
 *  lands on the same name. */
function Looking() {
  const a = anchor.value,
    sel = selection.value,
    t = sel && event.value?.tables[sel.table];
  if (!a || !sel || !t) return null;
  const truth = !!layerOf(sel.table)?.truth;
  return (
    <section class="looking" aria-label="Looking at">
      <h4>Looking at</h4>
      <div class="lookhead">
        <b class={truth ? "kind truth" : undefined}>{name(sel)}</b>
        <span>
          <button class="link" title="Back to this card's object (Esc)" onClick={back}>
            ✕ stop
          </button>
          <button
            class="open"
            title="Open its card (double click does the same)"
            onClick={() => {
              openCard(sel);
              engine?.frame(highlight.peek() ?? undefined, true, 800);
            }}
          >
            Open →
          </button>
        </span>
      </div>
      {truth ? (
        sel.table === modes.value.roots.truth && <Lineage row={sel.row} compact />
      ) : (
        <TruthCard table={sel.table} row={sel.row} />
      )}
      <Rows name={sel.table} table={t} row={sel.row} columns={keyColumns(sel.table, t).slice(0, 5)} />
    </section>
  );
}

/** The levels drawn on request (↓ ↑) when they are not the card's own steps: those of the object the view is built
 *  around (the object looked at; the pair's candidate for a hit or a truth particle; the focus for one of its parts). */
function ViewLevels() {
  const top = levelTop.value,
    bar = focusBar.value,
    chosen = shownLevel.value;
  if (!top || sameRef(top, subject.value) || !bar.some((l) => !l.always)) return null;
  return (
    <section class="viewlevels" aria-label="Levels in the view">
      <h4 title="The view is built around this object: its smallest parts are always drawn, one of the other levels on request (↓ ↑)">
        In the view <span class="lanes">{name(top)}</span>
      </h4>
      <div class="levelrow">
        {bar.map((l) => {
          const on = l.always || l.name === chosen;
          return (
            <button
              class={on ? "level on" : "level"}
              disabled={l.always}
              aria-pressed={on}
              onClick={() => (focusLevel.value = l.name === chosen ? null : l.name)}
            >
              {l.name} <span class="count">{l.count.toLocaleString()}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** A truth object: where it sits in the truth graph, and what was reconstructed from it. */
function TruthSide({ table, row }: { table: string; row: number }) {
  const rec = reconstructed.value,
    root = modes.value.roots.truth;
  const gaps = [
    ...new Set(
      [...truthStatuses.value]
        .filter(([, s]) => s.kind === "none")
        .map(([t, s]) => `${truthName(t)}${s.kind === "none" && s.gap !== undefined ? ` (gap ${s.gap})` : ""}`),
    ),
  ];
  const found = rec?.reco.filter((r) => r.partners.length) ?? [],
    empty = rec?.reco.filter((r) => !r.partners.length) ?? [];
  const help = (
    <>
      <p>
        The reco objects that share hits or energy with this truth object, from CMSSW's truth to reco maps, most
        complete first.
      </p>
      <p>
        <b>%</b>: the share of it that the object holds. <span class="ok">★</span>: it is that object's own best match.
      </p>
      <p>
        <b>Click</b> an object to look at it in the view; <b>double click</b> to open its card.
      </p>
      {empty.length > 0 && (
        <p>"None" is not by itself an inefficiency: the particle may never have reached that detector.</p>
      )}
      {rec && !rec.hits.length && (
        <p>No hits are recorded on this particle itself; the simulation may record them on the particles it made.</p>
      )}
      {gaps.length > 0 && <p>No truth link yet for: {gaps.join(", ")}.</p>}
    </>
  );
  return (
    <>
      {table === root && (
        <section class="matchcard">
          <Lineage row={row} />
        </section>
      )}
      {rec && (rec.reco.length > 0 || rec.hits.length > 0) && (
        <section class="ladder" aria-label="Reconstructed as">
          <h4>
            Reconstructed as{" "}
            <span class="lanes">
              <span class="badge truth">truth</span>⇄<span class="badge reco">reco</span>
              <Info title="Reconstructed as">{help}</Info>
            </span>
          </h4>
          <ol>
            {found.map((r) => {
              const of =
                r.measure === "hits"
                  ? `hits${r.in ? ` in the ${r.in}` : ""} (with its secondaries')`
                  : r.measure === "pt2"
                    ? "findable tracks (pT²)"
                    : `energy${r.in ? ` in ${r.in}` : ""}`;
              return (
                <li class="rung below">
                  <div class="rhead">
                    <span class="rkind">{stepName(r.table)}</span>
                  </div>
                  <div class="rlink">
                    {r.partners.slice(0, 4).map((p) => (
                      <span class="partner">
                        {chip(
                          r.table,
                          p.row,
                          `${p.completeness !== undefined ? `it holds ${percent(p.completeness)} of this one's ${of}; ` : ""}${p.best ? "this is its own best match" : p.unmatched ? "it has no best match of its own" : "its own best match is another truth object"}`,
                        )}
                        {p.completeness !== undefined && <span class="muted">{percent(p.completeness)}</span>}
                        {p.best && (
                          <span class="ok" aria-label="its best match">
                            ★
                          </span>
                        )}
                      </span>
                    ))}
                    {r.partners.length > 4 && (
                      <span class="muted" title="All of them: under Every association, below">
                        +{r.partners.length - 4}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
            {rec.hits.map((h) => (
              <li class="rung below">
                <div class="rhead">
                  <span class="rkind">Hits{h.in && ` · ${h.in}`}</span>
                  <span class="count">{h.hits.toLocaleString()}</span>
                </div>
              </li>
            ))}
          </ol>
          {empty.length > 0 && <p class="hint">None: {empty.map((r) => stepName(r.table)).join(", ")}</p>}
        </section>
      )}
    </>
  );
}

const weightsText = (w: Record<string, number>) =>
  Object.entries(w)
    .map(([k, v]) => `${k} ${Math.abs(v) < 5e-4 ? "0" : full(v)}`)
    .join(" · ");

/** Every object an association relation (e.g. reco <-> truth) links to this one, with the relation's weights as
 *  stored, best first (by its `best` weight), one group per partner table: the associator's other partners behind
 *  the best match (the particles sharing an impure trackster), folded. */
function Associations({ table, row }: { table: string; row: number }) {
  const b = bundle.value,
    ev = event.value;
  if (!b || !ev) return null;
  const out: { table: string; rows: { row: number; weights: Record<string, number> }[] }[] = [];
  for (const [relName, info] of Object.entries(b.header.relations)) {
    const rel = ev.relations[relName];
    if (!info.association || !rel || (info.from !== table && info.to !== table)) continue;
    const rows: { row: number; weights: Record<string, number> }[] = [];
    // Named by what they hold: a hit-based association (tracks) stores shared hit counts under its energy names.
    const label = (w: string) =>
      info.match?.measure === "hits" && (w === "sharedEnergy" || w === "sharedFraction") ? "shared hits" : w;
    const weights = (k: number) => Object.fromEntries(Object.entries(rel.weights).map(([w, a]) => [label(w), a[k]]));
    if (info.from === table)
      for (let k = rel.offsets[row]; k < rel.offsets[row + 1]; k++)
        rows.push({ row: rel.indices[k], weights: weights(k) });
    else
      for (let f = 0; f + 1 < rel.offsets.length; f++)
        for (let k = rel.offsets[f]; k < rel.offsets[f + 1]; k++)
          if (rel.indices[k] === row) rows.push({ row: f, weights: weights(k) });
    if (!rows.length) continue;
    if (info.best) {
      const weight = label(info.best.weight),
        cmp = bestFirst(info.best);
      rows.sort((a, c) => cmp(a.weights[weight] ?? 0, c.weights[weight] ?? 0));
    }
    const other = info.from === table ? info.to : info.from,
      same = out.find((o) => o.table === other);
    if (same) same.rows.push(...rows.filter((r) => !same.rows.some((x) => x.row === r.row)));
    else out.push({ table: other, rows });
  }
  const n = out.reduce((s, m) => s + m.rows.length, 0);
  if (!n) return null;
  return (
    <section class="associations">
      <details>
        <summary title="Every object an association in the file links to it, with the weights as stored">
          Every association · {n.toLocaleString()}
        </summary>
        {out.map((m) => (
          <div class="related">
            <h3>
              {labelOf(m.table)} <span class="count">{m.rows.length.toLocaleString()}</span>
            </h3>
            <ul class="matches">
              {m.rows.slice(0, 20).map(({ row: r, weights }) => (
                <li>
                  {chip(m.table, r)}
                  <span class="muted">{weightsText(weights)}</span>
                </li>
              ))}
            </ul>
            {m.rows.length > 20 && <p class="hint">… and {m.rows.length - 20} more</p>}
          </div>
        ))}
      </details>
    </section>
  );
}
