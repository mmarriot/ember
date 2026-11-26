// A truth particle's facts on its card (docs/truth.md "The particle card"): its numbers, where it was made and where
// it ended, and what the truth graph alone says of its physics; its generator copies, levels and status under More.
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
} from "../../model/truth/graph";
import { LEVELS } from "../../model/truth/levelFlags";
import { namedChip as chip, ObjChip, spaced, vertexLabel } from "./chips";
import { Numbers } from "./Properties";

const num = (v: number, digits = 3) => (Number.isFinite(v) ? short(Number(v.toPrecision(digits))) : "?");

/** The truth particle `row`: its energy and φ (its pT and η are in its name, its collision above it); the vertex it
 *  was made at and the last one it has daughters at; its physics from the graph. */
export function ParticleFacts({ row }: { row: number }) {
  const tg = truthGraph.value,
    d = tg ? layerOf(tg.particles) : undefined,
    t = tg ? event.value?.tables[tg.particles] : undefined;
  if (!tg || !d || !t) return null;
  const g = tg.graph,
    top = topCopy(g, row),
    last = copiesBelow(g, top).at(-1)!;
  const vchip = (v: number) => (tg.vertices ? <ObjChip table={tg.vertices} row={v} text={vertexLabel(v)} /> : null);
  const where = (v: number) => `R ${length(Math.hypot(g.vcol("x", v), g.vcol("y", v)))}, z ${length(g.vcol("z", v))}`;
  const prod = g.col("prodVertexIdx", top),
    end = g.col("decayVertexIdx", last),
    apart = vertexDistance(g, row),
    decays = g.vcol("reason", end) === REASON.decay;
  return (
    <div class="pfacts">
      <Numbers
        name={tg.particles}
        table={t}
        row={row}
        columns={[]}
        extra={[
          ["E", `${num(g.col("energy", row))} GeV`],
          ["φ", num(g.col("phi", row))],
        ]}
      />
      {prod >= 0 && (
        <p>
          <span class="muted">made in</span> {vchip(prod)} <span class="muted">at {where(prod)}</span>
        </p>
      )}
      {end >= 0 && (
        <p title="The last vertex where its kept daughters were made, not necessarily where it stopped">
          {Number.isFinite(apart) && apart === 0 ? (
            <>
              <span class="muted">{decays ? "decays" : "ends"} where it was made, in</span> {vchip(end)}
            </>
          ) : (
            <>
              <span class="muted">ends in</span> {vchip(end)}{" "}
              <span class="muted">
                at {where(end)}
                {Number.isFinite(apart) && `, ${length(apart)} on`}
              </span>
            </>
          )}
        </p>
      )}
      <GraphPhysics g={g} row={row} particles={tg.particles} vertices={tg.vertices} />
    </div>
  );
}

/** Under the card's More: a truth particle's generator copies, its levels and its status. */
export function ParticleMore({ row }: { row: number }) {
  const tg = truthGraph.value,
    d = tg ? layerOf(tg.particles) : undefined;
  if (!tg || !d) return null;
  const g = tg.graph,
    copies = copiesBelow(g, topCopy(g, row)),
    flags = d.particle ? g.col(d.particle.flags, row) : NaN,
    levels = Number.isFinite(flags) ? LEVELS.filter(({ bit }) => (flags >>> bit) & 1) : [],
    bx = g.col("bunchCrossing", row);
  return (
    <div class="pfacts">
      <p>
        <span class="muted">status</span> {g.col("status", row)}
        {Number.isFinite(bx) && (
          <>
            {" "}
            · <span class="muted">bunch crossing</span> {bx}
          </>
        )}
      </p>
      {copies.length > 1 && (
        <p>
          <span class="muted">
            written {copies.length} times by the generator (status {copies.map((r) => g.col("status", r)).join(" → ")}
            ):
          </span>{" "}
          {spaced(copies.map((r) => (r === row ? <b>this one</b> : chip(tg.particles, r))))}
        </p>
      )}
      {levels.length > 0 && (
        <p class="plevels">
          <span class="muted">levels</span>{" "}
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
  const pchip = (r: number) => <ObjChip table={particles} row={r} />;
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
              · {m.vertex === flight.vertex ? "its decay vertex" : vertexLabel(m.vertex)} matched by{" "}
              {chip(m.table, m.row)}
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
