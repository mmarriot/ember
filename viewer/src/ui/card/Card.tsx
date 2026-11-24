// The card of the selected object (the `.inspector` panel in styles/card.css; docs/truth.md "The card"): its name,
// then the answer first and the evidence below. A reco object: its truth (TruthBlock.tsx), physics (Physics.tsx) and
// chain (Chain.tsx); a truth object: its lineage and what was reconstructed from it (TruthSide.tsx). Then the view's
// levels, the pair (PairBars.tsx), every association and all its columns, and at the bottom edge the object looked at.
//
// `subject` is the card's object and `selection` the object the view shows: they differ while another object is
// looked at from the card, and `anchor` then holds the card's object.
import { bestFirst, sameRef } from "../../model/event/relations";
import { plain } from "../../model/event/describe";
import {
  anchor,
  bundle,
  cardNameOf,
  event,
  focusBar,
  focusHistory,
  labelOf,
  layerOf,
  levelTop,
  modes,
  nameOf,
  openCard,
  selection,
  levelOn,
  subject,
  tickLevel,
} from "../../model/store";
import { Chain } from "./Chain";
import { chip } from "./chips";
import { keyColumns, Properties, Rows } from "./Properties";
import { Info } from "../common/Info";
import { back, frameFocus } from "../../control/navigate";
import { PairBars } from "./PairBars";
import { Lineage } from "./Lineage";
import { TruthCard } from "./TruthCard";
import { TruthBlock } from "./TruthBlock";
import { TruthSide } from "./TruthSide";
import { Physics } from "./Physics";
import { Icon } from "../common/widgets";

export function Card() {
  const b = bundle.value,
    ev = event.value,
    sel = subject.value;
  if (!b || !ev || !sel || !ev.tables[sel.table]) return null;
  const info = b.header.tables[sel.table],
    table = ev.tables[sel.table];
  const d = layerOf(sel.table),
    truth = !!d?.truth,
    prev = !anchor.value && focusHistory.value.at(-1),
    [name, source] = cardNameOf(sel);
  return (
    <div class="inspector" role="dialog" aria-label="Selected object">
      <header>
        <div>
          {prev && (
            <button class="link backlink" onClick={back} title={`Back to ${nameOf(prev)} (B)`}>
              ← {nameOf(prev)}
            </button>
          )}
          {truth && <div class="kind truth">simulation</div>}
          <h2>
            {name}{" "}
            {(info.doc || d?.doc) && (
              <Info title={labelOf(sel.table)}>
                {d?.doc && <p>{d.doc}</p>}
                {info.doc && <p>{info.doc}</p>}
              </Info>
            )}
          </h2>
          {source && <div class="source">{source}</div>}
        </div>
        <div class="actions">
          <button class="icon-button" title="Zoom to what the view shows (F)" onClick={() => frameFocus()}>
            <Icon name="focus" />
          </button>
          <button class="icon-button" title="Close (Esc)" onClick={() => (selection.value = null)}>
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div class="navbody">
        {truth ? (
          <TruthSide table={sel.table} row={sel.row} />
        ) : (
          <>
            <TruthBlock table={sel.table} row={sel.row} />
            <Physics table={sel.table} row={sel.row} />
            <Chain />
          </>
        )}
        <ViewLevels />
        <PairBars />
        <Associations table={sel.table} row={sel.row} />
        <Properties table={table} name={sel.table} row={sel.row} />
      </div>
      <Looking />
    </div>
  );
}

/** The object looked at from this card: its name, truth match and main numbers, with the way into its card and back.
 *  It sits over the card's bottom edge, so nothing in the card moves when it appears and the second click of a double
 *  click lands on the same name. */
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
        <b class={truth ? "kind truth" : undefined}>{nameOf(sel)}</b>
        <span>
          <button class="link" title="Back to this card's object (Esc)" onClick={back}>
            ✕ stop
          </button>
          <button
            class="open"
            title="Open its card (double click does the same)"
            onClick={() => {
              openCard(sel);
              frameFocus(800);
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

/** The levels to tick (↓ ↑) when they are not the card's own steps: those of the object the view is built around
 *  (the object looked at, the pair's candidate, or the focus). */
function ViewLevels() {
  const top = levelTop.value,
    bar = focusBar.value;
  if (!top || sameRef(top, subject.value) || !bar.some((l) => !l.always)) return null;
  return (
    <section class="viewlevels" aria-label="Levels in the view">
      <h4 title="The view is built around this object: each level is drawn when its collections are ticked (click, or ↓ ↑ to move the tick)">
        In the view <span class="lanes">{nameOf(top)}</span>
      </h4>
      <div class="levelrow">
        {bar.map((l, i) => {
          const on = levelOn(l);
          return (
            <>
              {/* objects only built from its parts: ↓ ↑ skip them, a click draws them */}
              {l.beside && !bar[i - 1]?.beside && <span class="muted">built from its parts:</span>}
              <button
                class={on ? "level on" : "level"}
                aria-pressed={on}
                title={
                  on
                    ? "Drawn: its collections are ticked. Click to untick them, for the whole event"
                    : "Click to tick its collections, for the whole event"
                }
                onClick={() => tickLevel(l.name, !on)}
              >
                {l.name} <span class="count">{l.count.toLocaleString()}</span>
              </button>
            </>
          );
        })}
      </div>
    </section>
  );
}

const weightsText = (w: Record<string, number>) =>
  Object.entries(w)
    .map(([k, v]) => `${k} ${plain(v)}`)
    .join(" · ");

/** Every object an association links to this one, with the weights as stored, best first, one group per partner
 *  table (folded): e.g. the other particles sharing an impure trackster. */
function Associations({ table, row }: { table: string; row: number }) {
  const b = bundle.value,
    ev = event.value;
  if (!b || !ev) return null;
  const out: { table: string; rows: { row: number; weights: Record<string, number> }[] }[] = [];
  for (const [relName, info] of Object.entries(b.header.relations)) {
    const rel = ev.relations[relName];
    if (!info.association || !rel || (info.from !== table && info.to !== table)) continue;
    const rows: { row: number; weights: Record<string, number> }[] = [];
    // A hit-based association (tracks) stores shared hit counts under its energy names.
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
