// The card's truth block (model/truth/statement.ts; docs/viewer.md): its kind's own match (TruthCard.tsx); else its
// lead part's match, named as that part's ("via its track: e⁻ · pT 12.6 · purity 100%"); else that its kind has none.
// Each part's own match is under the card's More (Chain.tsx PartsTruth), never a verdict for the object.
import { DOCS_URL } from "../../model/site/library";
import { percent } from "../../model/truth/match";
import { leadChoice } from "../../model/truth/statement";
import { inText, singular } from "../../model/event/describe";
import { chipText, kindOf, nameOf, pairView, statement, truthText } from "../../model/store";
import { type CrossChoice, cross, crossChoices, crossTo, crossing, partParticles } from "../../control/navigate";
import { truthChip } from "./chips";
import { HitTruth } from "./HitTruth";
import { Info } from "../common/Info";
import { Meter, originOf, TruthCard } from "./TruthCard";
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
              A kind without an associator of its own (a jet, an electron, a TICL candidate) shows its lead part's
              match, named as that part's ("via its track"). Each part's own match is under <b>More</b>: they are never
              added up into a verdict for the object (a pion's track inside a photon's cluster is the story, not a
              contradiction).
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
      {!lead && (
        <p>X lists the particles its parts are matched to; More, "Its parts' truth", has each part's own match.</p>
      )}
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
    const from = originOf(lead.particle),
      part = inText(singular(kindOf(lead.table)));
    return (
      <>
        <p class="truthline answer">
          <span class="muted">
            {lead.beside ? "via the" : "via its"} {part}
            {lead.beside ? " inside it" : ""}
          </span>{" "}
          {truthChip(lead.truth, lead.particle)}
          {from && <span class="muted">from {from}</span>} {why}
        </p>
        <div class="meters">
          {lead.purity !== undefined && (
            <Meter
              name="purity"
              value={lead.purity}
              clean={lead.clean}
              title={`${percent(lead.purity)} of its ${part} comes from the particle (associator)`}
            />
          )}
          {lead.completeness !== undefined && (
            <Meter
              name="completeness"
              value={lead.completeness}
              title={`Its ${part} holds ${percent(lead.completeness)} of the particle (associator)`}
            />
          )}
        </div>
      </>
    );
  }
  return (
    <p class="truthline nolink">
      No match of its own{n > 0 && ` · its parts match ${n} particle${n > 1 ? "s" : ""} (X)`} {why}
    </p>
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

/** When the view's pair is that of the object's part (model/truth/pair.ts delegatedPart: a TICL candidate's candidate
 *  trackster), one line that says so, so that the view's colours never read as the object's own truth. */
function Delegated() {
  const p = pairView.value;
  if (!p?.via || !p.from || p.particle < 0) return null;
  const part = inText(singular(kindOf(p.from.table)));
  return (
    <p class="hint delegated">
      The view shows its {part}'s pair: {truthChip(p.truth, p.particle)}
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
              {truthText(c.truth, c.particle)}
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
