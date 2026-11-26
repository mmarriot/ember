// A reco object's chain in its card: what it is part of, itself, and what it is made of (model/event/chain.ts), to move
// through: a step names its objects when they are few and counts them otherwise; "show" draws it in the view, and a
// step in another part of the detector has a link that looks there. What the truth says of each step is under the
// card's More (PartsTruth): a tag per step (match: the associator's; sim: the simulated energy in its hits).
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { Ladder, Link, Rung } from "../../model/event/chain";
import { factUnit, facts } from "../../model/truth/facts";
import { percent } from "../../model/truth/match";
import {
  anchor,
  bundle,
  domain,
  event,
  focusBar,
  ladder,
  largestFirst,
  layerOf,
  shared,
  levelOn,
  tickLevel,
} from "../../model/store";
import { chip, truthChip } from "./chips";
import { Info, togglePopover } from "../common/Info";
import { GapLink } from "./TruthBlock";
import { chooseDomain } from "../../control/navigate";

const INLINE = 3; // a step with at most this many objects names them; a longer one counts them and unfolds
const LISTED = 40; // objects listed in an unfolded step

/** What the chain's words mean, behind its "i". */
const CHAIN_HELP = (
  <>
    <p>
      Where this object sits among the event's objects: what it is <b>part of</b>, and what it is <b>made of</b>, down
      to the hits.
    </p>
    <p>
      <b>Click</b> an object to look at it in the view; the card stays. <b>Double click</b> to open its card.{" "}
      <b>show</b> draws a step in the view (↓ ↑ move it); a detector's name looks there.
    </p>
    <p>What the truth says of each step is under More, "Its parts' truth".</p>
  </>
);

/** A reco object's chain. */
export function Chain() {
  const l = ladder.value;
  if (!l) return null;
  return (
    <section class="ladder" aria-label="Chain">
      <h4>
        Chain{" "}
        <span class="lanes">
          <Info title="The chain">{CHAIN_HELP}</Info>
        </span>
      </h4>
      <ol>
        {l.above.length > 0 && <li class="part">part of</li>}
        {steps(l.above, "above", "a")}
        <RungRow rung={l.self} role="self" />
        {l.below.length > 0 && <li class="part">made of</li>}
        {steps(l.below, "below", "b")}
        {l.beside.length > 0 && (
          <li
            class="part"
            title="Other objects built only from its parts (e.g. a tau whose PF candidates are all in this jet). They are not parts of it."
          >
            built from its parts
          </li>
        )}
        {steps(l.beside, "beside", "s")}
        {l.other.length > 0 && (
          <li class="part" title="Rows of tables this data set does not draw that are related to it">
            other tables
          </li>
        )}
        {l.other.map((r) => (
          <RungRow rung={r} role="other" key={`o|${r.kind}`} />
        ))}
      </ol>
    </section>
  );
}

/** What the truth says of each step of a reco object's parts (under the card's More): per step, its objects' own
 *  matches, counted, or the simulated energy in its hits; the kinds without an associator, named. Never a match of the
 *  object through its parts. */
export function PartsTruth() {
  const l = ladder.value;
  if (!l) return null;
  const rungs = [...l.below, ...l.beside].filter(says),
    none = noneOf(l);
  if (!rungs.length && !none.length) return null;
  return (
    <div class="partstruth">
      <h5>
        Its parts' truth{" "}
        <Info title="Its parts' truth">
          <p>
            Each step's own truth: <b>match</b>, CMSSW's associator matched its objects to truth particles (
            <i class="qdot q-clean" /> clean, <i class="qdot q-impure" /> impure, <i class="qdot q-unmatched" /> not
            matched); <b>sim</b>, the particles that left the simulated energy in its hits. Click a tag for what it
            means on that step.
          </p>
          <p>
            They are the parts' answers, never added up into a verdict for this object: a pion's track inside a photon's
            cluster is the story, not a contradiction.
          </p>
        </Info>
      </h5>
      <ul class="partlines">
        {rungs.map((rung) => (
          <li>
            <span class="rkind">{rung.kind}</span>
            {rung.links.map((link) => (
              <LinkLine
                link={link}
                single={rung.count === 1}
                several={rung.links.filter((x) => x.kind === link.kind).length > 1}
                at={rung.groups[0]}
              />
            ))}
          </li>
        ))}
      </ul>
      {none.length > 0 && (
        <p class="hint">
          No CMSSW associator, so no truth, for:{" "}
          {none.map(([kind, x], i) => (
            <>
              {i > 0 && "; "}
              <b>{kind}</b>
              {x.label ? ` (${x.label})` : ""}
              {x.gap !== undefined && (
                <>
                  {" "}
                  (<GapLink gap={x.gap} />)
                </>
              )}
            </>
          ))}
        </p>
      )}
    </div>
  );
}

/** Its parts' steps of kinds without an associator (also inside a step that has one: PF clusters, HCAL outer). Not
 *  the steps that hold it: they are not its parts. */
const noneOf = (l: Ladder) =>
  [...l.below, ...l.beside].flatMap((r) => r.links.flatMap((x) => (x.kind === "none" ? [[r.kind, x] as const] : [])));
/** Whether PartsTruth has anything to say of ladder `l`. */
export const partsSay = (l: Ladder | null) => !!l && ([...l.below, ...l.beside].some(says) || noneOf(l).length > 0);

/** Whether a step has a truth statement of its own (an association, or simulated energy in its hits). */
const says = (r: Rung) => r.links.some((x) => x.kind === "match" || x.kind === "fact");

/** A list of steps. */
function steps(rungs: Rung[], role: "above" | "below" | "beside", key: string) {
  return rungs.map((r) => <RungRow rung={r} role={role} key={`${key}|${r.kind}`} />);
}

/** One step of the chain: its kind, its objects (named when few, else counted and unfolding to a list), whether the
 *  view shows it, and its truth links. */
function RungRow({ rung, role }: { rung: Rung; role: "above" | "self" | "below" | "beside" | "other" }) {
  const [open, setOpen] = useState(false);
  const tables = new Set(rung.groups.map((g) => g.table)),
    few = rung.count <= INLINE;
  // The focus's level this step is (store/selection.ts levels). Not while another object is looked at: the view's
  // levels are then that object's (Card.tsx ViewLevels).
  const level =
    !anchor.value && (role === "below" || role === "beside")
      ? focusBar.value.find((lv) => lv.layers.some((x) => tables.has(x.table)))
      : undefined;
  // Its collections ticked; the chain lights the steps ↓ ↑ move through (not those always drawn, e.g. the hits).
  const ticked = !!level && levelOn(level),
    on = ticked && !level.always;
  // A step in a part of the detector the view is not looking at: a click looks there, keeping the selection.
  const cur = domain.value,
    parts = [
      ...new Set(
        rung.groups.map((g) => layerOf(g.table)?.domain).filter((x): x is string => !!x && !shared.value.has(x)),
      ),
    ];
  const elsewhere = role !== "self" && cur && parts.length && !parts.includes(cur) ? parts[0] : undefined;
  return (
    <li class={`rung ${role}${on ? " shown" : ""}`} style={rung.indent ? { "--indent": rung.indent } : undefined}>
      <div class="rhead">
        <span class="rkind" title={layerOf(rung.groups[0]?.table)?.doc}>
          {rung.kind}
        </span>
        {role === "self" ? null : few ? (
          rung.groups.map((g) => (
            <>
              {g.rows.map((r) => chip(g.table, r))}
              {g.held && (
                <span
                  class="muted"
                  title={`No relation names it as containing this object: it holds ${g.held[0]} of this object's ${g.held[1]} parts (worked out in Ember)`}
                >
                  ≈ {g.held[0]} of {g.held[1]} parts
                </span>
              )}
            </>
          ))
        ) : (
          <button class="link count" aria-expanded={open} title="List them" onClick={() => setOpen(!open)}>
            {rung.count.toLocaleString()} {open ? "▾" : "▸"}
          </button>
        )}
        <span class="rtools">
          {elsewhere && (
            <button
              class="link"
              title={`Look at ${elsewhere}, keeping the selection (D)`}
              onClick={() => chooseDomain(elsewhere)}
            >
              {elsewhere} ›
            </button>
          )}
          {level && !elsewhere && (
            <button
              class={`level${ticked ? " on" : ""}${level.always ? " always" : ""}`}
              aria-pressed={ticked}
              title={
                ticked
                  ? "Drawn: its collections are ticked in the side panel. Click to untick them, for the whole event (↓ ↑ move the tick)"
                  : "Tick its collections in the side panel, to draw this step, for the whole event (↓ ↑ move the tick)"
              }
              onClick={() => tickLevel(level.name, !ticked)}
            >
              {ticked ? "shown" : "show"}
            </button>
          )}
        </span>
      </div>
      {!!rung.via?.length && (
        <div
          class="rvia muted"
          title="Relations also lead here from these steps; it is indented under the last step that holds it"
        >
          also via {rung.via.join(", ")}
        </div>
      )}
      {open && !few && (
        <div class="rlist">
          {rung.groups.map((g) => (
            <div>
              {rung.groups.length > 1 && <span class="muted">{layerOf(g.table)?.label} </span>}
              {largestFirst(g.table, g.rows)
                .slice(0, LISTED)
                .map((r) => chip(g.table, r))}
              {g.rows.length > LISTED && <span class="muted"> … {g.rows.length - LISTED} more</span>}
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

const MEASURE: Record<string, string> = { hits: "hits", energy: "energy", pt2: "tracks' pT²" };
/** A step's tag: the word, and behind it what it means on this step. */
const Tag = ({ word, children }: { word: string; children: ComponentChildren }) => (
  <button class="lk" title="What does this mean?" onClick={(e) => togglePopover(e, () => children, word)}>
    {word}
  </button>
);

/** What the truth says about one step, in one line: its objects' own matches, counted, or the simulated energy in its
 *  own hits; never a match of the selected object through its parts. `at`: the step's first collection and rows, for
 *  the simulation's unit. */
function LinkLine({
  link,
  single,
  several,
  at,
}: {
  link: Link;
  single: boolean;
  several: boolean;
  at?: { table: string; rows: number[] };
}) {
  const label = link.label && <span class="muted">{link.label}</span>;
  if (link.kind === "match") {
    const impure = link.good !== undefined ? link.matched - link.clean : 0,
      clean = link.matched - impure,
      none = link.of - link.matched;
    const help = (
      <>
        <p>CMSSW's associator gives each object at most one truth match, its best.</p>
        {link.good !== undefined && (
          <p>
            <i class="qdot q-clean" /> <b>clean</b>: at least {percent(link.good)} of its{" "}
            {MEASURE[link.measure] ?? link.measure} comes from its match.
            <br />
            <i class="qdot q-impure" /> <b>impure</b>: less than that.
          </p>
        )}
        <p>
          <i class="qdot q-unmatched" /> <b>not matched</b>: a fake, or an object the associator does not consider (e.g.
          a candidate without calorimeter energy).
        </p>
      </>
    );
    return (
      <div class="rlink match">
        <Tag word="match">{help}</Tag>
        {label}
        {single && link.matched > 0 && (
          <>
            {truthChip(link.truth, link.partners[0][0])}
            {link.purity !== undefined && (
              <span
                class={link.good === undefined ? "q" : `q q-${impure ? "impure" : "clean"}`}
                title="Purity: the share of it that comes from its match"
              >
                purity {percent(link.purity)}
              </span>
            )}
          </>
        )}
        {!single &&
          clean > 0 &&
          (link.good !== undefined ? (
            <span class="q q-clean">
              <i class="qdot q-clean" />
              {clean} clean
            </span>
          ) : (
            <span class="q">{clean} matched</span>
          ))}
        {!single && impure > 0 && (
          <span class="q q-impure">
            <i class="qdot q-impure" />
            {impure} impure
          </span>
        )}
        {none > 0 && (
          <span class="q q-unmatched">
            {!single && <i class="qdot q-unmatched" />}
            {single ? "not matched" : `${none} not matched`}
          </span>
        )}
      </div>
    );
  }
  if (link.kind === "fact") {
    // Where the simulation records a coarser unit than the hit (a CSC layer), every hit in it shares these particles.
    const f = at && bundle.value ? facts(bundle.value.header).find((x) => x.to === at.table) : undefined;
    const unit =
      f?.unit && at
        ? single
          ? factUnit(f, event.value?.tables[at.table]?.columns, at.rows[0])
          : "simulation unit"
        : undefined;
    const shown = link.particles.filter(([, share]) => share >= 0.005);
    const help = (
      <>
        <p>
          From the simulation: the share of the simulated energy in {single ? "this hit" : "these hits"}
          {link.in ? ` (${link.in})` : ""} that each truth particle left, with its secondaries.
        </p>
        <p>It is the energy deposited in the sensors, not calibrated: compare it only within one detector.</p>
        {unit && <p>The simulation records it per {unit}, not per hit: every hit there shares these particles.</p>}
        {link.unranked && (
          <p>
            This object's kind has no truth of its own, so no particle is ranked through its hits: that would be a match
            built in Ember. Select a hit for its particles.
          </p>
        )}
        {!link.unranked && !shown.length && (
          <p>
            No simulated energy here from an exported particle: it is noise, out-of-time pile-up, or a particle the
            export left out. The file cannot tell which.
          </p>
        )}
      </>
    );
    return (
      <div class="rlink fact">
        <Tag word="sim">{help}</Tag>
        {label}
        {several && link.in && <span class="muted">{link.in}</span>}
        {link.unranked ? (
          <span class="muted">per hit</span>
        ) : !shown.length ? (
          <span class="muted">no simulated energy</span>
        ) : (
          <>
            {shown.slice(0, 3).map(([p, share]) => (
              <>
                {truthChip(link.truth, p)}
                <span class="muted">{percent(share)}</span>
              </>
            ))}
            {shown.length > 3 && <span class="muted">+{shown.length - 3}</span>}
            {unit && <span class="muted">per {unit}</span>}
          </>
        )}
      </div>
    );
  }
  return null; // none (behind the chain's i), or truth of what contains it (a track's hits)
}
