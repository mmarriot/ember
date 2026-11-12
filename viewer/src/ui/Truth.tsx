// The inspector's truth sections (docs/truth.md), the same for every kind of object:
// - for a reco object, its truth card: what the kind reconstructs, the associator's best match, and how good that
//   match is in linear numbers (purity, completeness) next to the associator's own score, with the generator particle
//   it belongs to;
// - for a truth particle (and for a reco object's match), its lineage: where it sits in the truth graph, from the
//   collision down to its daughters, with the levels it belongs to and the reco objects matched to it.
// Every line says where it comes from: the simulation (fact), the CMSSW associator (a match, never "is"), or evd.
import type { Header } from "../io/bundle";
import { completeness, percent, quality, TARGETS, type TruthStatus } from "../model/match";
import { bestPartners, identities } from "../model/relations";
import { bundle, describe, event, kindOf, labelOf, layerOf, modes, short, truthName, truthStatuses } from "../model/store";
import { jump } from "./navigate";

/** Names of truth::LevelFlag bits worth showing on a particle (SimDataFormats/TruthInfo ParticleData.h). */
const LEVELS: [number, string, string][] = [
  [2, "generator particle", "stable at generator level: what came out of the collision, before the detector"],
  [3, "entered the calorimeter", "crossed from the tracker into the calorimeter (truth level CaloBoundary)"],
  [8, "b hadron", "weakly decaying hadron with a b quark"],
  [9, "c hadron", "weakly decaying hadron with a c quark"],
];
const ANCESTORS = 4; // ancestors listed above the particle; higher ones are folded into one line

const chip = (t: string, r: number) => <button class="chip" onClick={() => jump({ table: t, row: r })}>{describe(t, r) || named(t, r) || `#${r}`}</button>;
/** An object's name from its layer's categorical colouring (e.g. a truth vertex's reason: "decay"), for layers without
 *  a `describe` hint. */
function named(t: string, r: number) {
  const c = layerOf(t)?.colourBy, v = typeof c === "object" && "category" in c ? event.value?.tables[t]?.columns[c.category]?.[r] : undefined;
  if (v === undefined || typeof c !== "object" || !("category" in c) || !c.names) return "";
  const names = Array.isArray(c.names) ? Object.fromEntries(c.names) : c.names, name = names[String(v)];
  return name ? `${name} #${r}` : "";
}
const chipAs = (t: string, r: number, text: string) => <button class="chip" onClick={() => jump({ table: t, row: r })}>{text}</button>;
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
    return s?.kind === "none" ? <NoTruth table={table} row={row} /> : null;
  }
  const [name, info] = rels[0], rel = ev.relations[name], m = info.match!, target = info.to;
  const { partner, entry } = bestPartners(rel, info, true, ev.tables[table]?.n ?? 0);
  const p = partner[row], q = p >= 0 ? quality(ev, b.header, name, entry[row], row) : undefined;
  const unit = m.measure === "hits" ? "hits" : m.measure === "pt2" ? "of the pT² of its tracks" : "GeV";
  const amount = (x: number) => (m.measure === "hits" ? `${Math.round(x)}` : short(x));
  const c = p >= 0 ? completeness(ev, b.header, target, p, table, row) : undefined;
  const particles = target === truth, generator = p >= 0 && particles ? generatorOf(truth, p) : -1;
  return (
    <section class="truthcard">
      {m.target && <p class="hint"><span class="badge reco">reco</span> {labelOf(table)} reconstruct {TARGETS[m.target]}.</p>}
      {p < 0 ? <NoMatch table={table} row={row} truth={truth} /> : (
        <>
          <p class="truthline" title={`The truth-graph ${particles ? "particle (with everything it made)" : "vertex"} that the CMSSW associator picked for this object: AdaptiveNominal working point`}>
            <span class="badge truth">truth</span> associator's best match {particles ? chip(target, p) : <>truth vertex {chipAs(target, p, m.target === "interaction" ? collision(truth, target, p) : vertexName(truth, target, p))}</>}
            {!particles && distance(table, row, target, p) !== undefined && <span class="muted">{short(distance(table, row, target, p)!)} cm away</span>}</p>
          <div class="meters">
            {q?.purity !== undefined && (m.purity
              ? <Meter name="purity" value={q.purity} good={m.good} title="Share of this object's tracks (weighted by pT²) from the matched truth vertex" note={unit} />
              : <Meter name="purity" value={q.purity} good={m.good} title={`Share of this object's ${m.measure === "hits" ? "hits" : "rechit energy"} (${m.in}) that came from the particle`}
                  note={`${amount(q.shared)} of its ${amount(q.over!)} ${unit} from it`} />)}
            {c && <Meter name="completeness" value={c.value} title={m.measure === "hits" ? "Share of the particle's tracker hits, its secondaries' included, that are on this track" : `Share of the ${particles ? "particle's energy" : "truth vertex's tracks"} in ${c.match.in} that this object has`}
              note={`of the ${particles ? "particle's" : "truth vertex's"} ${c.match.measure === "hits" ? "tracker hits (with its secondaries')" : c.match.measure === "pt2" ? "findable tracks (pT²)" : `energy in ${c.match.in}`}`} />}
            {q?.score !== undefined && <p class="hint" title="The associator's ranking value: 0 is best. For calorimeter objects it is squared and energy weighted, so 1 − score is not a purity">
              score {short(q.score)} <span class="muted">· the associator's ranking, 0 best; not a fraction</span></p>}
          </div>
          {generator >= 0 && generator !== p && <p class="hint">The match is part of the generator particle {chip(truth, generator)}, whose colour it takes.</p>}
          {particles && generator === p && aboveLevel(truth, p) && <p class="hint">The match is above the generator particles (it decayed in the generator, e.g. a π⁰):
            this object merges the particles it decayed to.</p>}
          {particles && <Lineage row={p} compact />}
        </>
      )}
    </section>
  );
}

/** A purity or completeness as a bar (linear, 0 to 100%), with what it counts; `good`: the kind's clean-match
 *  threshold, marked on the bar, which is green from there and amber below. */
function Meter({ name, value, good, title, note }: { name: string; value: number; good?: number; title: string; note: string }) {
  const state = good === undefined ? "" : value >= good ? "ok" : "warn";
  return (
    <div class="meter" title={`${title}${good !== undefined ? `. Clean from ${percent(good)}` : ""}`}>
      <span class="mname">{name}</span>
      <span class="mbar"><i class={state} style={{ width: `${Math.round(100 * Math.min(1, Math.max(0, value)))}%` }} />{good !== undefined && <u style={{ left: `${100 * good}%` }} />}</span>
      <b>{percent(value)}</b>
      <span class="muted mnote">{note}{good !== undefined && ` · ${value >= good ? "clean match" : "impure"} (clean from ${percent(good)})`}</span>
    </div>
  );
}

/** A kind with no truth of its own: the one constituent's own match where one part speaks for it (why the kind has
 *  none is said on its step of the chain). */
function NoTruth({ table, row }: { table: string; row: number }) {
  return <Constituent table={table} row={row} truth={modes.value.roots.truth!} />;
}

/** No match for the object itself: say so, and give the match of its single part (e.g. a track-only candidate's
 *  track), which is the associator's answer for that part, not for the object. */
function NoMatch({ table, row, truth }: { table: string; row: number; truth: string }) {
  return (
    <>
      <p class="truthline"><span class="badge truth">truth</span> no match from the associator</p>
      <Constituent table={table} row={row} truth={truth} />
    </>
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
      if (partner[part] >= 0) return <p class="hint">Its {one(info.to)} {chip(info.to, part)} is matched to {chip(truth, partner[part])} (the associator's answer for that {one(info.to)}, not for this {one(table)}).</p>;
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
  const claims = claimsOf(b.header, truth, new Set(chain.concat(children)));
  const levels = (r: number) => (flags ? LEVELS.filter(([bit]) => (Number(flags[r]) >>> bit) & 1) : []);
  const line = (r: number, depth: number) => (
    <li style={{ paddingLeft: `${depth * 10}px` }} class={r === row ? "here" : undefined}>
      {depth > 0 && <span class="muted">└ </span>}{chip(truth, r)}
      {r === row && <span class="muted"> ← {compact ? "the match" : "this one"}</span>}
      {levels(r).map(([, name, what]) => <span class="badge level" title={what}>{name}</span>)}
      {(claims.get(r) ?? []).slice(0, 3).map(([tab, o]) => <span class="muted"> · {labelOf(tab).split(" · ")[0].toLowerCase()} {chip(tab, o)}</span>)}
    </li>
  );
  const entered = flags ? children.filter((c) => (Number(flags[c]) >>> 3) & 1).length : 0;
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
  return (
    <div class="lineage" title="Where it sits in the truth graph: its ancestors, itself and its daughters (simulation); the reco objects whose best match a particle is (associator)">
      {!compact && <p class="truthline"><span class="badge truth">truth</span> lineage in the truth graph</p>}
      <ul class="matches">
        {folded > 0 && <li class="muted">… {folded} earlier step{folded > 1 ? "s" : ""} up to the collision{lastParton >= 0 ? " (quarks and gluons of the generator)" : ""}</li>}
        {shown.map((r, k) => line(r, k))}
        {children.length > 0 && <li class="muted" style={{ paddingLeft: `${shown.length * 10}px` }}>└ {children.length} daughter{children.length > 1 ? "s" : ""}
          {entered > 0 && `, ${entered} entered the calorimeter`}{!compact && <> {children.slice(0, 4).map((c) => chip(truth, c))}{children.length > 4 && " …"}</>}</li>}
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
