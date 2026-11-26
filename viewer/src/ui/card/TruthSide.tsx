// The card of a truth object: what was reconstructed from it, per detector (the answer), then its facts. Where it
// sits in the truth graph is the crumb under its name (Lineage.tsx); the Truth tab's tree has the rest.
import { percent } from "../../model/truth/match";
import { recoByDetector } from "../../model/event/chain";
import { unassociatedKinds } from "../../model/truth/particles";
import { comparedKind } from "../../model/truth/pair";
import { sameLine } from "../../model/truth/graph";
import { bundle, event, kindOf, modes, reconstructed, truthGraph, truthName, truthStatuses } from "../../model/store";
import { inText, singular } from "../../model/event/describe";
import { cross, crossing } from "../../control/navigate";
import { chip } from "./chips";
import { Info } from "../common/Info";
import { ParticleFacts } from "./ParticleFacts";
import { GapLink } from "./TruthBlock";

/** The button across the reco <-> truth link (X), disabled with the reason when there is nothing across. */
function GoAcross() {
  const go = crossing.value,
    can = !!go.to || go.choices.length > 0;
  return (
    <button class="gotruth" disabled={!can} title={can ? "Go across (X)" : go.why} onClick={() => cross(true)}>
      Go to reco (X)
    </button>
  );
}

/** The kinds with no truth association that truth particle `row` could have reached, and their gaps ("no
 *  associator", not "nothing holds it"); for another truth object, all of them. */
function unanswered(table: string, row: number): { names: string[]; gaps: number[] } {
  const b = bundle.value,
    ev = event.value,
    tg = truthGraph.value,
    st = truthStatuses.value;
  if (!b || !ev) return { names: [], gaps: [] };
  const kinds =
    tg && table === tg.particles
      ? unassociatedKinds(ev, b.header, tg.particles, row, tg.graph, (t) => {
          const s = st.get(t);
          return s?.kind === "none" ? { reason: s.reason, gap: s.gap } : undefined;
        })
      : [...st].flatMap(([t, s]) => (s.kind === "none" ? [{ table: t, gap: s.gap }] : []));
  return {
    names: [...new Set(kinds.map((k) => truthName(k.table)))],
    gaps: [...new Set(kinds.flatMap((k) => (k.gap === undefined ? [] : [k.gap])))],
  };
}

/** A detector where it left hits and nothing of the compared kind holds any of it ("no PF cluster"), or whose reco
 *  has no association to truth ("not compared"). */
function NoneHere({ where }: { where: string }) {
  const b = bundle.value,
    truth = modes.value.roots.truth,
    kind = b && truth ? comparedKind(b.header, truth, where) : undefined;
  return <>{kind ? `no ${inText(singular(kindOf(kind)))} holds any of it` : "not compared"}</>;
}

export function TruthSide({ table, row }: { table: string; row: number }) {
  const rec = reconstructed.value,
    b = bundle.value;
  if (!b) return null;
  const lines = rec ? recoByDetector(b.header, rec) : [],
    none = unanswered(table, row),
    tg = truthGraph.value,
    particle = tg?.particles === table;
  // Merged: the object's own best match is another particle, off this one's line of the graph (a b quark's tracks are
  // its descendants' best matches: they are its own, not a merge).
  const merged = (owner: number) => owner >= 0 && owner !== row && !(particle && tg && sameLine(tg.graph, row, owner));
  const detector = (where: string) => where.charAt(0).toUpperCase() + where.slice(1);
  const help = (
    <>
      <p>
        Per part of the detector, the reco objects of the kind CMSSW compares it with there (its last reconstruction
        step: in HGCal the TICL candidates' tracksters), from CMSSW's truth to reco maps.
      </p>
      <p>
        <b>%</b>: the share of this particle each object holds (completeness, by the associator): of its energy in that
        detector, or of its tracker hits (its descendants' included). The largest first; those holding under 5% are
        counted in "+N" (all of them are under More, Every association).
      </p>
      <p>
        <span class="tag-merged">merged</span>: the object's own best match is another particle (not one above or below
        this one), which it merges this one with.
      </p>
      <p>
        <b>hits</b>: the hits it left simulated energy in. Where it left hits and no object of the kind compared holds
        any of it, the line says so; a detector whose reco has no association to truth (HF, HO) is not compared.
      </p>
      <p>
        <b>Click</b> an object to look at it in the view; <b>double click</b> to open its card.
      </p>
      {none.names.length > 0 && (
        <p>
          No CMSSW associator, so no answer, for: {none.names.join(", ")}
          {none.gaps.length > 0 && (
            <>
              {" "}
              (
              {none.gaps.map((g, i) => (
                <>
                  {i > 0 && ", "}
                  <GapLink gap={g} />
                </>
              ))}
              )
            </>
          )}
          . Ember builds none.
        </p>
      )}
    </>
  );
  return (
    <>
      <section class="recon" aria-label="Reconstructed as">
        <h4>
          Reconstructed as{" "}
          <span class="lanes">
            <GoAcross />
            <Info title="Reconstructed as">{help}</Info>
          </span>
        </h4>
        {lines.length ? (
          <ul class="reconlines">
            {lines.map((l) => (
              <li>
                <div class="rdet">
                  <b>{l.in === l.table ? kindOf(l.table) : detector(l.in)}</b>{" "}
                  <span class="muted">
                    {l.table ? l.in !== l.table ? inText(kindOf(l.table)) : "" : <NoneHere where={l.in} />}
                  </span>
                  {l.hits > 0 && <span class="muted rhits">{l.hits.toLocaleString()} hits</span>}
                </div>
                {l.table && (
                  <div class="robjs">
                    {l.objects.map((o) => (
                      <span class="partner">
                        {chip(
                          l.table!,
                          o.row,
                          `${o.completeness !== undefined ? `it holds ${percent(o.completeness)} of this one` : ""}${merged(o.owner) ? "; its own best match is another particle" : ""}`,
                        )}
                        {o.completeness !== undefined && (
                          <span class="pct" title="The share of this particle it holds (completeness, associator)">
                            {percent(o.completeness)}
                          </span>
                        )}
                        {merged(o.owner) && (
                          <span
                            class="tag-merged"
                            title="Its own best match is another particle: it merges this one with it (associator)"
                          >
                            merged
                          </span>
                        )}
                      </span>
                    ))}
                    {l.others > 0 && (
                      <span class="muted" title="Others holding some of it, most under 5% (all under More)">
                        +{l.others}
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p class="hint">
            No reco object holds any of it
            {table === modes.value.roots.truth ? ", and it left no hits of its own in the file" : ""}.
          </p>
        )}
      </section>
      {table === modes.value.roots.truth && <ParticleFacts row={row} />}
    </>
  );
}
