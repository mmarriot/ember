// A reco object's truth (docs/truth.md): the associator's best match, where that particle comes from, and how good the
// match is in two linear numbers, purity (how much of the object is the particle) and completeness (how much of the
// particle is in the object). Only the file's associations: a match, never "is".
import type { Header } from "../../io/format";
import { completeness, percent, quality, TARGETS } from "../../model/truth/match";
import { bestPartners } from "../../model/event/relations";
import { withUnit } from "../../model/event/describe";
import { topCopy } from "../../model/truth/graph";
import { bundle, event, labelOf, layerOf, modes, short, truthGraph, truthText } from "../../model/store";
import { categoryNames, GENERATOR_STEPS, ObjChip, truthChip, vertexLabel } from "./chips";
import { Info } from "../common/Info";

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

/** Where truth particle `row` comes from, as the graph names the vertex that made it ("W⁻ decay", "γ conversion"); ""
 *  for a generator step (a hadronization's first parton does not name it) or when the graph names neither. */
export function originOf(row: number) {
  const tg = truthGraph.value;
  if (!tg?.vertices) return "";
  const g = tg.graph,
    v = g.col("prodVertexIdx", topCopy(g, row)),
    parent = v >= 0 ? g.into(v) : -1,
    reason = v >= 0 ? g.vcol("reason", v) : NaN;
  if (parent < 0 || GENERATOR_STEPS.has(reason)) return "";
  const name = truthText(tg.particles, parent).split(" · ")[0],
    word = categoryNames(tg.vertices)[String(reason)];
  return word && !name.startsWith("pdgId") ? `${name} ${word}` : "";
}

/** The truth match of reco object `row` of `table`: its best match and how good it is; null for a kind without a
 *  match relation (TruthBlock.tsx says why). */
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
  const unit = m.measure === "hits" ? "hits" : m.measure === "pt2" ? "of its tracks' pT²" : "GeV";
  const amount = (x: number) => (m.measure === "hits" ? `${Math.round(x)}` : short(x));
  const c = p >= 0 ? completeness(ev, b.header, target, p, table, row) : undefined;
  const particles = target === truth,
    from = p >= 0 && particles ? originOf(p) : "",
    away = p >= 0 && !particles ? distance(table, row, target, p) : undefined,
    what = particles ? "the particle" : "the truth vertex";
  const counts =
    m.measure === "hits"
      ? "its tracker hits"
      : m.measure === "pt2"
        ? "its tracks (weighted by pT²)"
        : `its reconstructed energy in ${m.in}`;
  const help = (
    <>
      {m.target && (
        <p>
          {labelOf(table)} reconstruct {TARGETS[m.target]}.
        </p>
      )}
      <p>
        The match is the best one CMSSW's associator found for this object (AdaptiveNominal working point)
        {particles ? ": a truth particle with everything below it" : ""}.
      </p>
      <p>
        <b>Purity</b>: the share of {counts} that comes from {what}.
        {m.good !== undefined && ` A clean match from ${percent(m.good)}, the mark on the bar.`}
      </p>
      {c && (
        <p>
          <b>Completeness</b>: the share of {what}'s{" "}
          {c.match.measure === "hits"
            ? "tracker hits (its descendants' included)"
            : c.match.measure === "pt2"
              ? "findable tracks (pT²)"
              : `energy in ${c.match.in} (each cell's rechit energy, split between the particles by the simulated energy they left in it)`}{" "}
          that this object holds.
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
  const clean = q?.purity !== undefined && m.good !== undefined ? q.purity >= m.good : undefined;
  return (
    <div class="truthcard">
      <p class="truthline">
        {p < 0 ? (
          <span class="q q-unmatched">not matched</span>
        ) : particles ? (
          truthChip(target, p)
        ) : (
          <ObjChip table={target} row={p} text={vertexLabel(p, m.target === "interaction")} />
        )}
        {from && <span class="muted">from {from}</span>}
        {away !== undefined && <span class="muted">{withUnit(away, "cm")} away</span>}
        <Info title="Truth match">{help}</Info>
      </p>
      {p >= 0 && (
        <div class="meters">
          {q?.purity !== undefined && (
            <Meter
              name="purity"
              value={q.purity}
              good={m.good}
              title={`${percent(q.purity)} of ${counts} comes from ${what}${q.over !== undefined && !m.purity ? ` (${amount(q.shared)} of ${amount(q.over)} ${unit})` : ""}${clean === undefined ? "" : clean ? ": a clean match" : ": impure"}`}
            />
          )}
          {c && (
            <Meter
              name="completeness"
              value={c.value}
              title={`This object holds ${percent(c.value)} of ${what} (associator)`}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** A purity or completeness as a linear bar; `good`: the clean-match threshold, marked on the bar, green from there
 *  and amber below; `clean`: that verdict, worked out elsewhere. */
export function Meter({
  name,
  value,
  good,
  clean,
  title,
}: {
  name: string;
  value: number;
  good?: number;
  clean?: boolean;
  title: string;
}) {
  const state =
    clean !== undefined ? (clean ? "clean" : "impure") : good === undefined ? "" : value >= good ? "clean" : "impure";
  return (
    <div class="meter" title={title}>
      <span class="mname">{name}</span>
      <span class="mbar">
        <i class={state && `q-${state}`} style={{ width: `${Math.round(100 * Math.min(1, Math.max(0, value)))}%` }} />
        {good !== undefined && <u style={{ left: `${100 * good}%` }} />}
      </span>
      <b class={state && `q q-${state}`}>{percent(value)}</b>
    </div>
  );
}
