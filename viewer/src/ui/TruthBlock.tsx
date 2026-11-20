// The card's truth block, right under its header (Card.tsx; model/statement.ts): what the truth says about the object,
// first. Its kind's own association (its match, with purity and completeness: TruthCard.tsx), or why it has none (no
// CMSSW associator for the kind; not matched; no simulated energy, for a hit); then one line per step of its parts
// that has its own association, each the associator's answer for that part, never a verdict for the object. "Go to
// truth (X)" crosses over, or opens a chooser of the parts' particles when the object has no link of its own.
import { DOCS_URL } from "../model/library";
import { measureWords, percent } from "../model/match";
import type { PartLine } from "../model/statement";
import { inText, singular } from "../model/describe";
import { chipText, kindOf, pairView, statement, stepName, truthText } from "../model/store";
import { type CrossChoice, cross, crossChoices, crossTo, crossing } from "../control/navigate";
import { chip, truthChip } from "./chips";
import { HitTruth } from "./HitTruth";
import { Info } from "./Info";
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
            title={can ? (go.to ? "Go to its truth (X)" : "Choose one of its parts' particles (X)") : go.why}
            onClick={() => cross(true)}
          >
            Go to truth (X)
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
      {own?.kind === "none" && (
        <p class="truthline nolink">
          No CMSSW association for {kinds(table)}{" "}
          <Info title={`No truth for ${kinds(table)}`}>
            <p>CMSSW has no truth for this kind of object yet: {own.reason}.</p>
            <p>
              Ember builds no match of its own. The parts below have their own, each the associator's answer for that
              part.
            </p>
            {own.gap !== undefined && (
              <p>
                <GapLink gap={own.gap} />
              </p>
            )}
          </Info>
        </p>
      )}
      {own?.kind === "container" && <p class="truthline nolink">Its truth is that of what contains it.</p>}
      {own?.kind === "fact" && <HitTruth />}
      <Delegated />
      <Parts lines={st.parts.filter((l) => !l.beside)} own={own?.kind === "match"} table={table} />
      <Parts lines={st.parts.filter((l) => l.beside)} own={own?.kind === "match"} table={table} beside />
      <Chooser />
    </section>
  );
}

/** One line per step of parts with their own association; `beside`: of the objects built only from its parts (an
 *  electron's PF cluster, all of whose hits are in its supercluster), which no relation names as its parts. */
function Parts({ lines, own, table, beside }: { lines: PartLine[]; own: boolean; table: string; beside?: boolean }) {
  if (!lines.length) return null;
  const one = inText(singular(kindOf(table)));
  return (
    <div class="parts">
      <p class="hint">
        {beside ? "Built from its parts: their matches" : "Its parts' matches"}{" "}
        <span class="muted">(associator, per part)</span>{" "}
        <Info title={beside ? "Built from its parts" : "Its parts' matches"}>
          {beside && (
            <p>
              No relation in the file names these objects as its parts, but all their hits are in it (an electron's PF
              clusters, inside its supercluster).
            </p>
          )}
          <p>
            Each line is the associator's answer for that part{own ? "" : `, not for this ${one}`}. Ember never adds
            them up into a verdict for the {one}.
          </p>
        </Info>
      </p>
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
                      → {truthChip(l.truth, o.particle, l.match.measure)}{" "}
                      <Quality purity={o.purity} completeness={o.completeness} clean={o.clean} />
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

/** When the pair the view shows is that of the object's part (model/pair.ts delegatedPart), says so at the top, so
 *  it never reads as the object's own truth. */
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
        <b>No truth link of its own.</b> Go to the particle one of its parts is matched to (X again: the first):
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
