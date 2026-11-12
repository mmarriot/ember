// The card of the selected object, the one place that says where it sits and what the truth says about it:
// - its chain (model/chain.ts): what it is part of, itself, what it is made of, each step with its link to the truth
//   in the same words (match, fact, derived, no truth); a click on a step's object moves the selection there, "show"
//   draws a step in the view (↓ ↑);
// - its match in numbers (purity and completeness as bars), the matched particle's place in the truth graph, and for
//   a truth object what was reconstructed from it;
// - the truth ↔ reco pair the view is coloured by, as two bars in the view's colours;
// - its columns.
import { useState } from "preact/hooks";
import { colourBy, customColumns, customDoc } from "../model/custom";
import { type Table, unitOf } from "../io/bundle";
import type { Link, Rung } from "../model/chain";
import { percent } from "../model/match";
import { PAIR } from "../model/pair";
import type { Ref } from "../model/relations";
import { PALETTES } from "../render/colour";
import { bundle, describe, domain, event, focusBar, focusHistory, focusLevel, full, highlight, kindOf, labelOf, ladder, layerKey, layerOf, modes, pairView, reconstructed, selection, shared, short, shownLevel, sizeColumn, stepName, theme, truthName, truthStatuses } from "../model/store";
import { facts, unitOf as factUnit } from "../model/facts";
import { engine } from "./Viewport";
import { back, chooseDomain, jump } from "./navigate";
import { Lineage, TruthCard } from "./Truth";
import { Icon } from "./widgets";

const INLINE = 3; // a step with at most this many objects names them; a longer one counts them and unfolds
const LISTED = 40; // objects listed in an unfolded step

const name = (r: Ref) => { const n = describe(r.table, r.row); return `${kindOf(r.table)}${n ? ` · ${n}` : ` #${r.row}`}`; };
const chip = (t: string, r: number, text?: string) => (
  <button class="chip" title={`${labelOf(t)} #${r}: go to it`} onClick={() => jump({ table: t, row: r })}>{text ?? (describe(t, r) || `#${r}`)}</button>
);
/** The rows of a table, largest first by its size column (e.g. energy), if it has one. */
function largestFirst(table: string, rows: number[]) {
  const t = event.value?.tables[table], c = t && sizeColumn(table, t), key = c ? t!.columns[c] : undefined;
  return key ? [...rows].sort((a, b) => Number(key[b]) - Number(key[a])) : rows;
}

export function Navigator() {
  const b = bundle.value, ev = event.value, sel = selection.value, hl = highlight.value;
  if (!b || !ev || !sel || !ev.tables[sel.table]) return null;
  const info = b.header.tables[sel.table], table = ev.tables[sel.table];
  const d = layerOf(sel.table), truth = !!d?.truth, text = describe(sel.table, sel.row), prev = focusHistory.value.at(-1);
  return (
    <div class="inspector" role="dialog" aria-label="Selected object">
      <header>
        <div>
          {prev && <button class="link backlink" onClick={back} title={`Back to ${name(prev)} (B)`}>← {name(prev)}</button>}
          <div class={truth ? "kind truth" : "kind"}>{labelOf(sel.table)}{truth && " (simulation)"}</div>
          <h2>#{sel.row}{text && <span class="describe"> · {text}</span>}</h2>
        </div>
        <div class="actions">
          <button class="icon-button" title="Zoom to it and its related objects (F)" onClick={() => hl && engine?.frame(hl, true)}><Icon name="focus" /></button>
          <button class="icon-button" title="Close (Esc)" onClick={() => (selection.value = null)}><Icon name="close" /></button>
        </div>
      </header>
      <p class="hint">{info.doc}</p>
      <div class="navbody">
        {truth ? <TruthSide table={sel.table} row={sel.row} /> : <RecoSide table={sel.table} row={sel.row} />}
        <PairBars />
        <Properties table={table} name={sel.table} row={sel.row} />
      </div>
    </div>
  );
}

/** A reco object: its chain with the truth link of every step, then its own match in numbers. */
function RecoSide({ table, row }: { table: string; row: number }) {
  const l = ladder.value;
  if (!l) return null;
  return (
    <>
      <section class="ladder" aria-label="Chain">
        <h4 title="Where it sits among the event's objects, and what the truth says at each step. Click an object to go to it.">
          Chain <span class="lanes"><span class="badge reco">reco</span>⇄<span class="badge truth">truth</span></span></h4>
        <ol>
          {l.above.length > 0 && <li class="part" title="The objects that contain it">part of</li>}
          {l.above.map((r) => <RungRow rung={r} role="above" key={`a|${r.kind}`} />)}
          <RungRow rung={l.self} role="self" />
          {l.below.length > 0 && <li class="part" title="What it is built from, from the largest objects down to the hits">made of</li>}
          {l.below.map((r) => <RungRow rung={r} role="below" key={`b|${r.kind}`} />)}
          {l.beside.length > 0 && <li class="part" title="Other objects built only from its parts (e.g. a secondary vertex whose tracks are all in this jet). They are not parts of it.">also inside it</li>}
          {l.beside.map((r) => <RungRow rung={r} role="beside" key={`s|${r.kind}`} />)}
        </ol>
      </section>
      <section class="matchcard"><TruthCard table={table} row={row} /></section>
    </>
  );
}

/** One step of the chain: its kind, its objects (named when few, else counted, unfolding to a list), whether the view
 *  shows it, and its truth links. */
function RungRow({ rung, role }: { rung: Rung; role: "above" | "self" | "below" | "beside" }) {
  const [open, setOpen] = useState(false);
  const tables = new Set(rung.groups.map((g) => g.table)), all = rung.groups.flatMap((g) => g.rows.map((r) => [g.table, r] as const));
  // The level of the focus this step is (store.ts levels): one drawn on request, or always (the smallest objects, lines).
  const level = role === "self" || role === "above" ? undefined : focusBar.value.bar.find((lv) => lv.layers.some((x) => tables.has(x.table)));
  const on = !!level && shownLevel.value === level.name;
  // A step in a part of the detector the view is not looking at: one click looks there, keeping the selection.
  const cur = domain.value, parts = [...new Set(rung.groups.map((g) => layerOf(g.table)?.domain).filter((x): x is string => !!x && !shared.value.has(x)))];
  const elsewhere = role !== "self" && cur && parts.length && !parts.includes(cur) ? parts[0] : undefined;
  const few = rung.count <= INLINE;
  return (
    <li class={`rung ${role}${on ? " shown" : ""}`}>
      <div class="rhead">
        <span class="rkind">{rung.kind}</span>
        {role === "self" ? <span class="here">this one</span>
          : few ? all.map(([t, r]) => chip(t, r))
          : <button class="link count" aria-expanded={open} title="List them" onClick={() => setOpen(!open)}>{rung.count.toLocaleString()} {open ? "▾" : "▸"}</button>}
        {rung.voted !== undefined && <span class="muted" title={`No relation names it: it is the one holding most of this object's parts (${percent(rung.voted)}), worked out in evd`}>≈ by its parts</span>}
        <span class="rtools">
          {elsewhere && <button class="link" title={`Look at ${elsewhere}, keeping the selection (D)`} onClick={() => chooseDomain(elsewhere)}>{elsewhere} ›</button>}
          {level && !level.always && !elsewhere && <button class={on ? "level on" : "level"} aria-pressed={on} title="Draw this step in the view (↓ ↑ step through them)"
            onClick={() => (focusLevel.value = on ? null : level.name)}>{on ? "shown" : "show"}</button>}
        </span>
      </div>
      {rung.links.map((link) => <LinkLine link={link} single={rung.count === 1} self={role === "self"} several={rung.links.filter((x) => x.kind === link.kind).length > 1} table={rung.groups[0]?.table} />)}
      {open && !few && (
        <div class="rlist">
          {rung.groups.map((g) => (
            <div>{rung.groups.length > 1 && <span class="muted">{layerOf(g.table)?.label} </span>}
              {largestFirst(g.table, g.rows).slice(0, LISTED).map((r) => chip(g.table, r))}{g.rows.length > LISTED && <span class="muted"> … {g.rows.length - LISTED} more</span>}</div>
          ))}
        </div>
      )}
    </li>
  );
}

const MEASURE: Record<string, string> = { hits: "hits", energy: "energy", pt2: "tracks' pT²" };

/** What the truth says about one step, in one line. Every line is that step's own statement: its objects' own
 *  matches, counted; the simulated energy in its own hits; never a match of the selected object through its parts. */
function LinkLine({ link, single, several, table, self = false }: { link: Link; single: boolean; several: boolean; table?: string; self?: boolean }) {
  const top = (truth: string, partners: [number, number][], text: (n: number) => string) => (
    <>{partners.slice(0, 3).map(([p, n]) => <>{chip(truth, p)}<span class="muted">{text(n)}</span></>)}{partners.length > 3 && <span class="muted"> +{partners.length - 3}</span>}</>
  );
  if (link.kind === "match") {
    const what = `${MEASURE[link.measure] ?? link.measure}`, rule = link.good !== undefined ? ` Clean: at least ${percent(link.good)} of its ${what} from the match.` : "";
    if (single) return link.matched ? (
      <div class="rlink match" title={`The CMSSW associator's best match for it.${rule}`}><span class="lk">match</span>{chip(link.truth, link.partners[0][0])}
        {link.purity !== undefined && <span class={link.good === undefined ? "" : link.clean ? "ok" : "warn"}>{percent(link.purity)} pure</span>}</div>
    ) : <div class="rlink match" title="The CMSSW associator matched no truth object to it"><span class="lk">match</span><span class="warn">no match</span></div>;
    return (
      <div class="rlink match" title={`Each one's own best match from the CMSSW associator, counted.${rule}`}><span class="lk">match</span>
        <span class={link.matched < link.of ? "warn" : ""}>{link.matched} of {link.of} matched</span>
        {link.good !== undefined && link.matched > 0 && <span class={link.clean < link.matched ? "warn" : "ok"}>{link.clean} clean</span>}
        {top(link.truth, link.partners, (n) => (n > 1 ? `×${n}` : ""))}</div>
    );
  }
  if (link.kind === "fact") {
    const f = table && bundle.value ? facts(bundle.value.header).find((x) => x.to === table) : undefined;
    const unit = single && f && table ? factUnit(f, event.value?.tables[table]?.columns, selection.value?.row ?? 0) : undefined;
    return (
      <div class="rlink fact" title={`Simulation: the share of the simulated energy in ${single ? "this hit" : "these hits"}${link.in ? ` (${link.in})` : ""} that each truth particle left, with its secondaries. Deposited in the sensors, not calibrated: compare only within one detector.${unit ? ` The simulation records it per ${unit}: every hit there shares these particles.` : ""}`}>
        <span class="lk">fact</span>{several && link.in && <span class="muted">{link.in}</span>}
        {link.particles.slice(0, 3).map(([p, share]) => <>{chip(link.truth, p)}<span class="muted">{percent(share)}</span></>)}
        {link.particles.length > 3 && <span class="muted"> +{link.particles.length - 3}</span>}{unit && <span class="muted">per {unit}</span>}</div>
    );
  }
  if (link.kind === "derived") return (
    <div class="rlink derived" title={`Derived in evd, not a CMSSW match: ${link.reason}${link.gap !== undefined ? ` (truth-graph.md gap ${link.gap})` : ""}`}><span class="lk">derived</span>
      {link.partners.length ? top(link.truth, link.partners, (n) => (single ? "" : `×${n}`)) : <span class="muted">no particle in {single ? "its" : "their"} hits</span>}</div>
  );
  if (link.kind === "none") return (
    <div class="rlink none" title={`${link.reason}${link.gap !== undefined ? ` (truth-graph.md gap ${link.gap})` : ""}. evd builds no match of its own; the steps below speak for themselves.`}>
      <span class="lk">no truth</span><span class="muted">{self ? link.reason : "for this kind yet"}{link.gap !== undefined && ` · gap ${link.gap}`}</span></div>
  );
  return <div class="rlink none" title="No truth of its own: it takes the colour of the object it belongs to"><span class="lk">no truth</span><span class="muted">of its own: with what contains it</span></div>;
}

/** A truth object: where it sits in the truth graph, what was reconstructed from it, and what has no link yet. */
function TruthSide({ table, row }: { table: string; row: number }) {
  const rec = reconstructed.value, root = modes.value.roots.truth;
  const gaps = [...new Set([...truthStatuses.value].filter(([, s]) => s.kind === "none").map(([t, s]) => `${truthName(t)}${s.kind === "none" && s.gap !== undefined ? ` (gap ${s.gap})` : ""}`))];
  return (
    <>
      {table === root && <section class="matchcard"><Lineage row={row} /></section>}
      {rec && (rec.reco.length > 0 || rec.hits.length > 0) && (
        <section class="ladder" aria-label="Reconstructed as">
          <h4 title="The reco objects that share hits or energy with it (CMSSW's truth to reco maps), most complete first, and the hits it left (simulation)">
            Reconstructed as <span class="lanes"><span class="badge truth">truth</span>⇄<span class="badge reco">reco</span></span></h4>
          <ol>
            {rec.reco.map((r) => {
              const of = r.measure === "hits" ? "hits" : r.measure === "pt2" ? "findable tracks (pT²)" : `energy${r.in ? ` in ${r.in}` : ""}`;
              return (
                <li class={r.partners.length ? "rung below" : "rung below empty"}>
                  <div class="rhead"><span class="rkind">{stepName(r.table)}</span>{!r.partners.length && <span class="muted" title={`No object of this kind shares ${r.measure === "hits" ? "hits" : "energy"} with it`}>none</span>}</div>
                  {r.partners.length > 0 && (
                    <div class="rlink match">
                      {r.partners.slice(0, 4).map((p) => (
                        <span class="partner" title={`${p.completeness !== undefined ? `It holds ${percent(p.completeness)} of this one's ${of}. ` : ""}${p.best ? "This is its own best match." : "Its own best match is another truth object."}`}>
                          {chip(r.table, p.row)}{p.completeness !== undefined && <span class="muted">{percent(p.completeness)}</span>}{p.best && <span class="ok" aria-label="its best match">★</span>}</span>
                      ))}
                      {r.partners.length > 4 && <span class="muted">+{r.partners.length - 4}</span>}
                    </div>
                  )}
                </li>
              );
            })}
            {rec.hits.map((h) => (
              <li class="rung below"><div class="rhead"><span class="rkind">Hits{h.in && ` · ${h.in}`}</span></div>
                <div class="rlink fact" title="Simulation: the hits it (with its secondaries) left energy in. Energy deposited in the sensors, not calibrated."><span class="lk">fact</span>
                  <span>{h.hits.toLocaleString()} hits</span>{h.energy > 0 && <span class="muted">{short(h.energy)} {h.weight === "simEnergy" ? "GeV in the sensors" : h.weight}</span>}</div></li>
            ))}
          </ol>
          <p class="hint">% is the share of it the object holds; ★ marks an object whose own best match it is.</p>
          {gaps.length > 0 && <details class="gaps"><summary>{gaps.length} kinds have no truth link yet</summary><p class="hint">{gaps.join(", ")}. See truth-graph.md; evd builds no match of its own.</p></details>}
        </section>
      )}
    </>
  );
}

/** The truth ↔ reco pair the view is coloured by (model/pair.ts): where the particle's energy went and what the
 *  candidate is made of, as two bars in the view's colours. */
function PairBars() {
  const pair = pairView.value, pal = PALETTES[theme.value];
  if (!pair) return null;
  const c = (t: string | undefined, r: number) => (t && r >= 0 ? chip(t, r) : null);
  const eff = pair.efficiency, effTotal = eff ? eff.candidate + eff.others + eff.missed : 0, pur = pair.purity, purTotal = pur ? pur.particle + pur.other : 0;
  const selectedTruth = !!selection.value && !!layerOf(selection.value.table)?.truth;
  const bar = (parts: [number, string, string][], total: number) => (
    <div class="pairbar">{parts.filter(([v]) => v > 0).map(([v, colour, label]) => <span style={{ width: `${(100 * v) / total}%`, background: colour }} title={`${label} ${percent(v / total)}`} />)}</div>
  );
  const legend = (parts: [number, string, string][], total: number) => (
    <div class="pairlegend">{parts.map(([v, colour, label]) => <span><i style={{ background: colour }} />{label} <b>{percent(total > 0 ? v / total : undefined)}</b></span>)}</div>
  );
  const effParts: [number, string, string][] = eff ? [[eff.candidate, pal.pair[PAIR.matched], "in its candidate"], [eff.others, pal.pair[PAIR.split], "split off"], [eff.missed, pal.pair[PAIR.missed], "missed"]] : [];
  const purParts: [number, string, string][] = pur ? [[pur.particle, pal.pair[PAIR.matched], "from the particle"], [pur.other, pal.pair[PAIR.contamination], "contamination"]] : [];
  return (
    <section class="pair" aria-label="Truth and reco pair">
      <h4 title="With something selected, the view is coloured by its pair: a generator particle and its best candidate, compared hit by hit">The view's colours: truth ↔ reco pair</h4>
      <p class="pairline"><span class="badge truth">truth</span> {c(pair.truth, pair.particle) ?? <span class="muted">no particle</span>}
        <span aria-hidden="true">↔</span> <span class="badge reco">reco</span> {c(pair.reco, pair.candidate) ?? <span class="muted">no candidate</span>}</p>
      {pair.particle < 0 && <p class="hint">{pair.truth ? "No truth particle is matched to this candidate" : "No truth in this file"}: its objects are shown as reconstructed
        (<i class="sw" style={{ background: pal.pair[PAIR.reco] }} />), nothing confirmed.</p>}
      {eff && effTotal > 0 && (
        <div title="Simulated energy of the generator particle and everything it made, in the candidates' detector, each hit counted once. Energy deposited in the sensors, not calibrated: compare it only with itself">
          <div class="pairhead"><b>Completeness</b> <span class="muted">where the particle's simulated energy went ({short(effTotal)} GeV in the sensors)</span></div>
          {bar(effParts, effTotal)}{legend(effParts, effTotal)}
        </div>
      )}
      {pur && purTotal > 0 && (
        <div title="Rechit energy of the candidate's hits; each hit counted for the particle that left the most simulated energy in it">
          <div class="pairhead"><b>Purity</b> <span class="muted">what the candidate's hit energy is from</span></div>
          {bar(purParts, purTotal)}{legend(purParts, purTotal)}
        </div>
      )}
      {pair.particle >= 0 && pair.matched >= 0 && pair.matched !== pair.particle &&
        <p class="hint">The selection's particle {c(pair.truth, pair.matched)} is part of the generator particle {c(pair.truth, pair.particle)}: the pair is the whole of it.</p>}
      {pair.merged.length > 0 && <p class="hint">{selectedTruth ? "" : "The selection is matched to "}{c(pair.truth, pair.particle)}{selectedTruth ? " is" : ","} above the generator particles (it decayed in
        the generator): the pair stands for the {pair.merged.length} generator particle{pair.merged.length > 1 ? "s" : ""} it decayed to{selectedTruth ? "" : ", which the candidate merges"}: {pair.merged.slice(0, 3).map((m) => <> {c(pair.truth, m)}</>)}{pair.merged.length > 3 ? " …" : "."}</p>}
    </section>
  );
}

/** Its columns: the layer's `inspect` columns (e.g. a jet's pT, η, φ), else what colours, places and sizes it, and the
 *  custom ones; all of them folded under. */
function Properties({ table, name, row }: { table: Table; name: string; row: number }) {
  const info = bundle.value!.header.tables[name], d = layerOf(name);
  const custom = customColumns.value.filter((c) => c.table === name).map((c) => c.name);
  const colour = d ? colourBy.value[layerKey(d)] ?? d.colour : undefined;
  const category = d && typeof d.colourBy === "object" && "category" in d.colourBy ? d.colourBy.category : undefined;
  const key = [...new Set([...(d?.inspect ?? [category, colour, ...(d?.position ?? []), sizeColumn(name, table)]), ...custom])].filter((c): c is string => !!c && c in table.columns);
  const doc = (c: string) => info.columns[c]?.doc ?? customDoc(name, c);
  const rows = (cols: string[]) => (
    <table class="kv"><tbody>
      {cols.map((c) => <tr title={doc(c)}><td>{custom.includes(c) ? <i>{c}</i> : c}</td><td>{full(table.columns[c][row])}</td><td class="unit">{unitOf(info.columns[c]?.doc)}</td></tr>)}
    </tbody></table>
  );
  const n = Object.keys(table.columns).length;
  return (
    <section class="props">
      {d?.fractions && <Fractions fractions={d.fractions} table={table} row={row} />}
      {rows(key)}
      {n > key.length && <details class="allcolumns"><summary>All {n} columns</summary>{rows(Object.keys(table.columns))}</details>}
    </section>
  );
}

/** A reco object's energy fractions (layer hint `fractions`, e.g. a jet's charged and neutral hadrons, photons...) as
 *  one bar, in a neutral ramp (a reconstruction quantity, not a colour of the views), with the shares named under it. */
function Fractions({ fractions, table, row }: { fractions: Record<string, string>; table: Table; row: number }) {
  const parts = Object.entries(fractions).filter(([c]) => c in table.columns)
    .map(([c, name]) => [name, Number(table.columns[c][row])] as const).filter(([, v]) => v >= 0.005);
  if (!parts.length) return null;
  const shade = (i: number) => `hsl(210, 8%, ${72 - (44 * i) / Math.max(1, parts.length - 1)}%)`;
  return (
    <div class="fractions" title="Energy fractions from the reconstruction (not truth)">
      <div class="fbar">{parts.map(([name, v], i) => <span style={{ width: `${100 * v}%`, background: shade(i) }} title={`${name} ${(100 * v).toFixed(0)}%`} />)}</div>
      <div class="flegend"><span class="badge reco">reco</span> energy:{parts.map(([name, v], i) => <span><i style={{ background: shade(i) }} />{name} {(100 * v).toFixed(0)}%</span>)}</div>
    </div>
  );
}
