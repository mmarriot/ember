// A reco object's chain in its card (Card.tsx): what it is part of, itself, and what it is made of (model/chain.ts).
// A step with a truth statement of its own has a tag (match: the associator's; sim: the simulated energy in its hits);
// steps whose kinds have no associator have none, and are named once behind the chain's i. A step names its
// objects when they are few, and counts them otherwise (a click lists them). "show" draws a step in the view (↓ ↑ step
// through them), and a step in another part of the detector has a link that looks there.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { Link, Rung } from "../model/chain";
import { inText, singular } from "../model/describe";
import { factUnit, facts } from "../model/facts";
import { percent } from "../model/match";
import {
  anchor,
  bundle,
  domain,
  event,
  focusBar,
  focusLevel,
  ladder,
  largestFirst,
  layerOf,
  shared,
  shownLevel,
} from "../model/store";
import { chip, truthChip } from "./chips";
import { Info, togglePopover } from "./Info";
import { GapLink } from "./TruthBlock";
import { chooseDomain } from "../control/navigate";

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
      <b>Click</b> an object to look at it in the view; the card stays. <b>Double click</b> to open its card.
    </p>
    <p>A step with truth of its own says so with a tag:</p>
    <ul>
      <li>
        <b>match</b>: CMSSW's associator matched it to a truth particle. <i class="qdot q-clean" /> clean,{" "}
        <i class="qdot q-impure" /> impure, <i class="qdot q-unmatched" /> not matched.
      </li>
      <li>
        <b>sim</b>: from the simulation, the particles that left the energy in these hits.
      </li>
    </ul>
    <p>Click a tag for what it means on that step. Steps of kinds CMSSW has no associator for have no tag.</p>
  </>
);

/** A reco object's chain, with the truth link of every step. */
export function Chain() {
  const l = ladder.value;
  if (!l) return null;
  // every collection of a step without an associator, also inside a step that has one (PF clusters: HCAL outer)
  const none = [...l.above, ...l.below, ...l.beside].flatMap((r) =>
    r.links.flatMap((x) => (x.kind === "none" ? [[r.kind, x] as const] : [])),
  );
  return (
    <section class="ladder" aria-label="Chain">
      <h4>
        Chain{" "}
        <span class="lanes">
          <Info title="The chain">
            {CHAIN_HELP}
            {none.length > 0 && (
              <>
                <p>No CMSSW associator yet, so no truth, for:</p>
                <ul>
                  {none.map(([kind, x]) => (
                    <li>
                      <b>{kind}</b>
                      {x.label ? ` (${x.label})` : ""}: {x.reason}
                      {x.gap !== undefined && (
                        <>
                          {" "}
                          (<GapLink gap={x.gap} />)
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Info>
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

/** Whether a step has a truth statement of its own (an association, or simulated energy in its hits). */
const says = (r: Rung) => r.links.some((x) => x.kind === "match" || x.kind === "fact");

/** A list of steps. */
function steps(rungs: Rung[], role: "above" | "below" | "beside", key: string) {
  return rungs.map((r) => <RungRow rung={r} role={role} key={`${key}|${r.kind}`} />);
}

/** One step of the chain: its kind, its objects (named when few, else counted, unfolding to a list), whether the view
 *  shows it, and its truth links. */
function RungRow({ rung, role }: { rung: Rung; role: "above" | "self" | "below" | "beside" | "other" }) {
  const [open, setOpen] = useState(false);
  const tables = new Set(rung.groups.map((g) => g.table)),
    few = rung.count <= INLINE;
  // The level of the focus this step is (store/selection.ts levels): one drawn on request, or always (the smallest objects,
  // lines). Not while another object is looked at: the view's levels are then that object's (ViewLevels).
  const level =
    !anchor.value && (role === "below" || role === "beside")
      ? focusBar.value.find((lv) => lv.layers.some((x) => tables.has(x.table)))
      : undefined;
  const on = !!level && shownLevel.value === level.name;
  // A step in a part of the detector the view is not looking at: one click looks there, keeping the selection.
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
          {level && !level.always && !elsewhere && (
            <button
              class={on ? "level on" : "level"}
              aria-pressed={on}
              title="Draw this step in the view (↓ ↑ step through them)"
              onClick={() => (focusLevel.value = on ? null : level.name)}
            >
              {on ? "shown" : "show"}
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
      {/* The selection's own truth is the card's truth block; a step without a statement is named behind the chain's
          i. */}
      {role !== "self" &&
        says(rung) &&
        rung.links.map((link) => (
          <LinkLine
            link={link}
            single={rung.count === 1}
            several={rung.links.filter((x) => x.kind === link.kind).length > 1}
            at={rung.groups[0]}
            whose={role === "above" ? inText(singular(rung.kind)) : undefined}
          />
        ))}
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

/** What the truth says about one step, in one line: a tag and numbers. Every line is that step's own statement: its
 *  objects' own matches, counted; the simulated energy in its own hits; never a match of the selected object through
 *  its parts. `at`: the step's first collection and row, for the simulation's unit of a hit. `whose`: for a step that
 *  holds the selection (its vertex), the kind whose own truth it is, said so it does not read as the selection's. */
function LinkLine({
  link,
  single,
  several,
  at,
  whose,
}: {
  link: Link;
  single: boolean;
  several: boolean;
  at?: { table: string; rows: number[] };
  whose?: string;
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
        {whose && <p>This is the {whose}'s own match, not the selected object's.</p>}
      </>
    );
    return (
      <div class="rlink match">
        <Tag word="match">{help}</Tag>
        {whose && <span class="muted">the {whose}'s own:</span>}
        {label}
        {single && link.matched > 0 && (
          <>
            {truthChip(link.truth, link.partners[0][0], link.measure)}
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
                {truthChip(link.truth, p, "energy")}
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
  return null; // none (said behind the chain's i), or no truth of its own (a track's hits: it goes with what contains it)
}
