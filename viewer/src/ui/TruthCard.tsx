// The truth in the selection's card (Card.tsx; docs/truth.md), the same for every kind of object:
// - for a reco object, its truth card: what the kind reconstructs, the associator's best match, and how good that
//   match is in linear numbers (purity, completeness) next to the associator's own score, with the generator particle
//   it belongs to;
// - for a truth particle (and for a reco object's match), its lineage: where it sits in the truth graph, from the
//   collision down to its daughters, with the levels it belongs to and the reco objects matched to it.
// Every line says where it comes from: the simulation (a fact), the CMSSW associator (a match, never "is"), or Ember.
import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import type { Header } from "../io/format";
import { completeness, percent, quality, TARGETS } from "../model/match";
import { bestPartners, identities } from "../model/relations";
import { withUnit } from "../model/describe";
import {
  bundle,
  describe,
  event,
  labelOf,
  layerOf,
  modes,
  nameOf,
  short,
  truthGraph,
  truthName,
  truthStatuses,
  truthText,
} from "../model/store";
import {
  bremOf,
  conversionOf,
  copiesBelow,
  decayVertexMatches,
  flightOf,
  foldCopies,
  type Graph,
  length,
  LEVELS,
  tauDecayOf,
  topCopy,
  unassociatedKinds,
  vertexText,
} from "../model/truth";
import { named, namedChip as chip, ObjChip, truthChip } from "./chips";
import { Info } from "./Info";

const ANCESTORS = 4; // ancestors listed above the particle; higher ones are folded into one line, unfolded on a click
/** The lineage's folded ancestors are shown (kept from one particle to the next). */
const unfolded = signal(false);

const chipAs = (t: string, r: number, text: string) => <ObjChip table={t} row={r} text={text} />;
/** Chips side by side, a space between them (so that their text reads as words when copied). */
const spaced = (xs: ComponentChildren[]) =>
  xs.map((x, i) => (
    <>
      {i > 0 && " "}
      {x}
    </>
  ));
/** A collision's truth vertex, by whether it is the signal (the truth particles' `first` column, e.g. isSignal, on the
 *  vertex table too): what a primary vertex's match means, not its generator step (e.g. "shower branching"). */
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

/** The reco -> truth relations that carry a `match` contract, from `table` (to the truth particles, or to the truth
 *  vertices for vertices). */
const matchRelations = (header: Header, table: string) =>
  Object.entries(header.relations).filter(
    ([, r]) => (r.match?.shared ?? r.match?.purity) && r.from === table && !!layerOf(r.to)?.truth,
  );

/** The truth card of reco object `row` of `table`: for a kind with an association, its best match and how good it is;
 *  for a kind with no truth of its own, why (docs/truth.md "Where truth stops"); null otherwise. */
export function TruthCard({ table, row }: { table: string; row: number }) {
  const b = bundle.value,
    ev = event.value,
    truth = modes.value.roots.truth;
  if (!b || !ev || !truth) return null;
  const rels = matchRelations(b.header, table).filter(([name]) => ev.relations[name]);
  if (!rels.length) return null; // why it has none, and its parts' matches: the card's truth block (TruthBlock.tsx)
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
    generator = p >= 0 && particles ? generatorOf(truth, p) : -1;
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
            {particles
              ? truthChip(target, p, m.measure)
              : chipAs(
                  target,
                  p,
                  m.target === "interaction" ? collision(truth, target, p) : vertexName(truth, target, p),
                )}
          </>
        )}
        {p >= 0 && !particles && distance(table, row, target, p) !== undefined && (
          <span class="muted">{withUnit(distance(table, row, target, p)!, "cm")} away</span>
        )}
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

/** A purity or completeness as a bar (linear, 0 to 100%), with what it counts under it; `good`: the kind's clean-match
 *  threshold, marked on the bar, which is green from there and amber below. */
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

/** Where truth particle `row` sits in the truth graph: its ancestors (the highest folded), itself, and a summary of
 *  its daughters, each with the levels it belongs to and the reco objects whose best match it is. A particle's
 *  generator copies (the same particle written again at each generator step) are one entry, "μ⁺ ×4". `compact`: under
 *  a reco object's card. */
export function Lineage({ row, compact = false }: { row: number; compact?: boolean }) {
  const b = bundle.value,
    ev = event.value,
    truth = modes.value.roots.truth,
    d = truth ? layerOf(truth) : undefined,
    tg = truthGraph.value;
  if (!b || !ev || !truth || !d || !ev.tables[truth] || !tg) return null;
  const t = ev.tables[truth],
    g = tg.graph,
    { parent } = identities(d, t, ev, b.header, 0),
    flags = d.particle ? t.columns[d.particle.flags] : undefined;
  const chain: number[] = [];
  for (let a = row, steps = 0; a >= 0 && steps < t.n; a = parent[a], steps++) chain.unshift(a);
  // The particle's copies below it belong to it: the lineage ends with the last one.
  const own = copiesBelow(g, row);
  chain.push(...own.slice(1));
  const groups = foldCopies(g, chain),
    rep = (grp: number[]) => (grp.includes(row) ? row : grp.at(-1)!),
    mine = groups.findIndex((grp) => grp.includes(row));
  // Generator internals (quarks, gluons, diquarks, generator codes) are folded: the lineage starts below the last one.
  const pdg = t.columns.pdgId,
    parton = (r: number) => {
      // quarks, gluons, generator codes (81-100), diquarks (e.g. 2101)
      const id = Math.abs(Number(pdg[r]));
      return (
        id <= 8 || id === 21 || (id >= 81 && id <= 100) || (id > 1000 && id < 6000 && Math.floor(id / 10) % 10 === 0)
      );
    };
  const above = groups.slice(0, mine),
    lastParton = pdg ? above.map((grp) => parton(rep(grp))).lastIndexOf(true) : -1;
  const physical = groups.slice(lastParton + 1, mine + 1),
    shown = unfolded.value && !compact ? groups.slice(0, mine + 1) : physical.slice(-1 - ANCESTORS),
    folded = mine + 1 - shown.length;
  const children = g.children(own.at(-1)!);
  const levels = (r: number) => (flags ? LEVELS.filter(({ bit }) => (Number(flags[r]) >>> bit) & 1) : []);
  const tags = (r: number) =>
    levels(r).map(({ name, flag, what }) => (
      <>
        {" "}
        <span class="badge level" title={`${what} (${flag})`}>
          {name}
        </span>
      </>
    ));
  /** A group's entry: its particle's chip, "×N" for copies, and a note when the top has several parents. */
  const entry = (grp: number[]) => {
    const parents = g.parents(grp[0]).length;
    return (
      <>
        <span class={grp.includes(row) ? "here" : undefined}>{chip(truth, rep(grp))}</span>
        {grp.length > 1 && (
          <span
            class="muted"
            title={`The generator wrote this particle ${grp.length} times (statuses ${grp.map((r) => g.col("status", r)).join(" → ")}): one particle`}
          >
            ×{grp.length} (status {g.col("status", grp[0])}→{g.col("status", grp.at(-1)!)})
          </span>
        )}
        {parents > 1 && (
          <span
            class="muted"
            title="It has several parents (a string or cluster of partons): the line follows the first"
          >
            from {parents} partons
          </span>
        )}
      </>
    );
  };
  // Under a reco object's card: one line from the collision down to the match (select the particle for the rest).
  if (compact)
    return (
      <div
        class="lineage crumb"
        title="Where the match sits in the truth graph, from the collision down (simulation). Click a particle to go to it; X goes to the match"
      >
        <span class="badge truth">truth</span>
        <span class="muted">chain</span>
        {folded > 0 && (
          <span
            class="muted"
            title={`${folded} earlier step${folded > 1 ? "s" : ""} up to the collision${lastParton >= 0 ? " (quarks and gluons of the generator)" : ""}`}
          >
            … ›
          </span>
        )}
        {shown.map((grp, k) => (
          <>
            {k > 0 && (
              <span class="muted" aria-hidden="true">
                ›
              </span>
            )}
            {entry(grp)}
            {grp.includes(row) && tags(row)}
          </>
        ))}
        {children.length > 0 && (
          <span class="muted">
            › {children.length} daughter{children.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
    );
  const claims = claimsOf(b.header, truth, new Set(chain.concat(children)));
  const line = (grp: number[], depth: number) => (
    <li style={{ paddingLeft: `${depth * 10}px` }} class={grp.includes(row) ? "here" : undefined}>
      {depth > 0 && <span class="muted">└ </span>}
      {entry(grp)}
      {grp.includes(row) && <span class="muted"> ← this one</span>}
      {tags(rep(grp))}
      {grp
        .flatMap((r) => claims.get(r) ?? [])
        .slice(0, 3)
        .map(([tab, o]) => (
          <span class="muted">
            {" "}
            · {labelOf(tab).split(" · ")[0].toLowerCase()} {chip(tab, o)}
          </span>
        ))}
    </li>
  );
  const entered = flags ? children.filter((c) => (Number(flags[c]) >>> 3) & 1).length : 0;
  return (
    <div
      class="lineage"
      title="Where it sits in the truth graph: its ancestors, itself and its daughters (simulation); the reco objects whose best match a particle is (associator)"
    >
      <p class="truthline">
        <span class="badge truth">truth</span> lineage{" "}
        <Info title="Lineage">
          <p>Where the particle sits in the truth graph (simulation): its ancestors, itself, its daughters.</p>
          <p>
            The generator writes a particle again at each of its steps (status 23, 51, …, 1): those copies are one
            entry, "×4". A particle made from several partons (a string) follows the first of them.
          </p>
          <p>
            The tags are the levels a particle belongs to; the objects named beside a particle are the reco objects
            whose best match it is (CMSSW's associator).
          </p>
        </Info>
      </p>
      <ul class="matches">
        {folded > 0 && (
          <li class="muted">
            <button
              class="link"
              title={`Show them, up to the collision${lastParton >= 0 ? " (with the generator's quarks and gluons)" : ""}`}
              onClick={() => (unfolded.value = true)}
            >
              … {folded} earlier step{folded > 1 ? "s" : ""}
            </button>
          </li>
        )}
        {unfolded.value && mine + 1 > physical.slice(-1 - ANCESTORS).length && (
          <li class="muted">
            <button class="link" onClick={() => (unfolded.value = false)}>
              fold the earlier steps
            </button>
          </li>
        )}
        {shown.map((grp, k) => line(grp, k))}
        {children.length > 0 && (
          <li class="muted" style={{ paddingLeft: `${shown.length * 10}px` }}>
            └ {children.length} daughter{children.length > 1 ? "s" : ""}
            {entered > 0 && `, ${entered} entered the calorimeter`}{" "}
            {spaced(children.slice(0, 4).map((c) => chip(truth, c)))}
            {children.length > 4 && " …"}
          </li>
        )}
      </ul>
    </div>
  );
}

/** The head of a truth particle's card (docs/truth.md "The particle card"): its kinematics, status and collision; where
 *  it was made and where it ended (R, z, the process); its copies; a tag for every level it belongs to; and what the
 *  graph says of its physics (brem, conversion, τ decay, flight), each read from the graph alone. */
export function ParticleFacts({ row }: { row: number }) {
  const tg = truthGraph.value,
    d = tg ? layerOf(tg.particles) : undefined;
  if (!tg || !d) return null;
  const g = tg.graph,
    top = topCopy(g, row),
    copies = copiesBelow(g, top),
    last = copies.at(-1)!,
    col = (c: string) => g.col(c, row);
  const name = truthText(tg.particles, row).split(" · ")[0],
    first = d.particle?.first,
    signal = first ? !!g.col(first, row) : undefined,
    bx = col("bunchCrossing");
  const reasons = vertexReasons(tg.vertices);
  const pname = (r: number) => truthText(tg.particles, r).split(" · ")[0];
  const vchip = (v: number) =>
    tg.vertices ? <ObjChip table={tg.vertices} row={v} text={vertexText(g, v, pname, reasons)} /> : null;
  const where = (v: number) => `R ${length(Math.hypot(g.vcol("x", v), g.vcol("y", v)))}, z ${length(g.vcol("z", v))}`;
  const prod = g.col("prodVertexIdx", top),
    end = g.col("decayVertexIdx", last);
  const flags = d.particle ? g.col(d.particle.flags, row) : NaN,
    levels = Number.isFinite(flags) ? LEVELS.filter(({ bit }) => (flags >>> bit) & 1) : [];
  const num = (v: number, digits = 3) => (Number.isFinite(v) ? short(Number(v.toPrecision(digits))) : "?");
  return (
    <div class="pfacts">
      <p class="phead">
        <b>{name}</b> · pT {num(col("pt"))} GeV · η {num(col("eta"))} · φ {num(col("phi"))} · E {num(col("energy"))} GeV
        · status {col("status")}
        {signal !== undefined && (
          <>
            {" "}
            · {signal ? "signal" : "pile-up"}
            {Number.isFinite(bx) && ` (bx ${bx})`}
          </>
        )}
      </p>
      {copies.length > 1 && (
        <p class="muted">
          written {copies.length} times by the generator (status {copies.map((r) => g.col("status", r)).join(" → ")}
          ): {spaced(copies.map((r) => (r === row ? <b>this one</b> : chip(tg.particles, r))))}
        </p>
      )}
      {prod >= 0 && (
        <p>
          <span class="muted">made at</span> {where(prod)} · {vchip(prod)}
        </p>
      )}
      {end >= 0 && (
        <p>
          <span
            class="muted"
            title="Its end vertex in the file: the latest of the vertices where its kept daughters were made, not necessarily where it stopped"
          >
            last vertex with daughters
          </span>{" "}
          {where(end)} · {vchip(end)}
        </p>
      )}
      {levels.length > 0 && (
        <p class="plevels">
          {levels.map(({ name: n, flag, what }, i) => (
            <>
              {i > 0 && " "}
              <span class="badge level" title={`${what} (${flag}, bit ${LEVELS.find((l) => l.name === n)!.bit})`}>
                {n}
              </span>
            </>
          ))}
        </p>
      )}
      <Physics g={g} row={row} particles={tg.particles} vertices={tg.vertices} />
    </div>
  );
}

/** For the ⓘ of "Reconstructed as": the kinds with no truth association that this particle could have reached
 *  (model/truth.ts unassociatedKinds), and their gaps; apart from the kinds that have one and found nothing: "nothing
 *  holds it" and "no associator" are different answers. */
export function unassociated(row: number): { names: string[]; gaps: number[] } {
  const b = bundle.value,
    ev = event.value,
    tg = truthGraph.value,
    st = truthStatuses.value;
  if (!b || !ev || !tg) return { names: [], gaps: [] };
  const kinds = unassociatedKinds(ev, b.header, tg.particles, row, tg.graph, (t) => {
    const s = st.get(t);
    return s?.kind === "none" ? { reason: s.reason, gap: s.gap } : undefined;
  });
  return {
    names: [...new Set(kinds.map((k) => truthName(k.table)))],
    gaps: [...new Set(kinds.flatMap((k) => (k.gap === undefined ? [] : [k.gap])))],
  };
}

/** The names of the truth vertices' reasons, from their layer's categories. */
export function vertexReasons(table: string | undefined): Record<string, string> {
  const c = table ? layerOf(table)?.colourBy : undefined;
  if (typeof c !== "object" || !("category" in c) || !c.names) return {};
  return Array.isArray(c.names) ? Object.fromEntries(c.names) : c.names;
}

/** What the truth graph says of a particle's physics, from its particles and vertices alone (owner decision D1;
 *  docs/truth.md "Physics from the graph"): never an association. */
function Physics({ g, row, particles, vertices }: { g: Graph; row: number; particles: string; vertices?: string }) {
  const b = bundle.value,
    ev = event.value,
    name = (r: number) => truthText(particles, r).split(" · ")[0];
  const pchip = (r: number) => <ObjChip table={particles} row={r} text={truthText(particles, r, true)} />;
  const out = [];
  const brem = bremOf(g, row);
  if (brem)
    out.push(
      brem.count ? (
        <p title="Its photons made at a bremsstrahlung vertex that the graph keeps (those that reached the calorimeter, or that something is matched to): very soft ones may be missing">
          <span class="muted">brem</span> {brem.count} photon{brem.count > 1 ? "s" : ""}, ΣE {short(brem.energy)} GeV,
          radiated at R {length(brem.rMin)} – {length(brem.rMax)}
          {Number.isFinite(brem.atCalo) && (
            <>
              {" "}
              · {short(brem.atCalo)} GeV at the calorimeter · true fbrem {brem.fbrem.toFixed(2)}
            </>
          )}
        </p>
      ) : (
        <p class="muted">no brem photon kept in the graph</p>
      ),
    );
  const conv = conversionOf(g, row);
  if (conv)
    out.push(
      <p>
        {conv.converted ? (
          <>
            <span class="muted">converted</span> at R {length(conv.r)}, z {length(conv.z)} →{" "}
            {spaced(conv.products.map((c) => pchip(c)))}
          </>
        ) : (
          <span class="muted">
            did not convert{conv.reachedCalo ? ": it reached the calorimeter" : " (no conversion vertex in the graph)"}
          </span>
        )}
        {conv.pi0 >= 0 && (
          <>
            {" "}
            · <span class="muted">from</span> {pchip(conv.pi0)}
            {conv.sisters.length > 0 && (
              <>
                {" "}
                <span class="muted">with</span> {spaced(conv.sisters.map((c) => pchip(c)))}
              </>
            )}
          </>
        )}
      </p>,
    );
  const tau = tauDecayOf(g, row);
  if (tau)
    out.push(
      <p>
        <span class="muted">decays</span> {name(tau.last)} → {spaced(tau.products.map((c) => pchip(c)))} · visible E{" "}
        {short(tau.visibleE)} GeV
      </p>,
    );
  const flags = g.col(layerOf(particles)?.particle?.flags ?? "levelFlags", row),
    hadron = Number.isFinite(flags) && (((flags >>> 8) & 1) | ((flags >>> 9) & 1)) === 1;
  const flight = hadron ? flightOf(g, row) : undefined;
  if (flight && b && ev && vertices) {
    const flag = layerOf(particles)?.particle?.flags ?? "levelFlags",
      { associator, matches } = decayVertexMatches(ev, b.header, g, vertices, row, flag),
      pn = (r: number) => name(r);
    out.push(
      <p>
        <span class="muted">flight</span> {length(flight.l3d)} (transverse {length(flight.lxy)})
        {!associator ? (
          <span class="muted"> · no vertex associator for decay vertices in this file</span>
        ) : matches.length ? (
          matches.slice(0, 3).map((m) => (
            <>
              {" "}
              · {m.vertex === flight.vertex
                ? "its decay vertex"
                : vertexText(g, m.vertex, pn, vertexReasons(vertices))}{" "}
              matched by {chip(m.table, m.row)}
              {Number.isFinite(m.completeness) && (
                <span class="muted" title="The association's completeness: the share of the truth vertex it holds">
                  {" "}
                  (completeness {percent(m.completeness)})
                </span>
              )}
            </>
          ))
        ) : (
          <span class="muted"> · no reco vertex is matched to its decay</span>
        )}
      </p>,
    );
  }
  return out.length ? <div class="physics">{out}</div> : null;
}

/** For each of `rows`, the reco objects whose best match it is (through every reco -> truth association). */
function claimsOf(header: Header, truth: string, rows: Set<number>) {
  const ev = event.value!,
    out = new Map<number, [string, number][]>();
  for (const [name, info] of Object.entries(header.relations)) {
    const rel = ev.relations[name];
    if (!rel || !info.association || info.to !== truth || info.from === truth) continue;
    const { partner } = bestPartners(rel, info, true, ev.tables[info.from]?.n ?? 0);
    for (let o = 0; o < partner.length; o++)
      if (rows.has(partner[o])) out.set(partner[o], [...(out.get(partner[o]) ?? []), [info.from, o]]);
  }
  return out;
}
