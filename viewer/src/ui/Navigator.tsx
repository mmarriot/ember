// The card of the selected object, the one place that says where it sits and what the truth says about it. It carries
// names and numbers; what each thing is and how it is counted is behind an "i" or the tag itself (ui/Info.tsx).
// - its chain (model/chain.ts): what it is part of, itself, what it is made of, each step with its link to the truth
//   as a tag (match, fact, derived, no truth). A click on an object in the card looks at it in the view while the
//   card stays (store.ts look), a double click opens its card; "show" draws a step in the view (↓ ↑);
// - the object looked at, with its own match and numbers;
// - the truth ↔ reco pair the view is coloured by, as two bars in the view's colours;
// - its match (purity and completeness as bars), and for a truth object what was reconstructed from it;
// - every association it has, with the relation's weights, and its columns.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { colourBy, customColumns, customDoc } from "../model/custom";
import { type Table, unitOf } from "../io/format";
import type { Link, Rung } from "../model/chain";
import { percent } from "../model/match";
import { PAIR } from "../model/pair";
import { bestFirst, sameRef, type Ref } from "../model/relations";
import { PALETTES } from "../render/colour";
import {
  anchor,
  bundle,
  describe,
  domain,
  event,
  focus,
  focusBar,
  focusHistory,
  focusLevel,
  full,
  highlight,
  kindOf,
  labelOf,
  ladder,
  largestFirst,
  layerKey,
  layerOf,
  levelTop,
  modes,
  openCard,
  pairView,
  reconstructed,
  selection,
  shared,
  short,
  shownLevel,
  sizeColumn,
  stepName,
  subject,
  theme,
  truthName,
  truthStatuses,
} from "../model/store";
import { factUnit, facts } from "../model/facts";
import { ObjChip } from "./chips";
import { Info, togglePopover } from "./Info";
import { engine } from "./Viewport";
import { back, chooseDomain } from "./navigate";
import { Lineage, TruthCard } from "./Truth";
import { Icon } from "./widgets";

const INLINE = 3; // a step with at most this many objects names them; a longer one counts them and unfolds
const LISTED = 40; // objects listed in an unfolded step

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

/** What the chain's words mean, behind its "i". */
const CHAIN_HELP = (
  <>
    <p>
      Where this object sits among the event's objects: what it is <b>part of</b>, and what it is <b>made of</b>, down
      to the hits.
    </p>
    <p>
      <b>Click</b> an object to look at it in the view; the card stays. <b>Double click</b> to open its card.
    </p>
    <p>Each step says what the truth has for it:</p>
    <ul>
      <li>
        <b>match</b>: CMSSW's associator matched it to a truth particle. <i class="qdot q-clean" /> clean,{" "}
        <i class="qdot q-impure" /> impure, <i class="qdot q-unmatched" /> no match.
      </li>
      <li>
        <b>fact</b>: from the simulation, the particles that left the energy in these hits.
      </li>
      <li>
        <b>derived</b>: worked out in evd, where CMSSW has no associator yet.
      </li>
      <li>
        <b>no truth</b>: CMSSW has no truth for this kind of object yet.
      </li>
    </ul>
    <p>Click a tag for what it means on that step.</p>
  </>
);

/** A reco object's chain, with the truth link of every step. */
function Chain() {
  const l = ladder.value;
  if (!l) return null;
  return (
    <section class="ladder" aria-label="Chain">
      <h4>
        Chain{" "}
        <span class="lanes">
          {modes.value.roots.truth && (
            <>
              <span class="badge reco">reco</span>⇄<span class="badge truth">truth</span>
            </>
          )}
          <Info title="The chain">{CHAIN_HELP}</Info>
        </span>
      </h4>
      <ol>
        {l.above.length > 0 && <li class="part">part of</li>}
        {l.above.map((r) => (
          <RungRow rung={r} role="above" key={`a|${r.kind}`} />
        ))}
        <RungRow rung={l.self} role="self" />
        {l.below.length > 0 && <li class="part">made of</li>}
        {l.below.map((r) => (
          <RungRow rung={r} role="below" key={`b|${r.kind}`} />
        ))}
        {l.beside.length > 0 && (
          <li
            class="part"
            title="Other objects built only from its parts (e.g. a secondary vertex whose tracks are all in this jet). They are not parts of it."
          >
            also inside it
          </li>
        )}
        {l.beside.map((r) => (
          <RungRow rung={r} role="beside" key={`s|${r.kind}`} />
        ))}
        {l.other.length > 0 && (
          <li class="part" title="Rows of tables this data set does not draw that are related to it">
            other tables
          </li>
        )}
        {l.other.map((r) => (
          <RungRow rung={r} role="other" key={`o|${r.kind}`} />
        ))}
      </ol>
    </section>
  );
}

/** One step of the chain: its kind, its objects (named when few, else counted, unfolding to a list), whether the view
 *  shows it, and its truth links. */
function RungRow({ rung, role }: { rung: Rung; role: "above" | "self" | "below" | "beside" | "other" }) {
  const [open, setOpen] = useState(false);
  const tables = new Set(rung.groups.map((g) => g.table)),
    few = rung.count <= INLINE;
  // The level of the focus this step is (store.ts levels): one drawn on request, or always (the smallest objects,
  // lines). Not while another object is looked at: the view's levels are then that object's (ViewLevels).
  const level =
    !anchor.value && (role === "below" || role === "beside")
      ? focusBar.value.find((lv) => lv.layers.some((x) => tables.has(x.table)))
      : undefined;
  const on = !!level && shownLevel.value === level.name;
  // A step in a part of the detector the view is not looking at: one click looks there, keeping the selection.
  const cur = domain.value,
    parts = [
      ...new Set(
        rung.groups.map((g) => layerOf(g.table)?.domain).filter((x): x is string => !!x && !shared.value.has(x)),
      ),
    ];
  const elsewhere = role !== "self" && cur && parts.length && !parts.includes(cur) ? parts[0] : undefined;
  return (
    <li class={`rung ${role}${on ? " shown" : ""}`}>
      <div class="rhead">
        <span class="rkind">{rung.kind}</span>
        {role === "self" ? null : few ? (
          rung.groups.map((g) => (
            <>
              {g.rows.map((r) => chip(g.table, r))}
              {g.held && (
                <span
                  class="muted"
                  title={`No relation names it as containing this object: it holds ${g.held[0]} of this object's ${g.held[1]} parts (worked out in evd)`}
                >
                  ≈ {g.held[0]} of {g.held[1]} parts
                </span>
              )}
            </>
          ))
        ) : (
          <button class="link count" aria-expanded={open} title="List them" onClick={() => setOpen(!open)}>
            {rung.count.toLocaleString()} {open ? "▾" : "▸"}
          </button>
        )}
        <span class="rtools">
          {elsewhere && (
            <button
              class="link"
              title={`Look at ${elsewhere}, keeping the selection (D)`}
              onClick={() => chooseDomain(elsewhere)}
            >
              {elsewhere} ›
            </button>
          )}
          {level && !level.always && !elsewhere && (
            <button
              class={on ? "level on" : "level"}
              aria-pressed={on}
              title="Draw this step in the view (↓ ↑ step through them)"
              onClick={() => (focusLevel.value = on ? null : level.name)}
            >
              {on ? "shown" : "show"}
            </button>
          )}
        </span>
      </div>
      {rung.links.map((link) => (
        <LinkLine
          link={link}
          single={rung.count === 1}
          several={rung.links.filter((x) => x.kind === link.kind).length > 1}
          at={rung.groups[0]}
        />
      ))}
      {open && !few && (
        <div class="rlist">
          {rung.groups.map((g) => (
            <div>
              {rung.groups.length > 1 && <span class="muted">{layerOf(g.table)?.label} </span>}
              {largestFirst(g.table, g.rows)
                .slice(0, LISTED)
                .map((r) => chip(g.table, r))}
              {g.rows.length > LISTED && <span class="muted"> … {g.rows.length - LISTED} more</span>}
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

const MEASURE: Record<string, string> = { hits: "hits", energy: "energy", pt2: "tracks' pT²" };
/** A step's tag: the word, and behind it what it means on this step. */
const Tag = ({ word, children }: { word: string; children: ComponentChildren }) => (
  <button class="lk" title="What does this mean?" onClick={(e) => togglePopover(e, () => children, word)}>
    {word}
  </button>
);
const GAP = (gap?: number) => (gap !== undefined ? ` (docs/truth-graph.md, gap ${gap})` : "");

/** What the truth says about one step, in one line: a tag and numbers. Every line is that step's own statement: its
 *  objects' own matches, counted; the simulated energy in its own hits; never a match of the selected object through
 *  its parts. `at`: the step's first collection and row, for the simulation's unit of a hit. */
function LinkLine({
  link,
  single,
  several,
  at,
}: {
  link: Link;
  single: boolean;
  several: boolean;
  at?: { table: string; rows: number[] };
}) {
  const label = link.label && <span class="muted">{link.label}</span>;
  if (link.kind === "match") {
    const impure = link.good !== undefined ? link.matched - link.clean : 0,
      clean = link.matched - impure,
      none = link.of - link.matched;
    const help = (
      <>
        <p>CMSSW's associator gives each object at most one truth match, its best.</p>
        {link.good !== undefined && (
          <p>
            <i class="qdot q-clean" /> <b>clean</b>: at least {percent(link.good)} of its{" "}
            {MEASURE[link.measure] ?? link.measure} comes from its match.
            <br />
            <i class="qdot q-impure" /> <b>impure</b>: less than that.
          </p>
        )}
        <p>
          <i class="qdot q-unmatched" /> <b>no match</b>: a fake, or an object the associator does not consider (e.g. a
          candidate without calorimeter energy).
        </p>
      </>
    );
    return (
      <div class="rlink match">
        <Tag word="match">{help}</Tag>
        {label}
        {single && link.matched > 0 && (
          <>
            {chip(link.truth, link.partners[0][0])}
            {link.purity !== undefined && (
              <span
                class={link.good === undefined ? "q" : `q q-${impure ? "impure" : "clean"}`}
                title="Purity: the share of it that comes from its match"
              >
                {percent(link.purity)} pure
              </span>
            )}
          </>
        )}
        {!single &&
          clean > 0 &&
          (link.good !== undefined ? (
            <span class="q q-clean">
              <i class="qdot q-clean" />
              {clean} clean
            </span>
          ) : (
            <span class="q">{clean} matched</span>
          ))}
        {!single && impure > 0 && (
          <span class="q q-impure">
            <i class="qdot q-impure" />
            {impure} impure
          </span>
        )}
        {none > 0 && (
          <span class="q q-unmatched">
            {!single && <i class="qdot q-unmatched" />}
            {single ? "no match" : `${none} no match`}
          </span>
        )}
      </div>
    );
  }
  if (link.kind === "fact") {
    // Where the simulation records a coarser unit than the hit (a CSC layer), every hit in it shares these particles.
    const f = at && bundle.value ? facts(bundle.value.header).find((x) => x.to === at.table) : undefined;
    const unit =
      f?.unit && at
        ? single
          ? factUnit(f, event.value?.tables[at.table]?.columns, at.rows[0])
          : "simulation unit"
        : undefined;
    const shown = link.particles.filter(([, share]) => share >= 0.005);
    const help = (
      <>
        <p>
          From the simulation: the share of the simulated energy in {single ? "this hit" : "these hits"}
          {link.in ? ` (${link.in})` : ""} that each truth particle left, with its secondaries.
        </p>
        <p>It is the energy deposited in the sensors, not calibrated: compare it only within one detector.</p>
        {unit && <p>The simulation records it per {unit}, not per hit: every hit there shares these particles.</p>}
        {link.unranked && (
          <p>
            This object's kind has no truth of its own, so no particle is ranked through its hits: that would be a match
            built in evd. Select a hit for its particles.
          </p>
        )}
        {!link.unranked && !shown.length && (
          <p>
            No exported particle left energy here: it is noise, out-of-time pile-up, or a particle the export left out.
            The file cannot tell which.
          </p>
        )}
      </>
    );
    return (
      <div class="rlink fact">
        <Tag word="fact">{help}</Tag>
        {label}
        {several && link.in && <span class="muted">{link.in}</span>}
        {link.unranked ? (
          <span class="muted">per hit</span>
        ) : !shown.length ? (
          <span class="muted">no exported particle</span>
        ) : (
          <>
            {shown.slice(0, 3).map(([p, share]) => (
              <>
                {chip(link.truth, p)}
                <span class="muted">{percent(share)}</span>
              </>
            ))}
            {shown.length > 3 && <span class="muted">+{shown.length - 3}</span>}
            {unit && <span class="muted">per {unit}</span>}
          </>
        )}
      </div>
    );
  }
  if (link.kind === "derived")
    return (
      <div class="rlink derived">
        <Tag word="derived">
          <p>
            Worked out in evd, not a CMSSW match: {link.reason}
            {GAP(link.gap)}.
          </p>
          {link.unranked && (
            <p>
              This object's kind has no truth of its own, so no particle is ranked through its parts. Select one for its
              particle.
            </p>
          )}
        </Tag>
        {label}
        {link.unranked ? (
          <span class="muted">per cluster</span>
        ) : link.partners.length ? (
          <>
            {link.partners.slice(0, 3).map(([p, n]) => (
              <>
                {chip(link.truth, p)}
                {!single && <span class="muted">×{n}</span>}
              </>
            ))}
            {link.partners.length > 3 && <span class="muted">+{link.partners.length - 3}</span>}
          </>
        ) : (
          <span class="muted">no particle</span>
        )}
      </div>
    );
  if (link.kind === "none")
    return (
      <div class="rlink none">
        <Tag word="no truth">
          <p>
            CMSSW has no truth for this kind of object yet: {link.reason}
            {GAP(link.gap)}.
          </p>
          <p>evd builds no match of its own. The steps it is made of speak for themselves.</p>
        </Tag>
        {label}
      </div>
    );
  return null; // no truth of its own (a track's hits): it goes with what contains it, and needs no line
}

/** The summary's columns of an object: its layer's `inspect` columns (e.g. a jet's pT, η, φ), else what colours, places
 *  and sizes it; then its custom columns. */
function keyColumns(name: string, table: Table) {
  const d = layerOf(name),
    custom = customColumns.value.filter((c) => c.table === name).map((c) => c.name);
  const colour = d ? (colourBy.value[layerKey(d)] ?? d.colour) : undefined;
  const category = d && typeof d.colourBy === "object" && "category" in d.colourBy ? d.colourBy.category : undefined;
  return [
    ...new Set([...(d?.inspect ?? [category, colour, ...(d?.position ?? []), sizeColumn(name, table)]), ...custom]),
  ].filter((c): c is string => !!c && c in table.columns);
}
/** Columns of one row as a table of name, value, unit. */
function Rows({ name, table, row, columns }: { name: string; table: Table; row: number; columns: string[] }) {
  const info = bundle.value!.header.tables[name],
    custom = customColumns.value.filter((c) => c.table === name).map((c) => c.name);
  return (
    <table class="kv">
      <tbody>
        {columns.map((c) => (
          <tr title={info.columns[c]?.doc ?? customDoc(name, c)}>
            <td>{custom.includes(c) ? <i>{c}</i> : c}</td>
            <td>{full(table.columns[c][row])}</td>
            <td class="unit">{unitOf(info.columns[c]?.doc)}</td>
          </tr>
        ))}
      </tbody>
    </table>
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

/** The truth ↔ reco pair the view is coloured by (model/pair.ts): where the particle's energy went and what the
 *  candidate is made of, as two bars in the view's colours. Hit by hit, the whole generator particle against its
 *  candidate: not the associator's purity and completeness of the selected object, which its match gives. */
function PairBars() {
  const pair = pairView.value,
    pal = PALETTES[theme.value],
    f = focus.value;
  if (!pair) return null;
  const c = (t: string | undefined, r: number) => (t && r >= 0 ? chip(t, r) : null);
  const eff = pair.efficiency,
    effTotal = eff ? eff.candidate + eff.others + eff.missed : 0,
    pur = pair.purity,
    purTotal = pur ? pur.particle + pur.other : 0;
  const selectedTruth = !!f && !!layerOf(f.table)?.truth;
  // The candidates' detector: simulated energy is counted there only (docs/truth.md "Scope").
  const where = Object.values(bundle.value?.header.relations ?? {}).find(
    (r) => r.match && r.from === pair.reco && r.to === pair.truth,
  )?.match?.in;
  const bar = (parts: [number, string, string][], total: number) => (
    <div class="pairbar">
      {parts
        .filter(([v]) => v > 0)
        .map(([v, colour, label]) => (
          <span
            style={{ width: `${(100 * v) / total}%`, background: colour }}
            title={`${label} ${percent(v / total)}`}
          />
        ))}
    </div>
  );
  const legend = (parts: [number, string, string][], total: number) => (
    <div class="pairlegend">
      {parts.map(([v, colour, label]) => (
        <span>
          <i style={{ background: colour }} />
          {label} <b>{percent(total > 0 ? v / total : undefined)}</b>
        </span>
      ))}
    </div>
  );
  const effParts: [number, string, string][] = eff
    ? [
        [eff.candidate, pal.pair[PAIR.matched], "in its candidate"],
        [eff.others, pal.pair[PAIR.split], "split off"],
        [eff.missed, pal.pair[PAIR.missed], "missed"],
      ]
    : [];
  const purParts: [number, string, string][] = pur
    ? [
        [pur.particle, pal.pair[PAIR.matched], "from the particle"],
        [pur.other, pal.pair[PAIR.contamination], "contamination"],
      ]
    : [];
  const help = (
    <>
      <p>
        With something selected, the view is coloured by its pair: a generator particle (the whole of it, with
        everything it made) and its best candidate, compared hit by hit{where ? ` in ${where}` : ""}.
      </p>
      <p>
        <b>Particle's energy</b>: where its simulated energy went
        {eff && effTotal > 0 ? ` (${short(effTotal)} GeV deposited in the sensors, not calibrated)` : ""}, each hit
        counted once.
      </p>
      <p>
        <b>Candidate's energy</b>: what the rechit energy of its hits is from; a hit counts for the particle that left
        the most simulated energy in it.
      </p>
      <p>These are not the associator's purity and completeness of the selected object: those are under its match.</p>
      {pair.particle < 0 && (
        <p>
          {pair.truth ? "No truth particle is matched to this candidate" : "There is no truth in this file"}: its
          objects are shown as reconstructed, nothing is confirmed.
        </p>
      )}
    </>
  );
  return (
    <section class="pair" aria-label="Truth and reco pair">
      <h4>
        View colours: the pair{" "}
        <span class="lanes">
          <Info title="The truth ↔ reco pair">{help}</Info>
        </span>
      </h4>
      <p class="pairline">
        <span class="badge truth">truth</span> {c(pair.truth, pair.particle) ?? <span class="muted">no particle</span>}
        <span aria-hidden="true">↔</span> <span class="badge reco">reco</span>{" "}
        {c(pair.reco, pair.candidate) ?? <span class="muted">no candidate</span>}
      </p>
      {eff && effTotal > 0 && (
        <div>
          <div class="pairhead">
            <b>Particle's energy</b>{" "}
            <span class="muted">
              {where ? `in ${where} · ` : ""}
              {short(effTotal)} GeV in the sensors
            </span>
          </div>
          {bar(effParts, effTotal)}
          {legend(effParts, effTotal)}
        </div>
      )}
      {pur && purTotal > 0 && (
        <div>
          <div class="pairhead">
            <b>Candidate's energy</b>
            {where && <span class="muted"> in {where}</span>}
          </div>
          {bar(purParts, purTotal)}
          {legend(purParts, purTotal)}
        </div>
      )}
      {pair.particle >= 0 && pair.matched >= 0 && pair.matched !== pair.particle && (
        <p class="hint">
          {c(pair.truth, pair.matched)} is part of the generator particle {c(pair.truth, pair.particle)}: the pair is
          the whole of it.
        </p>
      )}
      {pair.merged.length > 0 && (
        <p class="hint">
          {c(pair.truth, pair.particle)} decayed in the generator: the pair stands for the {pair.merged.length}{" "}
          generator particle{pair.merged.length > 1 ? "s" : ""} it decayed to
          {selectedTruth ? "" : ", which the candidate merges"}:{" "}
          {pair.merged.slice(0, 3).map((m) => (
            <> {c(pair.truth, m)}</>
          ))}
          {pair.merged.length > 3 ? " …" : ""}
        </p>
      )}
    </section>
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

/** Its columns: the layer's `inspect` columns (e.g. a jet's pT, η, φ), else what colours, places and sizes it, and the
 *  custom ones; all of them folded under. */
function Properties({ table, name, row }: { table: Table; name: string; row: number }) {
  const d = layerOf(name),
    key = keyColumns(name, table),
    n = Object.keys(table.columns).length;
  return (
    <section class="props">
      {d?.fractions && <Fractions fractions={d.fractions} table={table} row={row} />}
      <Rows name={name} table={table} row={row} columns={key} />
      {n > key.length && (
        <details class="allcolumns">
          <summary>All {n} columns</summary>
          <Rows name={name} table={table} row={row} columns={Object.keys(table.columns)} />
        </details>
      )}
    </section>
  );
}
/** A reco object's energy fractions (layer hint `fractions`, e.g. a jet's charged and neutral hadrons, photons...) as
 *  one bar, in a neutral ramp (a reconstruction quantity, not a colour of the views), with the shares named under it. */
function Fractions({ fractions, table, row }: { fractions: Record<string, string>; table: Table; row: number }) {
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
