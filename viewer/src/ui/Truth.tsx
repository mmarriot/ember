// The truth sections of the selection's card (ui/Navigator.tsx; docs/truth.md), the same for every kind of object:
// - for a reco object, its truth card: what the kind reconstructs, the associator's best match, and how good that
//   match is in linear numbers (purity, completeness) next to the associator's own score, with the generator particle
//   it belongs to;
// - for a truth particle (and for a reco object's match), its lineage: where it sits in the truth graph, from the
//   collision down to its daughters, with the levels it belongs to and the reco objects matched to it.
// Every line says where it comes from: the simulation (fact), the CMSSW associator (a match, never "is"), or evd.
import type { Header } from "../io/bundle";
import { completeness, percent, quality, TARGETS, type TruthStatus } from "../model/match";
import { bestPartners, identities } from "../model/relations";
import { signal } from "@preact/signals";
import { matchTally } from "../model/chain";
import { bundle, describe, event, kindOf, labelOf, largestFirst, layerOf, modes, short, stepName, truthName, truthStatuses } from "../model/store";
import { passing } from "./Layers";
import { ObjChip } from "./chips";
import { Info } from "./Info";
import { jump } from "./navigate";

/** Names of truth::LevelFlag bits worth showing on a particle (SimDataFormats/TruthInfo ParticleData.h). */
const LEVELS: [number, string, string][] = [
  [2, "generator particle", "stable at generator level: what came out of the collision, before the detector"],
  [3, "entered the calorimeter", "crossed from the tracker into the calorimeter (truth level CaloBoundary)"],
  [8, "b hadron", "weakly decaying hadron with a b quark"],
  [9, "c hadron", "weakly decaying hadron with a c quark"],
];
const ANCESTORS = 4; // ancestors listed above the particle; higher ones are folded into one line

const chip = (t: string, r: number) => <ObjChip table={t} row={r} text={describe(t, r) || named(t, r) || undefined} />;
/** An object's name from its layer's categorical colouring (e.g. a truth vertex's reason: "decay"), for layers without
 *  a `describe` hint. */
function named(t: string, r: number) {
  const c = layerOf(t)?.colourBy, v = typeof c === "object" && "category" in c ? event.value?.tables[t]?.columns[c.category]?.[r] : undefined;
  if (v === undefined || typeof c !== "object" || !("category" in c) || !c.names) return "";
  const names = Array.isArray(c.names) ? Object.fromEntries(c.names) : c.names, name = names[String(v)];
  return name ? `${name} #${r}` : "";
}
const chipAs = (t: string, r: number, text: string) => <ObjChip table={t} row={r} text={text} />;
/** A collision's truth vertex, by whether it is the signal (the truth particles' `first` column, e.g. isSignal, on the
 *  vertex table too): what a primary vertex's match means, not its generator step (e.g. "shower branching"). */
function collision(truth: string, t: string, r: number) {
  const first = layerOf(truth)?.particle?.first, v = first ? event.value?.tables[t]?.columns[first]?.[r] : undefined;
  return v === undefined ? `#${r}` : `${Number(v) ? "signal collision" : "pile-up collision"} #${r}`;
}
/** Any other truth vertex: its name (e.g. its reason, "decay"), marked when it belongs to a pile-up collision. */
function vertexName(truth: string, t: string, r: number) {
  const first = layerOf(truth)?.particle?.first, v = first ? event.value?.tables[t]?.columns[first]?.[r] : undefined;
  return `${describe(t, r) || named(t, r) || `#${r}`}${v !== undefined && !Number(v) ? " (pile-up)" : ""}`;
}
/** How far apart two objects are, from their layers' positions (cm); undefined without them. */
function distance(a: string, ra: number, b: string, rb: number) {
  const ev = event.value, pa = layerOf(a)?.position, pb = layerOf(b)?.position;
  if (!ev || !pa || !pb) return undefined;
  const ca = ev.tables[a]?.columns, cb = ev.tables[b]?.columns;
  if (!ca || !cb || ![...pa.map((c) => ca[c]), ...pb.map((c) => cb[c])].every(Boolean)) return undefined;
  return Math.hypot(...[0, 1, 2].map((i) => Number(ca[pa[i]][ra]) - Number(cb[pb[i]][rb])));
}

/** The reco -> truth relations that carry a `match` contract, from `table` (to the truth particles, or to the truth
 *  vertices for vertices). */
const matchRelations = (header: Header, table: string) =>
  Object.entries(header.relations).filter(([, r]) => (r.match?.shared ?? r.match?.purity) && r.from === table && !!layerOf(r.to)?.truth);

/** The truth card of reco object `row` of `table`: for a kind with an association, its best match and how good it is;
 *  for a kind with no truth of its own, why (docs/truth.md "Where truth stops"); null otherwise. */
export function TruthCard({ table, row }: { table: string; row: number }) {
  const b = bundle.value, ev = event.value, truth = modes.value.roots.truth;
  if (!b || !ev || !truth) return null;
  const rels = matchRelations(b.header, table).filter(([name]) => ev.relations[name]);
  if (!rels.length) {
    const s = truthStatuses.value.get(table);
    return s?.kind === "none" ? <Constituent table={table} row={row} truth={truth} /> : null; // why it has none: on its step of the chain
  }
  const [name, info] = rels[0], rel = ev.relations[name], m = info.match!, target = info.to;
  const { partner, entry } = bestPartners(rel, info, true, ev.tables[table]?.n ?? 0);
  const p = partner[row], q = p >= 0 ? quality(ev, b.header, name, entry[row], row) : undefined;
  const unit = m.measure === "hits" ? "hits" : m.measure === "pt2" ? "of the pT² of its tracks" : "GeV";
  const amount = (x: number) => (m.measure === "hits" ? `${Math.round(x)}` : short(x));
  const c = p >= 0 ? completeness(ev, b.header, target, p, table, row) : undefined;
  const particles = target === truth, generator = p >= 0 && particles ? generatorOf(truth, p) : -1;
  const what = m.measure === "hits" ? "hits" : m.measure === "pt2" ? "tracks (weighted by pT²)" : `rechit energy in ${m.in}`;
  const help = (
    <>
      {m.target && <p>{labelOf(table)} reconstruct {TARGETS[m.target]}.</p>}
      <p>The match is the best one CMSSW's associator found for this object (AdaptiveNominal working point){particles ? ": a truth particle with everything it made" : ""}.</p>
      <p><b>Purity</b>: the share of this object's {what} that comes from its match.{m.good !== undefined && ` Clean from ${percent(m.good)} (the mark on the bar).`}</p>
      {c && <p><b>Completeness</b>: the share of the match's {c.match.measure === "hits" ? "tracker hits, its secondaries' included," : c.match.measure === "pt2" ? "findable tracks (pT²)" : `energy in ${c.match.in}`} that this object has.</p>}
      {q?.score !== undefined && <p>The associator's own score is {short(q.score)}: a ranking, 0 best, not a fraction.</p>}
      {p < 0 && <p>No match: a fake, or an object the associator does not consider (e.g. a candidate without calorimeter energy).</p>}
    </>
  );
  return (
    <section class="truthcard">
      <p class="truthline"><span class="badge truth">truth</span> {p < 0 ? <span class="q q-unmatched">no match</span>
        : <>match {particles ? chip(target, p) : chipAs(target, p, m.target === "interaction" ? collision(truth, target, p) : vertexName(truth, target, p))}</>}
        {p >= 0 && !particles && distance(table, row, target, p) !== undefined && <span class="muted">{short(distance(table, row, target, p)!)} cm away</span>}
        <Info title="Truth match">{help}</Info></p>
      {p < 0 ? <Constituent table={table} row={row} truth={truth} /> : (
        <>
          <div class="meters">
            {q?.purity !== undefined && <Meter name="purity" value={q.purity} good={m.good} note={m.purity ? "of its tracks' pT²" : `${amount(q.shared)} of ${amount(q.over!)} ${unit}`} />}
            {c && <Meter name="completeness" value={c.value} note={`of the ${particles ? "particle's" : "truth vertex's"} ${c.match.measure === "hits" ? "tracker hits" : c.match.measure === "pt2" ? "tracks (pT²)" : `energy in ${c.match.in}`}`} />}
          </div>
          {generator >= 0 && generator !== p && <p class="hint">part of generator particle {chip(truth, generator)}</p>}
          {particles && generator === p && aboveLevel(truth, p) && <p class="hint" title="The match decayed in the generator (e.g. a π⁰): it is above the generator particles">merges the generator particles its match decayed to</p>}
          {particles && <Lineage row={p} compact />}
        </>
      )}
    </section>
  );
}

/** A purity or completeness as a bar (linear, 0 to 100%), with what it counts under it; `good`: the kind's clean-match
 *  threshold, marked on the bar, which is green from there and amber below. */
function Meter({ name, value, good, note }: { name: string; value: number; good?: number; note: string }) {
  const state = good === undefined ? "" : value >= good ? "clean" : "impure";
  return (
    <div class="meter">
      <span class="mname">{name}</span>
      <span class="mbar"><i class={state && `q-${state}`} style={{ width: `${Math.round(100 * Math.min(1, Math.max(0, value)))}%` }} />{good !== undefined && <u style={{ left: `${100 * good}%` }} />}</span>
      <b>{percent(value)}</b>
      <span class="muted mnote">{note}{state && <> · <span class={`q q-${state}`}>{state}</span></>}</span>
    </div>
  );
}

/** One object of `table`'s kind, in running text: "track", "PF candidate", "MET". */
const one = (table: string) => kindOf(table).replace(/s$/, "").split(" ").map((w) => (/^[A-Z][a-z]/.test(w) ? w.toLowerCase() : w)).join(" ");

/** The own match of one constituent, named as the constituent's (docs/truth.md "Constituents"): only where a relation
 *  of what it is made of gives exactly one part (a muon's inner track, a candidate's track), never an association or a
 *  pointer back up, never aggregated over several parts; the first such part in the header's order. */
function Constituent({ table, row, truth }: { table: string; row: number; truth: string }) {
  const b = bundle.value!, ev = event.value!;
  for (const [relName, info] of Object.entries(b.header.relations)) {
    const rel = ev.relations[relName];
    if (info.association || info.inverseOf || info.from !== table || info.to === table || !rel || row + 1 >= rel.offsets.length) continue;
    if (rel.offsets[row + 1] - rel.offsets[row] !== 1) continue; // only a single part speaks for it
    const part = rel.indices[rel.offsets[row]];
    for (const [name, m] of matchRelations(b.header, info.to)) {
      const r = ev.relations[name];
      if (!r || m.to !== truth) continue;
      const { partner } = bestPartners(r, m, true, ev.tables[info.to]?.n ?? 0);
      if (partner[part] >= 0) return <p class="hint">its {one(info.to)} {chip(info.to, part)} is matched to {chip(truth, partner[part])} <Info title={`Its ${one(info.to)}'s match`}>
        <p>This is the associator's answer for that {one(info.to)}, not for this {one(table)}: CMSSW has no match for the {one(table)} itself, and evd builds none from its parts.</p></Info></p>;
    }
  }
  return null;
}

/** Whether truth row `row` is outside the particle level (e.g. a π⁰ or a B decayed by the generator). */
function aboveLevel(truth: string, row: number) {
  const d = layerOf(truth), flags = d?.particle ? event.value?.tables[truth]?.columns[d.particle.flags] : undefined;
  return !!flags && !((Number(flags[row]) >>> d!.particle!.bit) & 1);
}

/** The generator particle a truth row belongs to (its colour key; docs/truth.md), -1 without truth. */
function generatorOf(truth: string, row: number) {
  const b = bundle.value, ev = event.value, d = layerOf(truth);
  if (!b || !ev || !d || !ev.tables[truth]) return -1;
  return identities(d, ev.tables[truth], ev, b.header, 0).key[row];
}

/** Where truth particle `row` sits in the truth graph: its ancestors (the highest folded), itself, and a summary of
 *  its daughters, each with the levels it belongs to and the reco objects whose best match it is. `compact`: under a
 *  reco object's card. */
export function Lineage({ row, compact = false }: { row: number; compact?: boolean }) {
  const b = bundle.value, ev = event.value, truth = modes.value.roots.truth, d = truth ? layerOf(truth) : undefined;
  if (!b || !ev || !truth || !d || !ev.tables[truth]) return null;
  const t = ev.tables[truth], { parent } = identities(d, t, ev, b.header, 0), flags = d.particle ? t.columns[d.particle.flags] : undefined;
  const chain: number[] = [];
  for (let a = row, steps = 0; a >= 0 && steps < t.n; a = parent[a], steps++) chain.unshift(a);
  // Generator internals (quarks, gluons, diquarks, generator codes) are folded: the lineage starts below the last one.
  const pdg = t.columns.pdgId, parton = (r: number) => { // quarks, gluons, generator codes (81-100), diquarks (e.g. 2101)
    const id = Math.abs(Number(pdg[r]));
    return id <= 8 || id === 21 || (id >= 81 && id <= 100) || (id > 1000 && id < 6000 && Math.floor(id / 10) % 10 === 0);
  };
  const lastParton = pdg ? chain.slice(0, -1).map(parton).lastIndexOf(true) : -1;
  const physical = chain.slice(lastParton + 1), shown = physical.slice(-1 - ANCESTORS), folded = chain.length - shown.length;
  const children: number[] = [];
  for (let i = 0; i < t.n; i++) if (parent[i] === row) children.push(i);
  const levels = (r: number) => (flags ? LEVELS.filter(([bit]) => (Number(flags[r]) >>> bit) & 1) : []);
  // Under a reco object's card: one line from the collision down to the match (select the particle for the rest).
  if (compact) return (
    <div class="lineage crumb" title="Where the match sits in the truth graph, from the collision down (simulation). Click a particle to go to it; X goes to the match">
      <span class="badge truth">truth</span><span class="muted">chain</span>
      {folded > 0 && <span class="muted" title={`${folded} earlier step${folded > 1 ? "s" : ""} up to the collision${lastParton >= 0 ? " (quarks and gluons of the generator)" : ""}`}>… ›</span>}
      {shown.map((r, k) => <>{k > 0 && <span class="muted" aria-hidden="true">›</span>}<span class={r === row ? "here" : undefined}>{chip(truth, r)}</span>
        {r === row && levels(r).map(([, name, what]) => <span class="badge level" title={what}>{name}</span>)}</>)}
      {children.length > 0 && <span class="muted">› {children.length} daughter{children.length > 1 ? "s" : ""}</span>}
    </div>
  );
  const claims = claimsOf(b.header, truth, new Set(chain.concat(children)));
  const line = (r: number, depth: number) => (
    <li style={{ paddingLeft: `${depth * 10}px` }} class={r === row ? "here" : undefined}>
      {depth > 0 && <span class="muted">└ </span>}{chip(truth, r)}
      {r === row && <span class="muted"> ← this one</span>}
      {levels(r).map(([, name, what]) => <span class="badge level" title={what}>{name}</span>)}
      {(claims.get(r) ?? []).slice(0, 3).map(([tab, o]) => <span class="muted"> · {labelOf(tab).split(" · ")[0].toLowerCase()} {chip(tab, o)}</span>)}
    </li>
  );
  const entered = flags ? children.filter((c) => (Number(flags[c]) >>> 3) & 1).length : 0;
  return (
    <div class="lineage" title="Where it sits in the truth graph: its ancestors, itself and its daughters (simulation); the reco objects whose best match a particle is (associator)">
      <p class="truthline"><span class="badge truth">truth</span> lineage <Info title="Lineage">
        <p>Where the particle sits in the truth graph (simulation): its ancestors, itself, its daughters.</p>
        <p>The tags are the levels a particle belongs to; the objects named beside a particle are the reco objects whose best match it is (CMSSW's associator).</p></Info></p>
      <ul class="matches">
        {folded > 0 && <li class="muted" title={`Up to the collision${lastParton >= 0 ? ": the generator's quarks and gluons" : ""}`}>… {folded} earlier step{folded > 1 ? "s" : ""}</li>}
        {shown.map((r, k) => line(r, k))}
        {children.length > 0 && <li class="muted" style={{ paddingLeft: `${shown.length * 10}px` }}>└ {children.length} daughter{children.length > 1 ? "s" : ""}
          {entered > 0 && `, ${entered} entered the calorimeter`} {children.slice(0, 4).map((c) => chip(truth, c))}{children.length > 4 && " …"}</li>}
      </ul>
    </div>
  );
}

/** For each of `rows`, the reco objects whose best match it is (through every reco -> truth association). */
function claimsOf(header: Header, truth: string, rows: Set<number>) {
  const ev = event.value!, out = new Map<number, [string, number][]>();
  for (const [name, info] of Object.entries(header.relations)) {
    const rel = ev.relations[name];
    if (!rel || !info.association || info.to !== truth || info.from === truth || layerOf(info.from)?.alternative) continue;
    const { partner } = bestPartners(rel, info, true, ev.tables[info.from]?.n ?? 0);
    for (let o = 0; o < partner.length; o++) if (rows.has(partner[o])) out.set(partner[o], [...(out.get(partner[o]) ?? []), [info.from, o]]);
  }
  return out;
}

/** The count unfolded in the scorecard: "<table>|<class>". */
const opened = signal<string | null>(null);
const CLASSES = [["clean", "q-clean", "a best match with purity at or above the kind's threshold"], ["impure", "q-impure", "a best match below the threshold: merged with, or mostly from, something else"],
  ["unmatched", "q-unmatched", "no match from the associator: a fake, or an object the associator does not consider (e.g. a candidate without calorimeter energy)"]] as const;

/** The Truth tab's scorecard: for each reco kind the CMSSW associator matches, how many of the objects that pass their
 *  cuts and filters are a clean match, an impure one, or unmatched (model/chain.ts matchTally). A count unfolds to its
 *  objects, largest first: the event's fakes and merges, one click away. */
export function Scorecard() {
  const b = bundle.value, ev = event.value, statuses = truthStatuses.value;
  if (!b || !ev || !modes.value.roots.truth) return null;
  const rows = b.header.display.filter((d, i, all) => !d.truth && !d.context && !d.alternative && all.findIndex((x) => x.table === d.table) === i).flatMap((d) => {
    const s = statuses.get(d.table), p = s?.kind === "match" ? passing(d) : null, tally = s?.kind === "match" && p ? matchTally(ev, b.header, s.relation, p.pass) : null;
    return tally && s?.kind === "match" ? [{ d, tally, match: s.match }] : [];
  });
  if (!rows.length) return null;
  return (
    <section class="scorecard">
      <h3>Reco ↔ truth in this event <Info title="Reco ↔ truth in this event">
        <p>For each kind of reco object that CMSSW's associator matches to the truth: how many of the objects drawn (passing their cuts and filters) are a clean match, an impure one, or have none.</p>
        <p>Click a number to list those objects, largest first; click one to select it.</p>
        <p>Kinds without an associator are under Truth coverage.</p></Info></h3>
      <table class="score">
        <thead><tr><th />{CLASSES.map(([name, , what]) => <th title={what}>{name === "unmatched" ? "no match" : name}</th>)}</tr></thead>
        <tbody>
          {rows.map(({ d, tally, match }) => {
            const open = CLASSES.find(([name]) => opened.value === `${d.table}|${name}`)?.[0], list = open ? largestFirst(d.table, tally[open]) : [];
            return (
              <>
                <tr>
                  <td title={`${match.target ? `They reconstruct ${TARGETS[match.target]}. ` : ""}${tally.good !== undefined ? `Clean: at least ${percent(tally.good)} of its ${match.measure === "hits" ? "hits" : match.measure === "pt2" ? "tracks' pT²" : "energy"} from its match.` : ""}`}>{stepName(d.table)}</td>
                  {CLASSES.map(([name, cls]) => {
                    const k = `${d.table}|${name}`, n = tally[name].length;
                    return <td><button class={`num ${n ? cls : "zero"}`} disabled={!n} aria-expanded={opened.value === k} title={n ? "List them" : undefined}
                      onClick={() => (opened.value = opened.value === k ? null : k)}>{n.toLocaleString()}</button></td>;
                  })}
                </tr>
                {open && <tr class="list"><td colSpan={4}>{list.slice(0, 40).map((r) => <button class={`chip q-${open}`} onClick={() => jump({ table: d.table, row: r })}>{describe(d.table, r) || `#${r}`}</button>)}{list.length > 40 && <span class="muted"> … {list.length - 40} more</span>}</td></tr>}
              </>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** The Truth tab's first section: what the truth graph says about each kind drawn from this bundle (docs/truth.md
 *  "Where truth stops"), in the words of the inspector and the colour key. */
export function Coverage() {
  const b = bundle.value, statuses = truthStatuses.value;
  if (!b || !modes.value.roots.truth) return null;
  const seen = new Set<string>(), rows: [string, TruthStatus][] = [];
  for (const d of b.header.display) {
    const s = statuses.get(d.table), kind = truthName(d.table);
    if (!s || d.context || d.alternative || seen.has(kind)) continue;
    seen.add(kind);
    rows.push([kind, s]);
  }
  const gap = (n?: number) => (n !== undefined ? ` (truth-graph.md gap ${n})` : "");
  const what = (s: TruthStatus) => s.kind === "match"
    ? [`matched by CMSSW`, `${s.match.target ? `reconstruct ${TARGETS[s.match.target]}; ` : ""}clean from ${percent(s.match.good)} of its ${s.match.measure === "hits" ? "hits" : s.match.measure === "pt2" ? "tracks' pT²" : "energy"}${s.match.in ? ` (${s.match.in})` : ""}`]
    : s.kind === "fact" ? ["simulation fact", `simulated energy per particle in each hit${s.in ? ` (${s.in})` : ""}${s.unit ? `, recorded per ${typeof s.unit === "string" ? s.unit : Object.values(s.unit.names).join(", ")}` : ""}`]
    : s.kind === "derived" ? ["derived in evd", `${s.reason}${gap(s.gap)}`]
    : s.kind === "container" ? ["with what contains it", "no truth of its own: drawn in the colour of the object it belongs to"]
    : ["no truth for this kind", `${s.reason}${gap(s.gap)}`];
  // Folded to one line of counts (e.g. "7 matched · 9 no truth"): the list is long, and the collections come after it.
  const counts = (["match", "fact", "derived", "container", "none"] as const).map((k) => [k, rows.filter(([, st]) => st.kind === k).length] as const).filter(([, n]) => n);
  const SHORT = { match: "matched", fact: "fact", derived: "derived", container: "via container", none: "no truth" };
  return (
    <section class="coverage">
      <details>
        <summary><h3>Truth coverage</h3> <span class="count">{counts.map(([k, n]) => `${n} ${SHORT[k]}`).join(" · ")}</span></summary>
        <p class="hint">What the truth graph says about each kind: matched by CMSSW's associator, a simulation fact, or derived in evd. Where
          it has no answer, evd builds none.</p>
        <ul class="coverage">
          {rows.map(([kind, s]) => {
            const [word, detail] = what(s), why = s.kind === "none" || s.kind === "derived";
            return <li class={s.kind === "none" ? "none" : undefined} title={detail}><span class="kindname">{kind}</span> {word}{why && <span class="muted">: {detail}</span>}</li>;
          })}
        </ul>
      </details>
    </section>
  );
}
