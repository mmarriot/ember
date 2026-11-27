// The card of a truth vertex (docs/viewer.md "A truth vertex"): the answer first, which reco vertex holds it and how
// well, then where it is and what happened there. The vertices of a collision at one place are one for reco
// (truth/places.ts): a collision's point (its primary vertex), a b hadron's decay with the ω it made (a secondary
// vertex); one of the generator's steps at a collision's point stands for the collision.
import type { Reconstructed } from "../../model/event/chain";
import { bestPartners } from "../../model/event/relations";
import { plain, withUnit } from "../../model/event/describe";
import { length } from "../../model/truth/graph";
import { percent, quality } from "../../model/truth/match";
import { collisionKey, type Place } from "../../model/truth/places";
import {
  bundle,
  collisionOf,
  event,
  kindOf,
  layerOf,
  nameOf,
  placeAt,
  reconstructed,
  truthGraph,
  truthPlaces,
  truthText,
} from "../../model/store";
import { Info } from "../common/Info";
import { ObjChip, spaced, vertexLabel } from "./chips";
import { distance, Meter } from "./TruthCard";
import { GoAcross } from "./TruthSide";

/** A share of a vertex under which another reco vertex holding some of it is not named. */
const MIN = 0.05;

/** A reco object's chip, named in full ("Secondary vertex 2 · tracks 4"). */
const named = (table: string, row: number) => <ObjChip table={table} row={row} text={nameOf({ table, row })} />;
/** A truth vertex's chip, named by what happened there, or by its collision. */
const vchip = (table: string, row: number) => (
  <ObjChip table={table} row={row} text={vertexLabel(row, !!collisionOf(row))} />
);

/** What the reco -> truth vertex associations from each reco table aim at (their match target: "interaction" for the
 *  primary vertices, "decayVertex" for the secondary ones). */
function targets() {
  const b = bundle.value,
    tv = truthGraph.value?.vertices,
    out = new Map<string, string | undefined>();
  for (const r of Object.values(b?.header.relations ?? {}))
    if (r.association && r.to === tv && !layerOf(r.from)?.truth) out.set(r.from, r.match?.target);
  return out;
}

/** The card's answer and facts for truth vertex `row`. */
export function VertexSide({ row }: { row: number }) {
  const tg = truthGraph.value,
    rec = reconstructed.value;
  if (!tg?.vertices || !rec) return null;
  const place = placeAt(row),
    collision = !!place?.collision,
    aims = targets(),
    // At a collision's point the kind that reconstructs collisions answers (the primary vertices); another kind
    // matched there (a secondary vertex with prompt tracks) is one line of names. Elsewhere, every kind answers.
    held = rec.reco.filter((r) => r.partners.length),
    answers = held.filter((l) => !collision || aims.get(l.table) === "interaction"),
    aside = collision ? held.filter((l) => aims.get(l.table) !== "interaction") : [],
    what = collision ? "collision" : "vertex";
  return (
    <>
      <section class="recon" aria-label="Reconstructed as">
        <h4>
          Reconstructed as{" "}
          <span class="lanes">
            <GoAcross />
            <Info title="Reconstructed as">
              <p>
                The reco vertices that hold this {what}'s tracks, from CMSSW's vertex associators: a primary vertex is
                matched to the collision its tracks' particles came from; a secondary vertex to the vertex where they
                were made (its efficiency counts b and c hadron decays). Vertices at one place count as one: a
                collision's point, a b hadron's decay with the resonances that decayed there.
              </p>
              <p>
                <b>purity</b>: the share of the reco vertex's tracks (weighted by pT²) that come from this {what}; a
                clean match from 50%, the mark on the bar. <b>completeness</b>: the share of this {what}'s findable
                tracks (pT²) that the reco vertex holds.
              </p>
              <p>
                <b>Click</b> a vertex to look at it in the view; <b>double click</b> to open its card.
              </p>
            </Info>
          </span>
        </h4>
        {answers.length ? (
          answers.map((l) => <RecoLine line={l} row={row} place={place} />)
        ) : (
          <p class="hint">{nothing(collision, aims)}</p>
        )}
        {aside.map((l) => (
          <p
            class="vnote"
            title="Some of their tracks come from particles made at this collision's point (prompt), not at a displaced decay"
          >
            <span class="muted">{kindOf(l.table)} holding some of its prompt tracks:</span>{" "}
            {spaced(l.partners.slice(0, 3).map((p) => named(l.table, p.row)))}
            {l.partners.length > 3 && <span class="muted"> +{l.partners.length - 3}</span>}
          </p>
        ))}
      </section>
      {collisionOf(row) ? <CollisionFacts row={row} place={place!} /> : <DecayFacts row={row} place={place} />}
    </>
  );
}

/** Why no reco vertex holds the vertex: nothing of the kind that reconstructs it holds its tracks, or the file has no
 *  association for that kind. */
function nothing(collision: boolean, aims: Map<string, string | undefined>) {
  const aim = collision ? "interaction" : "decayVertex",
    kind = collision ? "primary vertex" : "secondary vertex";
  return [...aims.values()].includes(aim)
    ? `No ${kind} holds any of its tracks.`
    : `Not compared: the file has no ${kind} association to the truth.`;
}

/** One reco kind's answer (`line`, a reconstructed kind of recoOfTruth): its best holder with that holder's purity and
 *  completeness and its distance; whether it is the leading primary vertex; whether its own best match is elsewhere;
 *  the others holding at least MIN, and how many more hold some. */
function RecoLine({ line, row, place }: { line: Reconstructed; row: number; place: Place | null }) {
  const b = bundle.value!,
    ev = event.value!,
    tg = truthGraph.value!,
    rows = place?.rows ?? [row],
    what = place?.collision ? "collision" : "vertex";
  const best = line.partners.find((p) => p.best) ?? line.partners[0],
    others = line.partners.filter((p) => p !== best && (p.completeness ?? 1) >= MIN),
    rest = line.partners.length - 1 - others.length;
  // its purity for this place: the shares of its pT² from the place's vertices, added
  const forward = Object.entries(b.header.relations).find(
    ([n, r]) => r.association && r.from === line.table && r.to === tg.vertices && r.match && ev.relations[n],
  );
  let purity: number | undefined;
  if (forward) {
    const rel = ev.relations[forward[0]];
    for (let k = rel.offsets[best.row]; k < rel.offsets[best.row + 1]; k++) {
      const q = rows.includes(rel.indices[k]) ? quality(ev, b.header, forward[0], k, best.row)?.purity : undefined;
      if (q !== undefined) purity = Math.min(1, (purity ?? 0) + q);
    }
  }
  const match = forward?.[1].match,
    away = distance(line.table, best.row, tg.vertices!, row),
    primary = match?.target === "interaction",
    leading = primary && best.row === 0,
    merged = best.owner >= 0 && !rows.includes(best.owner);
  return (
    <div class="vline">
      <p class="truthline">
        {named(line.table, best.row)}
        {leading && (
          <span class="tag" title="The first of its collection: the vertex CMSSW takes for the hard scatter">
            leading
          </span>
        )}
        {away !== undefined && <span class="muted">{withUnit(away, "cm")} away</span>}
      </p>
      <div class="meters">
        {purity !== undefined && (
          <Meter
            name="purity"
            value={purity}
            good={match?.good}
            title={`${percent(purity)} of its tracks' pT² comes from this ${what}`}
          />
        )}
        {best.completeness !== undefined && (
          <Meter
            name="completeness"
            value={best.completeness}
            title={`It holds ${percent(best.completeness)} of this ${what}'s tracks' pT²`}
          />
        )}
      </div>
      {merged && (
        <p class="vnote">
          <span class="tag-merged">merged</span> <span class="muted">its own best match is</span>{" "}
          {vchip(tg.vertices!, best.owner)}
        </p>
      )}
      {primary && place?.signal && !leading && <NotLeading table={line.table} />}
      {line.partners.length > 1 && (
        <p class="vnote">
          {others.length > 0 && (
            <>
              <span class="muted">also holding some (split):</span>{" "}
              {spaced(
                others.map((o) => (
                  <span class="partner">
                    {named(line.table, o.row)}
                    <span class="pct">{percent(o.completeness)}</span>
                  </span>
                )),
              )}
            </>
          )}
          {rest > 0 && (
            <span class="muted" title="The others hold some of it (all under More, Every association)">
              {others.length ? ` +${rest}` : `${rest} more hold under ${percent(MIN)} of it`}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/** The signal collision whose best primary vertex (of `table`) is not the leading one: what the leading one is
 *  matched to. */
function NotLeading({ table }: { table: string }) {
  const b = bundle.value!,
    ev = event.value!,
    tg = truthGraph.value!;
  const rel = Object.entries(b.header.relations).find(
    ([n, r]) => r.association && r.from === table && r.to === tg.vertices && ev.relations[n],
  );
  const lead = rel ? (bestPartners(ev.relations[rel[0]], rel[1], true, ev.tables[table]?.n ?? 0).partner[0] ?? -1) : -1;
  return (
    <p class="vnote">
      <span class="q q-impure">not the leading vertex:</span> {named(table, 0)}{" "}
      {lead >= 0 ? (
        <>
          <span class="muted">is matched to</span> {vchip(tg.vertices!, lead)}
        </>
      ) : (
        <span class="muted">is not matched</span>
      )}
    </p>
  );
}

/** "x −8.8 µm · y 1.6 µm · z −1.13 cm · t −6.7 ps" of vertex `v`. */
function where(v: number) {
  const g = truthGraph.value!.graph,
    t = g.vcol("t", v);
  return [
    `x ${length(g.vcol("x", v))}`,
    `y ${length(g.vcol("y", v))}`,
    `z ${length(g.vcol("z", v))}`,
    ...(Number.isFinite(t) ? [`t ${plain(1000 * t)} ps`] : []),
  ].join(" · ");
}

/** A collision's facts: where and when it happened, and how many of the file's vertices are that one point. */
function CollisionFacts({ row, place }: { row: number; place: Place }) {
  return (
    <div class="pfacts">
      <p>
        <span class="muted">at</span> {where(row)}
      </p>
      {place.rows.length > 1 && (
        <p class="muted">
          One point for {place.rows.length} of the file's vertices.{" "}
          <Info title="One collision, many vertices">
            <p>
              The generator writes a collision as steps of its calculation (hard scatter, shower branchings,
              hadronizations), each a vertex, and short-lived particles (ρ, ω, π⁰) decay where they were made: all at
              the collision's point, not places of their own. CMSSW's vertex associator stands the collision by the
              lowest-numbered of them; the card shows the collision whichever of its steps is selected.
            </p>
          </Info>
        </p>
      )}
    </div>
  );
}

/** Any other vertex: what decayed or interacted there, what it made, where it is, and how far from the collision it
 *  came from (or that it is at the collision's point). */
function DecayFacts({ row, place }: { row: number; place: Place | null }) {
  const tg = truthGraph.value!,
    g = tg.graph,
    parent = g.into(row),
    made = [...new Set(g.outOf(row).map((r) => g.top[r]))].sort(
      (a, b) => Math.abs(g.col("charge", b)) - Math.abs(g.col("charge", a)) || g.col("energy", b) - g.col("energy", a),
    );
  // its collision's point: the place of the generator's steps of its particles' collision
  const p = parent >= 0 ? parent : made[0],
    key = p === undefined ? undefined : collisionKey(g, layerOf(tg.particles)?.particle?.first, p),
    point = place?.collision ? place : truthPlaces.value?.places.find((c) => c.collision && c.key === key);
  const flight = point
    ? Math.hypot(...["x", "y", "z"].map((c) => g.vcol(c, row) - g.vcol(c, point.rows[0])))
    : undefined;
  const pchip = (r: number) => (
    <ObjChip table={tg.particles} row={g.last[r]} text={truthText(tg.particles, r).split(" · ")[0]} />
  );
  return (
    <div class="pfacts">
      {parent >= 0 && (
        <p>
          {pchip(parent)} <span class="muted">→</span> {spaced(made.slice(0, 8).map(pchip))}
          {made.length > 8 && <span class="muted"> … {made.length} in all</span>}
        </p>
      )}
      <p>
        <span class="muted">at</span> R {length(Math.hypot(g.vcol("x", row), g.vcol("y", row)))}, z{" "}
        {length(g.vcol("z", row))}
        {point && flight !== undefined && (
          <>
            {" "}
            ·{" "}
            {place === point ? (
              <span class="muted">at the point of the</span>
            ) : (
              <>
                {length(flight)} <span class="muted">from the</span>
              </>
            )}{" "}
            {vchip(tg.vertices!, point.rows[0])}
          </>
        )}
      </p>
      {place && place.rows.length > 1 && !place.collision && (
        <p class="muted" title="Reco cannot tell vertices at one place apart: the card counts them as one">
          One place with {place.rows.length - 1} other {place.rows.length > 2 ? "vertices" : "vertex"} (particles that
          decayed where they were made).
        </p>
      )}
    </div>
  );
}
