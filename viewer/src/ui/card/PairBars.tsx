// The truth <-> reco pair the view is coloured by, in the selection's card (Card.tsx; model/truth/pair.ts): which truth it
// stands for, and per detector what it is compared with and where the branch's simulated energy went.
import { percent } from "../../model/truth/match";
import { PAIR, type PairDetector } from "../../model/truth/pair";
import { PALETTES } from "../../render/colour";
import { labelOf, pairView, short, theme } from "../../model/store";
import { chip } from "./chips";
import { Info } from "../common/Info";

type Part = [number, string, string]; // amount, colour, label

/** The pair (model/truth/pair.ts): the branch it stands for, then one block per detector, each saying which energy it
 *  counts: the simulated energy (Geant4, deposited in the sensors, not calibrated: compare it only within one
 *  detector) or the reconstructed hits' energy. */
export function PairBars() {
  const pair = pairView.value,
    pal = PALETTES[theme.value];
  if (!pair) return null;
  const c = (t: string, r: number) => chip(t, r);
  const bar = (parts: Part[], total: number) => (
    <div class="pairbar">
      {parts
        .filter(([v]) => v > 0)
        .map(([v, colour, label]) => (
          <span
            style={{ width: `${(100 * v) / total}%`, background: colour }}
            title={`${label} ${percent(v / total)}`}
          />
        ))}
    </div>
  );
  const legend = (parts: Part[], total: number) => (
    <div class="pairlegend">
      {parts.map(([v, colour, label]) => (
        <span>
          <i style={{ background: colour }} />
          {label} <b>{percent(total > 0 ? v / total : undefined)}</b>
        </span>
      ))}
    </div>
  );
  const kindName = (t: string) => labelOf(t).toLowerCase(),
    shower = pair.hitsOf >= 0 && pair.hitsOf !== pair.particle;
  const detector = (d: PairDetector) => {
    const sim = d.sim,
      total = sim ? sim.own + sim.descendants : 0;
    const where: Part[] = sim
      ? d.kind
        ? [
            [sim.inMatch, pal.pair[PAIR.matched], "in its match"],
            [sim.inOthers, pal.pair[PAIR.split], "in others"],
            [sim.inNone, pal.pair[PAIR.missed], "in none"],
          ]
        : [[total, pal.pair[PAIR.uncompared], "not compared"]]
      : [];
    const who: Part[] = sim
      ? [
          [sim.own, pal.pair[PAIR.matched], pair.hitsOf === pair.particle ? "its own shower" : "the shower it is in"],
          [sim.descendants, pal.pair[PAIR.branch], "its descendants' showers"],
        ]
      : [];
    const reco = d.reco,
      recoTotal = reco ? reco.branch + reco.other + reco.noTruth : 0;
    const recoParts: Part[] = reco
      ? [
          [reco.branch, pal.pair[PAIR.matched], "from the branch"],
          [reco.other, pal.pair[PAIR.contamination], "other particles"],
          [reco.noTruth, pal.pair[PAIR.reco], "no simulated energy"],
        ]
      : [];
    return (
      <div class="pairdet">
        <div class="pairhead">
          <b>{d.in}</b>{" "}
          {d.kind ? (
            <span class="muted">compared with {kindName(d.kind)}</span>
          ) : (
            <span class="muted">
              not compared:{" "}
              {d.gaps.length
                ? d.gaps.map((g) => `${kindName(g.table)}: ${g.reason ?? "no CMSSW associator"}`).join("; ")
                : "no reco object here has an association to truth"}
            </span>
          )}
        </div>
        {d.kind && (
          <p class="pairline">
            <span class="muted">its match{d.matches.length > 1 ? "es" : ""} (associator):</span>{" "}
            {d.matches.length ? (
              <>
                {d.matches.slice(0, 3).map((m) => c(d.kind!, m))}
                {d.matches.length > 3 && <span class="muted"> and {d.matches.length - 3} more</span>}
              </>
            ) : (
              <span class="muted">none</span>
            )}
          </p>
        )}
        {sim && total > 0 && (
          <>
            <div class="pairhead">
              <span class="muted">
                simulated energy of {shower ? "the shower it is in" : "the branch"}: {short(total)} GeV, not calibrated
              </span>
            </div>
            {bar(where, total)}
            {legend(where, total)}
            {sim.descendants > 0 && legend(who, total)}
          </>
        )}
        {!sim && (
          <p class="hint">No simulated energy per tracker hit in the file: the match's own numbers are under it.</p>
        )}
        {sim && total <= 0 && (
          <p class="hint">
            The file has no simulated hits of it here (only particles that entered the calorimeter have them): the match
            is the associator's alone.
          </p>
        )}
        {reco && recoTotal > 0 && (
          <>
            <div class="pairhead">
              <span class="muted">
                its match's hits, sum of their rechit energy: {short(recoTotal)} GeV, each hit split by its simulated
                shares
              </span>
            </div>
            {bar(recoParts, recoTotal)}
            {legend(recoParts, recoTotal)}
          </>
        )}
      </div>
    );
  };
  const help = (
    <>
      <p>
        With something selected, the view shows one truth branch: a truth particle and everything below it (never its
        siblings or its ancestor's other descendants), and in each detector the reco objects CMSSW's associator rates
        best for it (its matches).
      </p>
      <p>
        <b>Which particle</b>: the one selected; for a reco object, its best match (associator); for a hit, the particle
        that left the most simulated energy in it. Its parents are in the lineage: select one there for a larger branch.
      </p>
      <p>
        <b>Simulated energy</b>: what the branch's particles deposited in each detector's sensors (Geant4), counted once
        per hit, not calibrated: a 67 GeV pion leaves about 0.2 GeV in HGCal. It is a share within one detector only,
        never added across detectors. The file gives each particle that entered the calorimeter its shower as a whole
        (with its own descendants inside the calorimeter), so "its descendants'" is the energy of other particles of the
        branch that entered the calorimeter on their own: conversion electrons, the products of an interaction or a
        decay in the tracker.
      </p>
      <p>
        <b>Rechit energy</b>: the reconstructed energy of the match's hits, each hit split between the particles by the
        simulated energy they left in it.
      </p>
      <p>
        A detector is <b>not compared</b> where its reco objects have no association to truth: its hits are shown
        (simulation), and nothing else is matched in Ember. Objects made of matched ones (PF candidates, jets, TICL
        candidates) have no association of their own and are not part of the pair.
      </p>
      <p>These are not the associator's purity and completeness of the selected object: those are under its match.</p>
    </>
  );
  return (
    <section class="pair" aria-label="Truth and reco pair">
      <h4>
        View colours: the pair{" "}
        <span class="lanes">
          <Info title="The truth ↔ reco pair">{help}</Info>
        </span>
      </h4>
      <p class="pairline">
        <span class="badge truth">truth</span>{" "}
        {pair.particle >= 0 ? (
          <>
            {c(pair.truth, pair.particle)} <span class="muted">and everything below it</span>
          </>
        ) : (
          <span class="muted">no particle: the associator matches this object to none</span>
        )}
        {pair.from && (
          <>
            {" "}
            <span aria-hidden="true">↔</span> <span class="badge reco">reco</span> {c(pair.from.table, pair.from.row)}
          </>
        )}
      </p>
      {pair.hitsOf >= 0 && pair.hitsOf !== pair.particle && (
        <p class="hint">
          {c(pair.truth, pair.particle)} is inside the shower of {c(pair.truth, pair.hitsOf)}, which entered the
          calorimeter: the file has no hits of its own for it, so the hits and energies shown are that whole shower's.
          Its matches are its own (the associator's) first.
        </p>
      )}
      {pair.particle >= 0 && pair.hitsOf < 0 && (
        <p class="hint">The branch left no hits in the calorimeters (in the file).</p>
      )}
      {pair.owners.length > 0 && (
        <p class="hint">
          {pair.owners.length} other particle{pair.owners.length > 1 ? "s" : ""} of the branch entered the calorimeter
          on {pair.owners.length > 1 ? "their" : "its"} own:{" "}
          {pair.owners.slice(0, 3).map((o) => (
            <> {c(pair.truth, o)}</>
          ))}
          {pair.owners.length > 3 ? " …" : ""}
        </p>
      )}
      {pair.detectors.map(detector)}
    </section>
  );
}
