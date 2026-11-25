// The head of a truth particle's card (docs/truth.md "The particle card"): its kinematics, where it was made and where
// it ended, its copies, its levels, and what the truth graph alone says of its physics.
import { percent } from "../../model/truth/match";
import { bundle, event, layerOf, short, truthGraph, truthText } from "../../model/store";
import {
  bremOf,
  conversionOf,
  copiesBelow,
  decayVertexMatches,
  flightOf,
  type Graph,
  length,
  vertexDistance,
  REASON,
  tauDecayOf,
  topCopy,
  vertexText,
} from "../../model/truth/graph";
import { LEVELS } from "../../model/truth/levelFlags";
import { categoryNames, namedChip as chip, ObjChip, spaced } from "./chips";

/** The truth particle `row`: kinematics, status and collision; production and end vertices; copies; levels; physics. */
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
  const reasons = categoryNames(tg.vertices);
  const pname = (r: number) => truthText(tg.particles, r).split(" · ")[0];
  const vchip = (v: number) =>
    tg.vertices ? <ObjChip table={tg.vertices} row={v} text={vertexText(g, v, pname, reasons)} /> : null;
  const where = (v: number) => `R ${length(Math.hypot(g.vcol("x", v), g.vcol("y", v)))}, z ${length(g.vcol("z", v))}`;
  const prod = g.col("prodVertexIdx", top),
    end = g.col("decayVertexIdx", last),
    apart = vertexDistance(g, row),
    decays = g.vcol("reason", end) === REASON.decay;
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
          {Number.isFinite(apart) && (
            <>
              {" "}
              ·{" "}
              <span title="The straight-line distance from the vertex it was made at to this one">
                {decays && apart === 0
                  ? "decays where it was made (0 cm)"
                  : `${decays ? "decays" : "last vertex"} ${length(apart)} from where it was made`}
              </span>
            </>
          )}
        </p>
      )}
      {levels.length > 0 && (
        <p class="plevels">
          {levels.map(({ name: n, flag, what, bit }, i) => (
            <>
              {i > 0 && " "}
              <span class="badge level" title={`${what} (${flag}, bit ${bit})`}>
                {n}
              </span>
            </>
          ))}
        </p>
      )}
      <GraphPhysics g={g} row={row} particles={tg.particles} vertices={tg.vertices} />
    </div>
  );
}

/** What the truth graph says of a particle's physics, from its particles and vertices alone, never an association
 *  (owner decision D1; docs/truth.md "Physics from the graph"). */
function GraphPhysics({
  g,
  row,
  particles,
  vertices,
}: {
  g: Graph;
  row: number;
  particles: string;
  vertices?: string;
}) {
  const b = bundle.value,
    ev = event.value,
    name = (r: number) => truthText(particles, r).split(" · ")[0];
  const pchip = (r: number) => <ObjChip table={particles} row={r} text={truthText(particles, r, true)} />;
  const out = [];
  const brem = bremOf(g, row);
  if (brem)
    out.push(
      brem.count ? (
        <p title="Its photons made at a bremsstrahlung vertex inside the tracker volume (before the simulation's tracker–calorimeter boundary: R 123 cm in the barrel, |z| 293.5 cm in the endcaps, in front of the ETL and HGCal), that the graph keeps (those that reached the calorimeter, or that something is matched to): very soft ones may be missing. Its energy where it left the tracker is at that boundary's checkpoint, so the two add up to its energy but for what it lost by ionisation. This is not the reco fbrem, (p_in − p_out) / p_in of its GSF track: that stops at the track's last hit, and misses the brem after the outermost tracker layer">
          <span class="muted">brem in the tracker</span> {brem.count} photon{brem.count > 1 ? "s" : ""}, ΣE{" "}
          {short(brem.energy)} GeV, radiated at R {length(brem.rMin)} – {length(brem.rMax)}
          {Number.isFinite(brem.atCalo) && (
            <>
              {" "}
              · left the tracker (R {length(brem.atR)}, z {length(brem.atZ)}) with {short(brem.atCalo)} GeV
            </>
          )}
        </p>
      ) : (
        <p class="muted">no brem in the tracker kept in the graph</p>
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
        ) : conv.showered ? (
          <span title="Its first pair production (a vertex of reason conversion in the graph) is beyond the simulation's tracker–calorimeter boundary (R 123 cm, |z| 293.5 cm): in front of or in the calorimeter, not a conversion that tracking could find">
            <span class="muted">did not convert in the tracker: first pair at</span> R {length(conv.r)}, z{" "}
            {length(conv.z)}
          </span>
        ) : (
          <span class="muted">
            did not convert{conv.reachedCalo ? " in the tracker" : " (no conversion vertex in the graph)"}
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
  // Bits 8 and 9: the weakly decaying b and c hadrons.
  const flag = layerOf(particles)?.particle?.flags ?? "levelFlags",
    flags = g.col(flag, row),
    hadron = Number.isFinite(flags) && (((flags >>> 8) & 1) | ((flags >>> 9) & 1)) === 1;
  const flight = hadron ? flightOf(g, row) : undefined;
  if (flight && b && ev && vertices) {
    const { associator, matches } = decayVertexMatches(ev, b.header, g, vertices, row, flag);
    out.push(
      <p>
        <span class="muted">flight</span> {length(flight.l3d)} (transverse {length(flight.lxy)})
        {!associator ? (
          <span class="muted"> · no vertex associator for decay vertices in this file</span>
        ) : matches.length ? (
          matches.slice(0, 3).map((m) => (
            <>
              {" "}
              ·{" "}
              {m.vertex === flight.vertex
                ? "its decay vertex"
                : vertexText(g, m.vertex, name, categoryNames(vertices))}{" "}
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
