// The colour key, at the bottom of the side panel so it stays in sight from every tab: in a bundle with candidates,
// their particle types (everything they are made of takes the same colour) with nothing selected, and the
// selection's truth <-> reco pair otherwise. Bundles without candidates have none: each layer shows its own colours.
import { PAIR, type PairClass } from "../model/pair";
import { PALETTES } from "../render/colour";
import { activeMode, describe, layerKey, layerOf, legends, modes, pairView, theme } from "../model/store";
import { jump } from "./navigate";

/** The pair view's classes: colour, name, meaning. */
const CLASSES: [Exclude<PairClass, 0>, string, string][] = [
  [PAIR.matched, "matched", "the particle's hits in its candidate"],
  [PAIR.contamination, "contamination", "in the candidate, from other particles or none"],
  [PAIR.split, "split", "the particle's hits in other candidates"],
  [PAIR.missed, "missed", "the particle's hits in no candidate"],
];
const pct = (x: number, total: number) => `${total > 0 ? Math.round((100 * x) / total) : 0}%`;

export function ColourKey() {
  const { roots } = modes.value, pair = pairView.value, pal = PALETTES[theme.value];
  if (activeMode.value !== "pid") return null;
  const candLayer = roots.reco ? layerOf(roots.reco) : undefined, pid = candLayer ? legends.value[layerKey(candLayer)] : undefined;
  const chip = (t: string | undefined, r: number) => (t && r >= 0 ? <button class="chip" onClick={() => jump({ table: t, row: r })}>{describe(t, r) || `#${r}`}</button> : null);
  const eff = pair?.efficiency, effTotal = eff ? eff.candidate + eff.others + eff.missed : 0, pur = pair?.purity;
  return (
    <details class="colourkey" open>
      <summary>{pair ? "Truth ↔ reco pair" : "Colours: particle type"}</summary>
      {!pair && (
        <>
          <ul class="key inline">
            {pid?.kind === "category" && pid.items?.map((it) => <li><i style={{ background: it.colour }} />{it.label}</li>)}
            <li><i class="small" style={{ background: pal.unassigned }} />in no candidate</li>
          </ul>
          <p class="hint">Everything a candidate is made of takes its colour. Select anything for its truth ↔ reco pair.</p>
        </>
      )}
      {pair && (
        <>
          <p class="pairline"><span class="badge truth">truth graph</span> {chip(pair.truth, pair.particle) ?? <span class="muted">no particle</span>}
            <span aria-hidden="true">↔</span> {chip(pair.reco, pair.candidate) ?? <span class="muted">no candidate</span>}</p>
          {pair.particle < 0 && <p class="hint">{pair.truth ? "No truth particle matched" : "No truth in this file"}: the candidate's own objects are shown as matched.</p>}
          <ul class="key">
            {CLASSES.filter(([c]) => pair.particle >= 0 || c === PAIR.matched)
              .map(([c, name, what]) => <li><i style={{ background: pal.pair[c] }} /><b>{pair.particle < 0 ? "in the candidate" : name}</b> {pair.particle >= 0 && <span>{what}</span>}</li>)}
            <li><i class="small" style={{ background: pal.unassigned }} />everything else</li>
          </ul>
          {eff && effTotal > 0 && <p class="hint" title="The particle's simulated energy over its whole shower, in exported hits">
            Particle's energy: {pct(eff.candidate, effTotal)} in its candidate, {pct(eff.others, effTotal)} in other candidates, {pct(eff.missed, effTotal)} in none.</p>}
          {pur && pur.particle + pur.other > 0 && <p class="hint" title="The candidate's hit energy, by the particle that left the most simulated energy in each hit">
            Candidate's energy: {pct(pur.particle, pur.particle + pur.other)} from the particle.</p>}
        </>
      )}
    </details>
  );
}
