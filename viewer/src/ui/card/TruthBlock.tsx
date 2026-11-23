// The card's truth block, under its header (model/truth/statement.ts; docs/viewer.md): what the truth says about the
// object, in one line first. Its kind's own match (TruthCard.tsx); else its lead part's match, named as that part's
// ("via its track: e⁻ · pT 12.6 · from Z decay · purity 100%"); else that its kind has none. Each part's own match is
// folded below, never a verdict for the object. "Go to truth (X)" crosses over, or opens a chooser of the parts'
// particles.
import { DOCS_URL } from "../../model/site/library";
import { measureWords, percent } from "../../model/truth/match";
import { leadChoice, type PartLine } from "../../model/truth/statement";
import { inText, singular } from "../../model/event/describe";
import { topCopy } from "../../model/truth/truth";
import { chipText, kindOf, nameOf, pairView, statement, stepName, truthGraph, truthText } from "../../model/store";
import { type CrossChoice, cross, crossChoices, crossTo, crossing, partParticles } from "../../control/navigate";
import { categoryNames, chip, truthChip } from "./chips";
import { HitTruth } from "./HitTruth";
import { Info } from "../common/Info";
import { TruthCard } from "./TruthCard";
import { WentTo } from "./Relations";

/** A gap of docs/truth-graph.md, as a link to its table. */
export const GapLink = ({ gap }: { gap?: number }) =>
  gap === undefined ? null : (
    <a class="link" href={`${DOCS_URL}truth-graph/#gap-table`} target="_blank" rel="noopener">
      gap {gap} in the truth-graph notes
    </a>
  );

/** The kind of `table` in running text, plural: "jets", "PF candidates". */
const kinds = (table: string) => inText(kindOf(table));

/** Where a truth particle comes from, as the graph names the vertex that made it ("Z decay", "K⁺ decay"); "" when the
 *  graph names neither the particle that came in nor why. */
function originOf(row: number) {
  const tg = truthGraph.value;
  if (!tg?.vertices) return "";
  const g = tg.graph,
    v = g.col("prodVertexIdx", topCopy(g, row)),
    parent = v >= 0 ? g.into(v) : -1;
  if (parent < 0) return "";
  const name = truthText(tg.particles, parent).split(" · ")[0],
    reason = categoryNames(tg.vertices)[String(g.vcol("reason", v))];
  return reason && !name.startsWith("pdgId") ? `${name} ${reason}` : "";
}

export function TruthBlock({ table, row }: { table: string; row: number }) {
  const st = statement.value,
    go = crossing.value;
  if (!st) return null; // no truth in this data set
  const own = st.own,
    can = !!go.to || go.choices.length > 0;
  return (
    <section class="truthblock" aria-label="Truth">
      <h4>
        Truth{" "}
        <span class="lanes">
          <button
            class="gotruth"
            disabled={!can}
            title={
              !can
                ? go.why
                : go.back && go.to
                  ? `Back to ${nameOf(go.to)} (X)`
                  : go.via
                    ? `Go to its ${inText(singular(kindOf(go.via)))}'s particle (X)`
                    : go.to
                      ? "Go to its truth (X)"
                      : "Choose one of its parts' particles (X)"
            }
            onClick={() => cross(true)}
          >
            {go.back ? "Back (X)" : "Go to truth (X)"}
          </button>
          <Info title="Truth">
            <p>What CMSSW's truth says about this object, built only from the associations in the file.</p>
            <p>
              <b>Its own</b>: the associator's best match for it, with <b>purity</b> (the share of the object that comes
              from the particle) and <b>completeness</b> (the share of the particle that the object has, as the
              associator counts it). A kind with no associator says so; Ember builds no match in its place.
            </p>
            <p>
              <b>Its parts</b>: each part's own match (a track, a PF cluster, a trackster), named as that part's. They
              are never added up into a verdict for the object: a pion's track inside a photon's cluster is the story,
              not a contradiction.
            </p>
          </Info>
        </span>
      </h4>
      {own?.kind === "match" && (
        <>
          <TruthCard table={table} row={row} />
          <WentTo table={table} row={row} relation={own.relation} />
        </>
      )}
      {own?.kind !== "match" && own?.kind !== "fact" && own?.kind !== "container" && (
        <Answer table={table} reason={own?.kind === "none" ? own : undefined} />
      )}
      {own?.kind === "container" && <p class="truthline nolink">Its truth is that of what contains it.</p>}
      {own?.kind === "fact" && <HitTruth />}
      <Delegated />
      {st.parts.length > 0 && (
        <details class="parts">
          <summary>
            Each part's match{" "}
            <Info title="Each part's match">
              <p>
                Each line is the associator's answer for that part
                {own?.kind === "match" ? "" : `, not for this ${inText(singular(kindOf(table)))}`}: CMSSW never adds
                them up into a verdict for the whole, and nor does Ember. A pion's track inside a photon's cluster is
                the story, not a contradiction.
              </p>
              <p>
                <b>clean</b>: at least the kind's purity mark comes from its match; <b>purity</b>: the share of the part
                that comes from it.
              </p>
            </Info>
          </summary>
          <Parts lines={st.parts.filter((l) => !l.beside)} />
          <Parts lines={st.parts.filter((l) => l.beside)} beside />
        </details>
      )}
      <Chooser />
    </section>
  );
}

/** The line for an object without a match of its own: its lead part's match; else that its kind has none, with the
 *  number of particles its parts are matched to. `reason`: why its kind has none, behind the line's i. */
function Answer({ table, reason }: { table: string; reason?: { reason: string; gap?: number } }) {
  const choices = partParticles.value,
    lead = leadChoice(choices),
    n = choices.length;
  const why = reason && (
    <Info title={`Truth for ${kinds(table)}`}>
      <p>
        CMSSW has no truth association for {kinds(table)}: {reason.reason}. Ember builds no match in its place.
      </p>
      {lead && (
        <p>
          The line is the match of its {inText(singular(kindOf(lead.table)))}, as CMSSW's associator gives it for that
          part: the answer for the part, not a verdict for the {inText(singular(kindOf(table)))}.
        </p>
      )}
      {reason.gap !== undefined && (
        <p>
          <GapLink gap={reason.gap} />
        </p>
      )}
    </Info>
  );
  if (lead) {
    const from = originOf(lead.particle);
    return (
      <p class="truthline answer">
        <span class="muted">
          {lead.beside ? "via the" : "via its"} {inText(singular(kindOf(lead.table)))}
          {lead.beside ? " inside it" : ""}
        </span>{" "}
        {truthChip(lead.truth, lead.particle, lead.measure)}
        {from && <span class="muted"> from {from}</span>} <Quality purity={lead.purity} clean={lead.clean} /> {why}
      </p>
    );
  }
  return (
    <p class="truthline nolink">
      No truth match for {kinds(table)} in CMSSW
      {n > 0 && ` · its parts match ${n} particle${n > 1 ? "s" : ""} (X)`} {why}
    </p>
  );
}

/** One line per step of parts with their own association; `beside`: objects built only from its parts, which no
 *  relation names as its parts (an electron's PF clusters, inside its supercluster). */
function Parts({ lines, beside }: { lines: PartLine[]; beside?: boolean }) {
  if (!lines.length) return null;
  return (
    <div>
      {beside && (
        <p class="hint">
          Built from its parts{" "}
          <Info title="Built from its parts">
            <p>
              No relation in the file names these objects as its parts, but all their hits are in it (an electron's PF
              clusters, inside its supercluster).
            </p>
          </Info>
        </p>
      )}
      <ul class="partlines">
        {lines.map((l, i) => {
          const o = l.of === 1 ? l.objects[0] : undefined,
            source = measureWords(l.match),
            again = i > 0 && measureWords(lines[i - 1].match) === source; // said on the line above
          return (
            <li>
              <span class="rkind">{l.of === 1 ? singular(kindOf(l.table)) : stepName(l.table)}</span>{" "}
              {l.of === 1 ? (
                <>
                  {chip(l.table, l.rows[0])}{" "}
                  {o ? (
                    <>
                      → {truthChip(l.truth, o.particle, l.match.measure)} <Quality purity={o.purity} clean={o.clean} />
                    </>
                  ) : (
                    <span class="q q-unmatched">not matched</span>
                  )}
                </>
              ) : (
                <span>
                  <b>{l.matched}</b> of {l.of} matched
                  {l.match.good !== undefined && l.matched > 0 && (
                    <span class="muted" title={`purity at least ${percent(l.match.good)}`}>
                      {" "}
                      ({l.clean} clean)
                    </span>
                  )}
                </span>
              )}{" "}
              {!again && (
                <span class="src" title="Where this line comes from: CMSSW's associator, and what it counts">
                  associator · {source}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A match's purity and completeness, each named. */
export function Quality({ purity, completeness, clean }: { purity?: number; completeness?: number; clean?: boolean }) {
  return (
    <>
      {purity !== undefined && (
        <span
          class={clean === undefined ? "q" : `q q-${clean ? "clean" : "impure"}`}
          title="Purity: the share of the part that comes from its match (associator)"
        >
          purity {percent(purity)}
        </span>
      )}{" "}
      {completeness !== undefined && (
        <span class="q" title="Completeness: the share of the particle that the part has, as the associator counts it">
          completeness {percent(completeness)}
        </span>
      )}
    </>
  );
}

/** When the view's pair is that of the object's part (model/truth/pair.ts delegatedPart), says so, so that it never
 *  reads as the object's own truth. */
function Delegated() {
  const p = pairView.value;
  if (!p?.via || !p.from) return null;
  const part = inText(singular(kindOf(p.from.table))),
    whole = inText(singular(kindOf(p.via.table)));
  return (
    <p class="hint delegated">
      Showing its {part}'s truth: the {whole} has none of its own{" "}
      <Info title={`Its ${part}'s truth`}>
        <p>
          The view shows the truth ↔ reco pair of its {part} {chip(p.from.table, p.from.row)}, not of the {whole}. The{" "}
          {whole} has no truth of its own, and its matched parts all point to one particle. The match is the {part}'s.
        </p>
      </Info>
    </p>
  );
}

/** The choices X opened: the particles the object's parts are matched to, each named with its part. */
function Chooser() {
  const ch = crossChoices.value;
  if (!ch?.length) return null;
  return (
    <div class="chooser" role="dialog" aria-label="Go to a part's truth">
      <p>
        <button class="link" title="Close" onClick={() => (crossChoices.value = null)}>
          ✕
        </button>
        <b>Its parts' particles</b> <span class="muted">(X again: the first)</span>
      </p>
      <ul>
        {ch.map((c: CrossChoice, i: number) => (
          <li>
            <button class="choice" onClick={() => crossTo(c)} title={i === 0 ? "X again goes here" : undefined}>
              {truthText(c.truth, c.particle, c.measure === "energy")}
            </button>{" "}
            <span class="muted">
              its {inText(singular(kindOf(c.table)))} {chipText(c.table, c.row)}
            </span>{" "}
            <Quality purity={c.purity} clean={c.clean} />
          </li>
        ))}
      </ul>
    </div>
  );
}
