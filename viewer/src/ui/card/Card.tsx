// The card of the selected object (the `.inspector` panel in styles/card.css): the one place that says where it sits
// and what the truth says about it. It carries names and numbers; what each thing is, and how it is counted, is behind
// an "i" or the tag itself (Info.tsx).
// From the top, the answer first and the evidence below (docs/truth.md "The card"):
// - its one name (model/event/describe.ts cardName): "Electron 2 · pT 59.7 GeV · η 0.714", its collection below it, small;
// - for a reco object, what the truth says (TruthBlock.tsx), then what it is made of and its main numbers
//   (Physics.tsx), then its chain (Chain.tsx); for a truth object, its lineage and what was reconstructed from it
//   (TruthSide, below);
// - the levels drawn in the view, when they are not the chain's own steps (ViewLevels);
// - the truth <-> reco pair the view is coloured by (PairBars.tsx);
// - every association it has, with the relation's weights (Associations), and all its columns (Properties.tsx);
// - at the bottom edge, the object looked at from the card, while there is one (Looking).
//
// Which object it describes comes from the store: `subject` is the card's object and `selection` the object the view
// shows. They are the same unless another object is looked at from the card; `anchor` then holds the card's object.
import { percent } from "../../model/truth/match";
import { foldReco } from "../../model/event/chain";
import { sharedParts } from "../../model/event/physics";
import { bestFirst, type Ref, sameRef } from "../../model/event/relations";
import { plain } from "../../model/event/describe";
import {
  anchor,
  bundle,
  cardNameOf,
  event,
  focusBar,
  focusHistory,
  focusLevel,
  labelOf,
  layerOf,
  levelTop,
  modes,
  nameOf,
  openCard,
  reconstructed,
  selection,
  shownLevel,
  stepName,
  subject,
  truthName,
  truthStatuses,
} from "../../model/store";
import { Chain } from "./Chain";
import { chip } from "./chips";
import { keyColumns, Properties, Rows } from "./Properties";
import { Info } from "../common/Info";
import { back, cross, crossing, frameFocus } from "../../control/navigate";
import { PairBars } from "./PairBars";
import { Lineage, ParticleFacts, TruthCard, unassociated } from "./TruthCard";
import { GapLink, TruthBlock } from "./TruthBlock";
import { Physics } from "./Physics";
import { Icon } from "../common/widgets";

const NONE = new Set<string>();

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
        In the view <span class="lanes">{nameOf(top)}</span>
      </h4>
      <div class="levelrow">
        {bar.map((l, i) => {
          const on = l.always || l.name === chosen;
          return (
            <>
              {/* what is only built from its parts: ↓ ↑ skip it, a click draws it */}
              {l.beside && !bar[i - 1]?.beside && <span class="muted">built from its parts:</span>}
              <button
                class={on ? "level on" : "level"}
                disabled={l.always}
                aria-pressed={on}
                onClick={() => (focusLevel.value = l.name === chosen ? null : l.name)}
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

/** The button across the reco <-> truth link (X), disabled with the reason when there is nothing across. */
function GoAcross() {
  const go = crossing.value,
    can = !!go.to || go.choices.length > 0;
  return (
    <button class="gotruth" disabled={!can} title={can ? "Go across (X)" : go.why} onClick={() => cross(true)}>
      Go to reco (X)
    </button>
  );
}

/** A truth object: where it sits in the truth graph, and what was reconstructed from it. */
function TruthSide({ table, row }: { table: string; row: number }) {
  const rec = reconstructed.value,
    root = modes.value.roots.truth;
  // The kinds without an associator: those this particle could have reached; for another truth object, all of them.
  const none = [...truthStatuses.value].flatMap(([t, s]) => (s.kind === "none" ? [{ t, gap: s.gap }] : [])),
    unanswered =
      table === root
        ? unassociated(row)
        : {
            names: [...new Set(none.map(({ t }) => truthName(t)))],
            gaps: [...new Set(none.flatMap(({ gap }) => (gap === undefined ? [] : [gap])))],
          };
  const b = bundle.value,
    ev = event.value;
  // The same objects at several levels (the same parts, e.g. a trackster's layer clusters) are one line.
  const same = (x: Ref, y: Ref) =>
    !!b && !!ev && sharedParts(ev, b.header, x.table, x.row, NONE).some((s) => s.same && sameRef(s, y));
  const found = foldReco(rec?.reco.filter((r) => r.partners.length) ?? [], same),
    empty = rec?.reco.filter((r) => !r.partners.length) ?? [];
  const help = (
    <>
      <p>
        The reco objects that share hits or energy with this truth object, from CMSSW's truth to reco maps, most
        complete first.
      </p>
      <p>
        <b>completeness</b>: the share of this particle that the object holds, by the associator: of its energy in that
        detector (calorimeters: each cell's rechit energy, split between the particles by the simulated energy they left
        in it), or of its tracker hits (tracks, its descendants' hits included). <span class="ok">★ its best</span>: the
        particle is that object's own best match; an object best matched to another particle merges this one into it.
      </p>
      <p>
        <b>Click</b> an object to look at it in the view; <b>double click</b> to open its card.
      </p>
      <p>
        Under each kind, the objects that hold at least 5% of it, at most four; "+N" counts the others (all of them
        under Every association, below). Kinds that show the same objects (the same parts) share one line.
      </p>
      {empty.length > 0 && (
        <p>
          Nothing holds any of it in: {empty.map((r) => stepName(r.table)).join(", ")}. That is not by itself an
          inefficiency: the particle may never have reached that detector.
        </p>
      )}
      {rec && !rec.hits.length && (
        <p>
          No hits are recorded on this particle itself: the file gives hits to the particles that entered the
          calorimeter (each with its own shower). If this one did not, the particles it made carry them: its pair
          (below) shows them.
        </p>
      )}
      {unanswered.names.length > 0 && (
        <p>
          No CMSSW associator, so no answer, for {table === root ? "the kinds it could have reached" : "these kinds"}:{" "}
          {unanswered.names.join(", ")}
          {unanswered.gaps.length > 0 && (
            <>
              {" "}
              (the gaps:{" "}
              {unanswered.gaps.map((g, i) => (
                <>
                  {i > 0 && ", "}
                  <GapLink gap={g} />
                </>
              ))}
              )
            </>
          )}
          . Ember builds none.
        </p>
      )}
    </>
  );
  return (
    <>
      {table === root && (
        <section class="matchcard">
          <ParticleFacts row={row} />
          <Lineage row={row} />
        </section>
      )}
      {rec && (rec.reco.length > 0 || rec.hits.length > 0) && (
        <section class="ladder" aria-label="Reconstructed as">
          <h4>
            Reconstructed as{" "}
            <span class="lanes">
              <GoAcross />
              <Info title="Reconstructed as">{help}</Info>
            </span>
          </h4>
          <ol>
            {found.map((r) => {
              const t = r.tables[0],
                of =
                  r.measure === "hits"
                    ? `hits${r.in ? ` in the ${r.in}` : ""} (with its secondaries')`
                    : r.measure === "pt2"
                      ? "findable tracks (pT²)"
                      : `energy${r.in ? ` in ${r.in}` : ""}`;
              return (
                <li class="rung below">
                  <div class="rhead">
                    <span
                      class="rkind"
                      title={
                        r.tables.length > 1 ? "The same objects at each of these levels (the same parts)" : undefined
                      }
                    >
                      {r.tables.map((x) => stepName(x)).join(", ")}
                    </span>
                  </div>
                  <div class="rlink">
                    {r.partners.map((p) => (
                      <span class="partner">
                        {chip(
                          t,
                          p.row,
                          `${p.completeness !== undefined ? `it holds ${percent(p.completeness)} of this one's ${of}; ` : ""}${p.best ? "this is its own best match" : p.unmatched ? "it has no best match of its own" : "its own best match is another truth object"}`,
                        )}
                        {p.completeness !== undefined && (
                          <span
                            class="muted"
                            title="completeness: the share of this particle the object holds (associator)"
                          >
                            completeness {percent(p.completeness)}
                          </span>
                        )}
                        {p.best && (
                          <span class="ok" title="The particle is this object's own best match (associator)">
                            ★ its best
                          </span>
                        )}
                      </span>
                    ))}
                    {r.folded > 0 && (
                      <span
                        class="muted"
                        title="The others, most holding under 5% of it: all of them under Every association, below"
                      >
                        +{r.folded}
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
          {!found.length && !rec.hits.length && <p class="hint">No reco object holds any of it.</p>}
        </section>
      )}
    </>
  );
}

const weightsText = (w: Record<string, number>) =>
  Object.entries(w)
    .map(([k, v]) => `${k} ${plain(v)}`)
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
