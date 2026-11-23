// The card of a truth object: where it sits in the truth graph, and what was reconstructed from it.
import { percent } from "../../model/truth/match";
import { foldReco } from "../../model/event/chain";
import { sharedParts } from "../../model/event/physics";
import { type Ref, sameRef } from "../../model/event/relations";
import { unassociatedKinds } from "../../model/truth/truth";
import { bundle, event, modes, reconstructed, stepName, truthGraph, truthName, truthStatuses } from "../../model/store";
import { cross, crossing } from "../../control/navigate";
import { chip } from "./chips";
import { Info } from "../common/Info";
import { Lineage } from "./Lineage";
import { ParticleFacts } from "./ParticleFacts";
import { GapLink } from "./TruthBlock";

const NONE = new Set<string>();

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

/** The kinds with no truth association that truth particle `row` could have reached (model/truth/truth.ts
 *  unassociatedKinds), and their gaps. Not the kinds that have one and found nothing: "nothing holds it" and "no
 *  associator" are different answers. */
function unassociated(row: number): { names: string[]; gaps: number[] } {
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

/** A truth object: where it sits in the truth graph, and what was reconstructed from it. */
export function TruthSide({ table, row }: { table: string; row: number }) {
  const rec = reconstructed.value,
    root = modes.value.roots.truth;
  // The kinds without an associator: those this particle could have reached; for another truth object, all of them.
  const none = [...truthStatuses.value].flatMap(([t, s]) => (s.kind === "none" ? [{ t, gap: s.gap }] : [])),
    unanswered =
      table === root
        ? unassociated(row)
        : {
            names: [...new Set(none.map(({ t }) => truthName(t)))],
            gaps: [...new Set(none.flatMap(({ gap }) => (gap === undefined ? [] : [gap])))],
          };
  const b = bundle.value,
    ev = event.value;
  // The same objects at several levels (the same parts, e.g. a trackster's layer clusters) are one line.
  const same = (x: Ref, y: Ref) =>
    !!b && !!ev && sharedParts(ev, b.header, x.table, x.row, NONE).some((s) => s.same && sameRef(s, y));
  const found = foldReco(rec?.reco.filter((r) => r.partners.length) ?? [], same),
    empty = rec?.reco.filter((r) => !r.partners.length) ?? [];
  const help = (
    <>
      <p>
        The reco objects that share hits or energy with this truth object, from CMSSW's truth to reco maps, most
        complete first.
      </p>
      <p>
        <b>completeness</b>: the share of this particle that the object holds, by the associator: of its energy in that
        detector (calorimeters: each cell's rechit energy, split between the particles by the simulated energy they left
        in it), or of its tracker hits (tracks, its descendants' hits included). <span class="ok">★ its best</span>: the
        particle is that object's own best match; an object best matched to another particle merges this one into it.
      </p>
      <p>
        <b>Click</b> an object to look at it in the view; <b>double click</b> to open its card.
      </p>
      <p>
        Under each kind, the objects that hold at least 5% of it, at most four; "+N" counts the others (all of them
        under Every association, below). Kinds that show the same objects (the same parts) share one line.
      </p>
      {empty.length > 0 && (
        <p>
          Nothing holds any of it in: {empty.map((r) => stepName(r.table)).join(", ")}. That is not by itself an
          inefficiency: the particle may never have reached that detector.
        </p>
      )}
      {rec && !rec.hits.length && (
        <p>
          No hits are recorded on this particle itself: the file gives hits to the particles that entered the
          calorimeter (each with its own shower). If this one did not, the particles it made carry them: its pair
          (below) shows them.
        </p>
      )}
      {unanswered.names.length > 0 && (
        <p>
          No CMSSW associator, so no answer, for {table === root ? "the kinds it could have reached" : "these kinds"}:{" "}
          {unanswered.names.join(", ")}
          {unanswered.gaps.length > 0 && (
            <>
              {" "}
              (the gaps:{" "}
              {unanswered.gaps.map((g, i) => (
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
      {table === root && (
        <section class="matchcard">
          <ParticleFacts row={row} />
          <Lineage row={row} />
        </section>
      )}
      {rec && (rec.reco.length > 0 || rec.hits.length > 0) && (
        <section class="ladder" aria-label="Reconstructed as">
          <h4>
            Reconstructed as{" "}
            <span class="lanes">
              <GoAcross />
              <Info title="Reconstructed as">{help}</Info>
            </span>
          </h4>
          <ol>
            {found.map((r) => {
              const t = r.tables[0],
                of =
                  r.measure === "hits"
                    ? `hits${r.in ? ` in the ${r.in}` : ""} (with its secondaries')`
                    : r.measure === "pt2"
                      ? "findable tracks (pT²)"
                      : `energy${r.in ? ` in ${r.in}` : ""}`;
              return (
                <li class="rung below">
                  <div class="rhead">
                    <span
                      class="rkind"
                      title={
                        r.tables.length > 1 ? "The same objects at each of these levels (the same parts)" : undefined
                      }
                    >
                      {r.tables.map((x) => stepName(x)).join(", ")}
                    </span>
                  </div>
                  <div class="rlink">
                    {r.partners.map((p) => (
                      <span class="partner">
                        {chip(
                          t,
                          p.row,
                          `${p.completeness !== undefined ? `it holds ${percent(p.completeness)} of this one's ${of}; ` : ""}${p.best ? "this is its own best match" : p.unmatched ? "it has no best match of its own" : "its own best match is another truth object"}`,
                        )}
                        {p.completeness !== undefined && (
                          <span
                            class="muted"
                            title="completeness: the share of this particle the object holds (associator)"
                          >
                            completeness {percent(p.completeness)}
                          </span>
                        )}
                        {p.best && (
                          <span class="ok" title="The particle is this object's own best match (associator)">
                            ★ its best
                          </span>
                        )}
                      </span>
                    ))}
                    {r.folded > 0 && (
                      <span
                        class="muted"
                        title="The others, most holding under 5% of it: all of them under Every association, below"
                      >
                        +{r.folded}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
            {rec.hits.map((h) => (
              <li class="rung below">
                <div class="rhead">
                  <span class="rkind">Hits{h.in && ` · ${h.in}`}</span>
                  <span class="count">{h.hits.toLocaleString()}</span>
                </div>
              </li>
            ))}
          </ol>
          {!found.length && !rec.hits.length && <p class="hint">No reco object holds any of it.</p>}
        </section>
      )}
    </>
  );
}
