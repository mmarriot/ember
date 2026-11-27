// The card of a truth vertex (docs/viewer.md "A truth vertex"): the answer first, which reco vertex holds it and how
// well (a collision's primary vertex, a b or c hadron decay's secondary vertex), then where it is and what happened
// there. A vertex at a collision's point stands for the collision (truth/collisions.ts): the generator's steps there
// are one place.
import type { Reconstructed } from "../../model/event/chain";
import { bestPartners } from "../../model/event/relations";
import { plain, withUnit } from "../../model/event/describe";
import { copiesBelow, length } from "../../model/truth/graph";
import { percent, quality } from "../../model/truth/match";
import { type CollisionPoint, collisionKey } from "../../model/truth/collisions";
import {
  bundle,
  collisionAt,
  event,
  kindOf,
  layerOf,
  reconstructed,
  truthCollisions,
  truthGraph,
  truthText,
} from "../../model/store";
import { Info } from "../common/Info";
import { categoryNames, chip, ObjChip, spaced, vertexLabel } from "./chips";
import { distance, Meter } from "./TruthCard";
import { GoAcross } from "./TruthSide";

/** A share of a vertex under which another reco vertex holding some of it is not named. */
const MIN = 0.05;

/** The card's answer and facts for truth vertex `row`. */
export function VertexSide({ row }: { row: number }) {
  const tg = truthGraph.value,
    rec = reconstructed.value;
  if (!tg?.vertices || !rec) return null;
  const b = bundle.value!,
    point = collisionAt(row),
    rows = point?.rows ?? [row];
  // What each reco kind's association aims at (its match target). On a collision, the kind that reconstructs
  // collisions answers (the primary vertices); another kind matched to the point's vertices (a secondary vertex whose
  // tracks' particles were made there, not at a displaced decay) is one line of names.
  const target = (table: string) =>
      Object.values(b.header.relations).find((r) => r.association && r.from === table && r.to === tg.vertices)?.match
        ?.target,
    held = rec.reco.filter((r) => r.partners.length && layerOf(r.table)?.repr === "markers"),
    answers = held.filter((l) => !point || target(l.table) === "interaction"),
    aside = point ? held.filter((l) => target(l.table) !== "interaction") : [];
  return (
    <>
      <section class="recon" aria-label="Reconstructed as">
        <h4>
          Reconstructed as{" "}
          <span class="lanes">
            <GoAcross />
            <Info title="Reconstructed as">
              <p>
                The reco vertices that hold this {point ? "collision" : "vertex"}'s tracks, from CMSSW's vertex
                associator: a primary vertex is matched to the collision its tracks' particles came from, a secondary
                vertex to the vertex where they were made (it counts b and c hadron decays).
              </p>
              <p>
                <b>completeness</b>: the share of the {point ? "collision" : "vertex"}'s findable tracks (weighted by
                pT²) that the reco vertex holds. <b>purity</b>: the share of the reco vertex's tracks (pT²) that come
                from it; a clean match from 50%, the mark on the bar.
              </p>
              <p>
                <b>Click</b> a vertex to look at it in the view; <b>double click</b> to open its card.
              </p>
            </Info>
          </span>
        </h4>
        {answers.length ? (
          answers.map((l) => <RecoLine line={l} row={row} rows={rows} point={point} />)
        ) : (
          <p class="hint">{nothing(row, point)}</p>
        )}
        {aside.map((l) => (
          <p
            class="vnote"
            title="Some of their tracks come from particles made at this collision's point (prompt), not at a displaced decay: CMSSW's associator matches those to one of its generator steps"
          >
            <span class="muted">{kindOf(l.table)} holding some of its prompt tracks:</span>{" "}
            {spaced(l.partners.slice(0, 4).map((p) => chip(l.table, p.row)))}
            {l.partners.length > 4 && <span class="muted"> +{l.partners.length - 4}</span>}
          </p>
        ))}
      </section>
      {point ? <CollisionFacts row={row} point={point} /> : <DecayFacts row={row} />}
    </>
  );
}

/** Why no reco vertex holds truth vertex `row`, in words. */
function nothing(row: number, point: CollisionPoint | null) {
  const tg = truthGraph.value!,
    g = tg.graph,
    parent = g.into(row),
    flags = layerOf(tg.particles)?.particle?.flags ?? "levelFlags",
    // bit 8 b hadron, bit 9 c hadron, on any of its generator copies
    heavy = parent >= 0 && copiesBelow(g, g.top[parent]).some((r) => ((g.col(flags, r) >>> 8) & 3) !== 0);
  if (point) return "No primary vertex holds any of its tracks.";
  if (heavy) return "No secondary vertex holds any of its tracks.";
  return "Not compared: CMSSW's vertex associator matches primary vertices to collisions and secondary vertices to b and c hadron decays.";
}

/** One reco kind's answer (`line`, a reconstructed kind of recoOfTruth): its best holder with that holder's purity and
 *  completeness and its distance; whether it is the leading primary vertex; whether its own best match is another;
 *  the others holding at least MIN. `rows`: the truth rows that stand for the vertex (a collision's point). */
function RecoLine({
  line,
  row,
  rows,
  point,
}: {
  line: Reconstructed;
  row: number;
  rows: number[];
  point: CollisionPoint | null;
}) {
  const b = bundle.value!,
    ev = event.value!,
    tg = truthGraph.value!;
  const best = line.partners.find((p) => p.best) ?? line.partners[0],
    others = line.partners.filter((p) => p !== best && (p.completeness ?? 1) >= MIN),
    rest = line.partners.length - 1 - others.length;
  // its purity for this truth vertex: its reco -> truth link to one of `rows`
  const forward = Object.entries(b.header.relations).find(
    ([n, r]) => r.association && r.from === line.table && r.to === tg.vertices && r.match && ev.relations[n],
  );
  let purity: ReturnType<typeof quality>;
  if (forward) {
    const rel = ev.relations[forward[0]];
    for (let k = rel.offsets[best.row]; k < rel.offsets[best.row + 1]; k++)
      if (rows.includes(rel.indices[k])) purity = quality(ev, b.header, forward[0], k, best.row);
  }
  const match = forward?.[1].match,
    away = distance(line.table, best.row, tg.vertices!, row),
    primary = layerOf(line.table)?.kind === "vertex",
    leading = primary && best.row === 0,
    merged = best.owner >= 0 && !rows.includes(best.owner);
  return (
    <div class="vline">
      <p class="truthline">
        <span class="muted">{kindOf(line.table)}</span> {chip(line.table, best.row)}
        {leading && (
          <span class="tag" title="The first of its collection: the vertex CMSSW takes for the hard scatter">
            leading
          </span>
        )}
        {away !== undefined && <span class="muted">{withUnit(away, "cm")} away</span>}
      </p>
      <div class="meters">
        {purity?.purity !== undefined && (
          <Meter
            name="purity"
            value={purity.purity}
            good={match?.good}
            title={`${percent(purity.purity)} of its tracks' pT² comes from this ${point ? "collision" : "vertex"}`}
          />
        )}
        {best.completeness !== undefined && (
          <Meter
            name="completeness"
            value={best.completeness}
            title={`It holds ${percent(best.completeness)} of this ${point ? "collision" : "vertex"}'s tracks' pT²`}
          />
        )}
      </div>
      {merged && (
        <p class="vnote">
          <span class="tag-merged">merged</span> its own best match is{" "}
          <ObjChip table={tg.vertices!} row={best.owner} text={vertexLabel(best.owner, !!collisionAt(best.owner))} />
        </p>
      )}
      {primary && point?.signal && !leading && <NotLeading />}
      {others.length > 0 && (
        <p class="vnote">
          <span class="muted">also holding some (split):</span>{" "}
          {spaced(
            others.map((o) => (
              <span class="partner">
                {chip(line.table, o.row)}
                <span class="pct">{percent(o.completeness)}</span>
              </span>
            )),
          )}
          {rest > 0 && <span class="muted"> +{rest}</span>}
        </p>
      )}
    </div>
  );
}

/** The signal collision whose best primary vertex is not the leading one: what the leading one is matched to. */
function NotLeading() {
  const b = bundle.value!,
    ev = event.value!,
    tg = truthGraph.value!,
    pv = b.header.display.find((d) => d.kind === "vertex" && !d.truth)?.table;
  const rel = pv
    ? Object.entries(b.header.relations).find(
        ([n, r]) => r.association && r.from === pv && r.to === tg.vertices && ev.relations[n],
      )
    : undefined;
  const lead = rel ? bestPartners(ev.relations[rel[0]], rel[1], true, ev.tables[pv!]?.n ?? 0).partner[0] : -1;
  return (
    <p class="vnote">
      <span class="q q-impure">not the leading vertex:</span> {pv && chip(pv, 0)}{" "}
      {lead >= 0 ? (
        <>
          <span class="muted">is matched to</span>{" "}
          <ObjChip table={tg.vertices!} row={lead} text={vertexLabel(lead, !!collisionAt(lead))} />
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

/** A collision's facts: where and when it happened, and which of the generator's steps there this vertex is. */
function CollisionFacts({ row, point }: { row: number; point: CollisionPoint }) {
  const tg = truthGraph.value!,
    reason = categoryNames(tg.vertices)[String(tg.graph.vcol("reason", row))];
  return (
    <div class="pfacts">
      <p>
        <span class="muted">at</span> {where(row)}
      </p>
      {point.rows.length > 1 && (
        <p class="muted">
          One point for the generator's {point.rows.length} steps of this collision
          {reason ? ` (this one: ${reason})` : ""}.{" "}
          <Info title="One collision, many vertices">
            <p>
              The generator writes a collision as steps of its calculation, each a vertex, all at the collision's point:
              they are not places. CMSSW's vertex associator stands the collision by the lowest-numbered of them; the
              card shows the collision, whichever is selected.
            </p>
          </Info>
        </p>
      )}
    </div>
  );
}

/** A vertex away from a collision's point: what decayed or interacted there, what it made, and how far it is from the
 *  collision it came from. */
function DecayFacts({ row }: { row: number }) {
  const tg = truthGraph.value!,
    g = tg.graph,
    parent = g.into(row),
    made = [...new Set(g.outOf(row).map((r) => g.top[r]))].sort(
      (a, b) => Math.abs(g.col("charge", b)) - Math.abs(g.col("charge", a)) || g.col("energy", b) - g.col("energy", a),
    );
  // the collision it came from: the point of its particles' collision
  const p = parent >= 0 ? parent : made[0],
    key = p === undefined ? undefined : collisionKey(g, layerOf(tg.particles)?.particle?.first, p),
    from = truthCollisions.value?.points.find((c) => c.key === key);
  const flight = from ? Math.hypot(...["x", "y", "z"].map((c) => g.vcol(c, row) - g.vcol(c, from.rows[0]))) : undefined;
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
        {from && flight !== undefined && (
          <>
            {" "}
            ·{" "}
            {flight < 1e-4 ? (
              <span class="muted">at the point of the</span>
            ) : (
              <>
                {length(flight)} <span class="muted">from the</span>
              </>
            )}{" "}
            <ObjChip table={tg.vertices!} row={from.rows[0]} text={vertexLabel(from.rows[0], true)} />
          </>
        )}
      </p>
    </div>
  );
}
