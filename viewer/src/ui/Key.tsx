// The colour key, at the bottom of the side panel so it stays in sight from every tab. Colour has one meaning at a
// time, and the key's title says which (docs/truth.md): the reconstruction (candidates by particle type, everything
// they are made of in the same colour), the truth (everything by the generator particle it comes from), or, with
// something selected, its truth <-> reco pair. The Reco | Truth switch (key T) chooses between the first two. Bundles
// without candidates or truth, and a domain coloured layer by layer, have no key: each layer shows its own colours.
import { PAIR, type PairClass } from "../model/pair";
import { percent } from "../model/match";
import { PALETTES } from "../render/colour";
import { activeMode, bundle, colourChoice, describe, layerKey, layerOf, legends, modes, pairView, short, theme } from "../model/store";
import { jump } from "./navigate";

/** The pair view's classes, as the regions of the particle and the candidate: colour, name, meaning. */
const CLASSES: [Exclude<PairClass, 0 | 5>, string, string][] = [
  [PAIR.matched, "shared", "the particle's, in its candidate"],
  [PAIR.contamination, "contamination", "in the candidate, from other particles or none"],
  [PAIR.split, "split off", "the particle's, in other candidates"],
  [PAIR.missed, "missed", "the particle's, in no candidate"],
];
const pct = (x: number, total: number) => percent(total > 0 ? x / total : undefined);

export function ColourKey() {
  const { roots } = modes.value, pair = pairView.value, pal = PALETTES[theme.value], mode = activeMode.value, b = bundle.value;
  if (!b || (!roots.truth && mode !== "pid")) return null;
  const chip = (t: string | undefined, r: number) => (t && r >= 0 ? <button class="chip" onClick={() => jump({ table: t, row: r })}>{describe(t, r) || `#${r}`}</button> : null);
  const eff = pair?.efficiency, effTotal = eff ? eff.candidate + eff.others + eff.missed : 0, pur = pair?.purity;
  const title = pair ? "Colour = truth ↔ reco pair" : mode === "truth" ? "Colour = generator particle (truth)" : mode === "pid" ? "Colour = candidate type (reco)" : "Colour = each layer's own";
  return (
    <details class="colourkey" open>
      <summary>{title}
        {roots.truth && <span class="switch" role="group" aria-label="What the colours show (T)" title="What the colours show (T)">
          {(["reco", "truth"] as const).map((c) => (
            <button class={colourChoice.value === c ? "on" : undefined} aria-pressed={colourChoice.value === c}
              onClick={(e) => { e.preventDefault(); colourChoice.value = c; }}>{c === "reco" ? "Reco" : "Truth"}</button>))}
        </span>}
      </summary>
      {!pair && mode === "pid" && <PidKey />}
      {!pair && mode === "truth" && <TruthKey />}
      {pair && (
        <>
          <p class="pairline"><span class="badge truth">truth</span> {chip(pair.truth, pair.particle) ?? <span class="muted">no particle</span>}
            <span aria-hidden="true">↔</span> <span class="badge reco">reco</span> {chip(pair.reco, pair.candidate) ?? <span class="muted">no candidate</span>}</p>
          {pair.particle < 0 && <p class="hint">{pair.truth ? "No truth particle is matched to this candidate" : "No truth in this file"}: its objects are shown as reconstructed, nothing confirmed.</p>}
          {pair.particle >= 0 && pair.matched >= 0 && pair.matched !== pair.particle &&
            <p class="hint">The selection's particle {chip(pair.truth, pair.matched)} is part of the generator particle {chip(pair.truth, pair.particle)}: the pair is the whole of it.</p>}
          {pair.keys.length > 1 && <p class="hint">{chip(pair.truth, pair.particle)} is above the generator particles (e.g. decayed by the generator): the pair
            stands for the {pair.keys.length} generator particles it made, and the candidate merges them.</p>}
          <ul class="key">
            {pair.particle < 0
              ? <li><i style={{ background: pal.pair[PAIR.reco] }} /><b>in the candidate</b></li>
              : CLASSES.map(([c, name, what]) => <li><i style={{ background: pal.pair[c] }} /><b>{name}</b>: <span>{what}</span></li>)}
            <li><i class="small" style={{ background: pal.unassigned }} />everything else</li>
          </ul>
          {eff && effTotal > 0 && <p class="hint" title="Simulated energy of the generator particle and everything it made, in HGCal hits of the export, each hit counted once. It is the energy deposited in the sensors (sampling), not calibrated: compare it only with itself">
            Completeness, of the particle's simulated energy in HGCal ({short(effTotal)} GeV in the sensors): {pct(eff.candidate, effTotal)} in its candidate, {pct(eff.others, effTotal)} in other candidates, {pct(eff.missed, effTotal)} in none.</p>}
          {pur && pur.particle + pur.other > 0 && <p class="hint" title="Rechit energy of the candidate's HGCal hits; each hit counted for the particle that left the most simulated energy in it">
            Purity, the candidate's hit energy: {pct(pur.particle, pur.particle + pur.other)} from the particle.</p>}
        </>
      )}
    </details>
  );
}

/** Candidates by particle type: what the reconstruction says, not the truth. */
function PidKey() {
  const { roots } = modes.value, pal = PALETTES[theme.value];
  const candLayer = roots.reco ? layerOf(roots.reco) : undefined, pid = candLayer ? legends.value[layerKey(candLayer)] : undefined;
  return (
    <>
      <ul class="key inline">
        {pid?.kind === "category" && pid.items?.map((it) => <li><i style={{ background: it.colour }} />{it.label}</li>)}
        <li><i class="small" style={{ background: pal.unassigned }} />in no candidate</li>
      </ul>
      <p class="hint">The reconstruction's particle type: everything a candidate is made of takes its colour. Select anything for its truth ↔ reco pair.</p>
    </>
  );
}

/** Everything by the generator particle it comes from; reco objects only where they are a clean match. */
function TruthKey() {
  const { roots } = modes.value, pal = PALETTES[theme.value], b = bundle.value!;
  const truthLayer = roots.truth ? layerOf(roots.truth) : undefined, legend = truthLayer ? legends.value[layerKey(truthLayer)] : undefined;
  // The clean-match thresholds of the drawn reco kinds, e.g. tracks 75% of hits, calorimeter objects 50% of energy.
  const rules = new Map<string, string>();
  for (const info of Object.values(b.header.relations))
    if (info.match?.good !== undefined && info.to === roots.truth)
      rules.set(`${info.match.measure}|${info.match.good}`, `${percent(info.match.good)} of its ${info.match.measure === "hits" ? "hits" : "energy"} (${info.match.in})`);
  return (
    <>
      <ul class="key inline">
        {legend?.kind === "category" && legend.items?.map((it) => (
          <li><i style={{ background: it.colour }} />{it.ref ? <button class="chip" onClick={() => jump(it.ref!)}>{describe(it.ref.table, it.ref.row) || it.label}</button> : it.label}</li>))}
        <li><i style={{ background: pal.other }} />other signal</li>
        <li><i class="small" style={{ background: pal.pileup }} />pile-up</li>
        <li><i class="small" style={{ background: pal.unassigned }} />no truth</li>
      </ul>
      <p class="hint" title="Hits take the particle that left the most simulated energy in them. No truth: noise, out-of-time pile-up, or a particle the export left out.">
        Hits and truth lines: the generator particle they come from (secondaries, conversions and decays in the detector
        included). A reco object takes its particle's colour only when at least {[...rules.values()].join(", or ") || "half"} is from it; otherwise grey.</p>
    </>
  );
}
