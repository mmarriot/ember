// A reco object's truth card (docs/truth.md): the associator's best match, how good it is in linear numbers (purity,
// completeness) next to the associator's own score, and the generator particle the match belongs to. Every line says
// where it comes from: the simulation (a fact), the CMSSW associator (a match, never "is"), or Ember.
import type { Header } from "../../io/format";
import { completeness, percent, quality, TARGETS } from "../../model/truth/match";
import { bestPartners, identities } from "../../model/event/relations";
import { withUnit } from "../../model/event/describe";
import { bundle, describe, event, labelOf, layerOf, modes, nameOf, short } from "../../model/store";
import { named, ObjChip, truthChip } from "./chips";
import { Info } from "../common/Info";
import { Lineage } from "./Lineage";

/** A collision's truth vertex, by whether it is the signal (the particles' `first` column, e.g. isSignal, is on the
 *  vertex table too): what a primary vertex's match means, not its generator step ("shower branching"). */
function collision(truth: string, t: string, r: number) {
  const first = layerOf(truth)?.particle?.first,
    v = first ? event.value?.tables[t]?.columns[first]?.[r] : undefined;
  return v === undefined
    ? nameOf({ table: t, row: r })
    : `${Number(v) ? "signal collision" : "pile-up collision"} ${r + 1}`;
}
/** Any other truth vertex: its name (e.g. its reason, "decay"), marked when it belongs to a pile-up collision. */
function vertexName(truth: string, t: string, r: number) {
  const first = layerOf(truth)?.particle?.first,
    v = first ? event.value?.tables[t]?.columns[first]?.[r] : undefined;
  return `${describe(t, r) || named(t, r) || nameOf({ table: t, row: r })}${v !== undefined && !Number(v) ? " (pile-up)" : ""}`;
}
/** How far apart two objects are, from their layers' positions (cm); undefined without them. */
function distance(a: string, ra: number, b: string, rb: number) {
  const ev = event.value,
    pa = layerOf(a)?.position,
    pb = layerOf(b)?.position;
  if (!ev || !pa || !pb) return undefined;
  const ca = ev.tables[a]?.columns,
    cb = ev.tables[b]?.columns;
  if (!ca || !cb || ![...pa.map((c) => ca[c]), ...pb.map((c) => cb[c])].every(Boolean)) return undefined;
  return Math.hypot(...[0, 1, 2].map((i) => Number(ca[pa[i]][ra]) - Number(cb[pb[i]][rb])));
}

/** The reco -> truth relations with a `match` contract from `table` (to the truth particles, or truth vertices). */
const matchRelations = (header: Header, table: string) =>
  Object.entries(header.relations).filter(
    ([, r]) => (r.match?.shared ?? r.match?.purity) && r.from === table && !!layerOf(r.to)?.truth,
  );

/** The truth card of reco object `row` of `table`: its best match and how good it is; null for a kind without a match
 *  relation (TruthBlock.tsx says why). */
export function TruthCard({ table, row }: { table: string; row: number }) {
  const b = bundle.value,
    ev = event.value,
    truth = modes.value.roots.truth;
  if (!b || !ev || !truth) return null;
  const rels = matchRelations(b.header, table).filter(([name]) => ev.relations[name]);
  if (!rels.length) return null;
  const [name, info] = rels[0],
    rel = ev.relations[name],
    m = info.match!,
    target = info.to;
  const { partner, entry } = bestPartners(rel, info, true, ev.tables[table]?.n ?? 0);
  const p = partner[row],
    q = p >= 0 ? quality(ev, b.header, name, entry[row], row) : undefined;
  const unit = m.measure === "hits" ? "hits" : m.measure === "pt2" ? "of the pT² of its tracks" : "GeV";
  const amount = (x: number) => (m.measure === "hits" ? `${Math.round(x)}` : short(x));
  const c = p >= 0 ? completeness(ev, b.header, target, p, table, row) : undefined;
  const particles = target === truth,
    generator = p >= 0 && particles ? generatorOf(truth, p) : -1,
    away = p >= 0 && !particles ? distance(table, row, target, p) : undefined;
  const what =
    m.measure === "hits"
      ? "hits"
      : m.measure === "pt2"
        ? "tracks (weighted by pT²)"
        : `reconstructed energy in ${m.in} (its raw energy: the rechits', each by its fraction; the shared part is the rechit energy of the match's share of each hit)`;
  const help = (
    <>
      {m.target && (
        <p>
          {labelOf(table)} reconstruct {TARGETS[m.target]}.
        </p>
      )}
      <p>
        The match is the best one CMSSW's associator found for this object (AdaptiveNominal working point)
        {particles ? ": a truth particle with everything it made" : ""}.
      </p>
      <p>
        <b>Purity</b>: the share of this object's {what} that comes from its match.
        {m.good !== undefined && ` Clean from ${percent(m.good)} (the mark on the bar).`}
      </p>
      {c && (
        <p>
          <b>Completeness</b>: the share of the match's{" "}
          {c.match.measure === "hits"
            ? "tracker hits, its secondaries' included,"
            : c.match.measure === "pt2"
              ? "findable tracks (pT²)"
              : `energy in ${c.match.in} (each cell's rechit energy, split between the particles by the simulated energy they left in it)`}{" "}
          that this object has.
        </p>
      )}
      {q?.score !== undefined && (
        <p>The associator's own score is {short(q.score)}: a ranking, 0 best, not a fraction.</p>
      )}
      {p < 0 && (
        <p>
          No match: a fake, or an object the associator does not consider (e.g. a candidate without calorimeter energy).
        </p>
      )}
    </>
  );
  return (
    <section class="truthcard">
      <p class="truthline">
        <span class="badge truth">truth</span>{" "}
        {p < 0 ? (
          <span class="q q-unmatched">not matched</span>
        ) : (
          <>
            match{" "}
            {particles ? (
              truthChip(target, p, m.measure)
            ) : (
              <ObjChip
                table={target}
                row={p}
                text={m.target === "interaction" ? collision(truth, target, p) : vertexName(truth, target, p)}
              />
            )}
          </>
        )}
        {away !== undefined && <span class="muted">{withUnit(away, "cm")} away</span>}
        <Info title="Truth match">{help}</Info>
      </p>
      {p < 0 ? null : (
        <>
          <div class="meters">
            {q?.purity !== undefined && (
              <Meter
                name="purity"
                value={q.purity}
                good={m.good}
                note={
                  m.purity
                    ? "of its tracks' pT²"
                    : `${amount(q.shared)} of ${amount(q.over!)} ${unit}${m.measure === "energy" ? " reconstructed" : ""}`
                }
              />
            )}
            {c && (
              <Meter
                name="completeness (associator)"
                value={c.value}
                note={`of the ${particles ? "particle's" : "truth vertex's"} ${c.match.measure === "hits" ? "tracker hits, its descendants' included" : c.match.measure === "pt2" ? "tracks (pT²)" : `energy in ${c.match.in}, rechit scale`}`}
              />
            )}
          </div>
          {generator >= 0 && generator !== p && (
            <p class="hint">part of generator particle {truthChip(truth, generator, m.measure)}</p>
          )}
          {particles && generator === p && aboveLevel(truth, p) && (
            <p class="hint" title="The match decayed in the generator (e.g. a π⁰): it is above the generator particles">
              merges the generator particles its match decayed to
            </p>
          )}
          {particles && <Lineage row={p} compact />}
        </>
      )}
    </section>
  );
}

/** A purity or completeness as a linear bar, with what it counts under it; `good`: the clean-match threshold, marked
 *  on the bar, green from there and amber below. */
function Meter({ name, value, good, note }: { name: string; value: number; good?: number; note: string }) {
  const state = good === undefined ? "" : value >= good ? "clean" : "impure";
  return (
    <div class="meter">
      <span class="mname">{name}</span>
      <span class="mbar">
        <i class={state && `q-${state}`} style={{ width: `${Math.round(100 * Math.min(1, Math.max(0, value)))}%` }} />
        {good !== undefined && <u style={{ left: `${100 * good}%` }} />}
      </span>
      <b>{percent(value)}</b>
      <span class="muted mnote">
        {note}
        {state && (
          <>
            {" "}
            · <span class={`q q-${state}`}>{state}</span>
          </>
        )}
      </span>
    </div>
  );
}

/** Whether truth row `row` is outside the particle level (e.g. a π⁰ or a B decayed by the generator). */
function aboveLevel(truth: string, row: number) {
  const d = layerOf(truth),
    flags = d?.particle ? event.value?.tables[truth]?.columns[d.particle.flags] : undefined;
  return !!flags && !((Number(flags[row]) >>> d!.particle!.bit) & 1);
}

/** The generator particle a truth row belongs to (its colour key; docs/truth.md), -1 without truth. */
function generatorOf(truth: string, row: number) {
  const b = bundle.value,
    ev = event.value,
    d = layerOf(truth);
  if (!b || !ev || !d || !ev.tables[truth]) return -1;
  return identities(d, ev.tables[truth], ev, b.header, 0).key[row];
}
