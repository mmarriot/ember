// The inspector's truth sections (docs/truth.md), the same for every kind of object:
// - for a reco object, its truth card: what the kind reconstructs, the associator's best match, and how good that
//   match is in linear numbers (purity, completeness) next to the associator's own score, with the generator particle
//   it belongs to;
// - for a truth particle (and for a reco object's match), its lineage: where it sits in the truth graph, from the
//   collision down to its daughters, with the levels it belongs to and the reco objects matched to it.
// Every line says where it comes from: the simulation (fact), the CMSSW associator (a match, never "is"), or evd.
import type { Header } from "../io/bundle";
import { completeness, percent, quality, TARGETS } from "../model/match";
import { bestPartners, identities } from "../model/relations";
import { bundle, describe, event, kindOf, labelOf, layerOf, modes, short } from "../model/store";
import { jump } from "./navigate";

/** Names of truth::LevelFlag bits worth showing on a particle (SimDataFormats/TruthInfo ParticleData.h). */
const LEVELS: [number, string, string][] = [
  [2, "generator particle", "stable at generator level: what came out of the collision, before the detector"],
  [3, "entered the calorimeter", "crossed from the tracker into the calorimeter (truth level CaloBoundary)"],
  [8, "b hadron", "weakly decaying hadron with a b quark"],
  [9, "c hadron", "weakly decaying hadron with a c quark"],
];
const ANCESTORS = 4; // ancestors listed above the particle; higher ones are folded into one line

const chip = (t: string, r: number) => <button class="chip" onClick={() => jump({ table: t, row: r })}>{describe(t, r) || `#${r}`}</button>;

/** The reco -> truth relations that carry a `match` contract, from `table`. */
const matchRelations = (header: Header, table: string, truth: string) =>
  Object.entries(header.relations).filter(([, r]) => r.match?.shared && r.from === table && r.to === truth);

/** The truth card of reco object `row` of `table`, or null if its kind has no truth association. */
export function TruthCard({ table, row }: { table: string; row: number }) {
  const b = bundle.value, ev = event.value, truth = modes.value.roots.truth;
  if (!b || !ev || !truth) return null;
  const rels = matchRelations(b.header, table, truth).filter(([name]) => ev.relations[name]);
  if (!rels.length) return null;
  const [name, info] = rels[0], rel = ev.relations[name], m = info.match!;
  const { partner, entry } = bestPartners(rel, info, true, ev.tables[table]?.n ?? 0);
  const p = partner[row], q = p >= 0 ? quality(ev, b.header, name, entry[row], row) : undefined;
  const unit = m.measure === "hits" ? "hits" : "GeV";
  const amount = (x: number) => (m.measure === "hits" ? `${Math.round(x)}` : short(x));
  const c = p >= 0 ? completeness(ev, b.header, truth, p, table, row) : undefined;
  const generator = p >= 0 ? generatorOf(truth, p) : -1;
  return (
    <section class="truthcard">
      {m.target && <p class="hint"><span class="badge reco">reco</span> {labelOf(table)} reconstruct {TARGETS[m.target]}.</p>}
      {p < 0 ? <NoMatch table={table} row={row} truth={truth} /> : (
        <>
          <p class="truthline" title="The truth-graph particle (with everything it made) that the CMSSW associator picked for this object: AdaptiveNominal working point">
            <span class="badge truth">truth</span> associator's best match {chip(truth, p)}</p>
          <ul class="quality">
            {q?.purity !== undefined && <li title={`Share of this object's ${m.measure === "hits" ? "hits" : "rechit energy"} (${m.in}) that came from the particle`}>
              <b>purity {percent(q.purity)}</b> <span class="muted">{amount(q.shared)} of its {amount(q.over!)} {unit} from it{q.clean !== undefined && <> · {q.clean ? "clean match" : "impure"} (clean from {percent(m.good)})</>}</span></li>}
            {c && <li title={m.measure === "hits" ? "Share of the particle's tracker hits, its secondaries' included, that are on this track" : `Share of the particle's energy in ${c.match.in} that this object has`}>
              <b>completeness {percent(c.value)}</b> <span class="muted">of the particle's {c.match.measure === "hits" ? "tracker hits (with its secondaries')" : `energy in ${c.match.in}`}</span></li>}
            {q?.score !== undefined && <li title="The associator's ranking value: 0 is best. For calorimeter objects it is squared and energy weighted, so 1 − score is not a purity">
              <b>score {short(q.score)}</b> <span class="muted">the associator's ranking, 0 best; not a fraction</span></li>}
          </ul>
          {generator >= 0 && generator !== p && <p class="hint">The match is part of the generator particle {chip(truth, generator)}, whose colour it takes.</p>}
          <Lineage row={p} compact />
        </>
      )}
    </section>
  );
}

/** No match for the object itself: say so, and give the matches of its single parts (e.g. a track-only candidate's
 *  track), which are the associator's answers for those parts, not for the object. */
function NoMatch({ table, row, truth }: { table: string; row: number; truth: string }) {
  const b = bundle.value!, ev = event.value!, parts: [string, number, number][] = [];
  for (const [relName, info] of Object.entries(b.header.relations)) {
    const rel = ev.relations[relName];
    if (info.association || info.from !== table || info.to === table || !rel || row + 1 >= rel.offsets.length) continue;
    if (rel.offsets[row + 1] - rel.offsets[row] !== 1) continue; // only a single part (e.g. its track) speaks for it
    const part = rel.indices[rel.offsets[row]];
    for (const [name, m] of matchRelations(b.header, info.to, truth)) {
      const r = ev.relations[name];
      if (!r) continue;
      const { partner } = bestPartners(r, m, true, ev.tables[info.to]?.n ?? 0);
      if (partner[part] >= 0) parts.push([info.to, part, partner[part]]);
    }
  }
  return (
    <>
      <p class="truthline"><span class="badge truth">truth</span> no match from the associator</p>
      {parts.map(([t, part, p]) => <p class="hint">Its {kindOf(t).toLowerCase().replace(/s$/, "")} {chip(t, part)} is matched to {chip(truth, p)} (the associator's answer for that part, not for this object).</p>)}
    </>
  );
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
