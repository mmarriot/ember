// The truth <-> reco pair the view is coloured by, in the selection's card (Card.tsx; model/pair.ts).
import { percent } from "../model/match";
import { PAIR } from "../model/pair";
import { PALETTES } from "../render/colour";
import { bundle, focus, layerOf, pairView, short, theme } from "../model/store";
import { chip } from "./chips";
import { Info } from "./Info";

/** The truth ↔ reco pair the view is coloured by (model/pair.ts): where the particle's energy went and what the
 *  candidate is made of, as two bars in the view's colours. Hit by hit, the whole generator particle against its
 *  candidate: not the associator's purity and completeness of the selected object, which its match gives. */
export function PairBars() {
  const pair = pairView.value,
    pal = PALETTES[theme.value],
    f = focus.value;
  if (!pair) return null;
  const c = (t: string | undefined, r: number) => (t && r >= 0 ? chip(t, r) : null);
  const eff = pair.efficiency,
    effTotal = eff ? eff.candidate + eff.others + eff.missed : 0,
    pur = pair.purity,
    purTotal = pur ? pur.particle + pur.other : 0;
  const selectedTruth = !!f && !!layerOf(f.table)?.truth;
  // The candidates' detector: simulated energy is counted there only (docs/truth.md "Scope").
  const where = Object.values(bundle.value?.header.relations ?? {}).find(
    (r) => r.match && r.from === pair.reco && r.to === pair.truth,
  )?.match?.in;
  const bar = (parts: [number, string, string][], total: number) => (
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
  const legend = (parts: [number, string, string][], total: number) => (
    <div class="pairlegend">
      {parts.map(([v, colour, label]) => (
        <span>
          <i style={{ background: colour }} />
          {label} <b>{percent(total > 0 ? v / total : undefined)}</b>
        </span>
      ))}
    </div>
  );
  const effParts: [number, string, string][] = eff
    ? [
        [eff.candidate, pal.pair[PAIR.matched], "in its candidate"],
        [eff.others, pal.pair[PAIR.split], "split off"],
        [eff.missed, pal.pair[PAIR.missed], "missed"],
      ]
    : [];
  const purParts: [number, string, string][] = pur
    ? [
        [pur.particle, pal.pair[PAIR.matched], "from the particle"],
        [pur.other, pal.pair[PAIR.contamination], "contamination"],
      ]
    : [];
  const help = (
    <>
      <p>
        With something selected, the view is coloured by its pair: a generator particle (the whole of it, with
        everything it made) and its best candidate, compared hit by hit{where ? ` in ${where}` : ""}.
      </p>
      <p>
        <b>Particle's energy</b>: where its simulated energy went
        {eff && effTotal > 0 ? ` (${short(effTotal)} GeV deposited in the sensors, not calibrated)` : ""}, each hit
        counted once.
      </p>
      <p>
        <b>Candidate's energy</b>: what the rechit energy of its hits is from; a hit counts for the particle that left
        the most simulated energy in it.
      </p>
      <p>These are not the associator's purity and completeness of the selected object: those are under its match.</p>
      {pair.particle < 0 && (
        <p>
          {pair.truth ? "No truth particle is matched to this candidate" : "There is no truth in this file"}: its
          objects are shown as reconstructed, nothing is confirmed.
        </p>
      )}
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
        <span class="badge truth">truth</span> {c(pair.truth, pair.particle) ?? <span class="muted">no particle</span>}
        <span aria-hidden="true">↔</span> <span class="badge reco">reco</span>{" "}
        {c(pair.reco, pair.candidate) ?? <span class="muted">no candidate</span>}
      </p>
      {eff && effTotal > 0 && (
        <div>
          <div class="pairhead">
            <b>Particle's energy</b>{" "}
            <span class="muted">
              {where ? `in ${where} · ` : ""}
              {short(effTotal)} GeV in the sensors
            </span>
          </div>
          {bar(effParts, effTotal)}
          {legend(effParts, effTotal)}
        </div>
      )}
      {pur && purTotal > 0 && (
        <div>
          <div class="pairhead">
            <b>Candidate's energy</b>
            {where && <span class="muted"> in {where}</span>}
          </div>
          {bar(purParts, purTotal)}
          {legend(purParts, purTotal)}
        </div>
      )}
      {pair.particle >= 0 && pair.matched >= 0 && pair.matched !== pair.particle && (
        <p class="hint">
          {c(pair.truth, pair.matched)} is part of the generator particle {c(pair.truth, pair.particle)}: the pair is
          the whole of it.
        </p>
      )}
      {pair.merged.length > 0 && (
        <p class="hint">
          {c(pair.truth, pair.particle)} decayed in the generator: the pair stands for the {pair.merged.length}{" "}
          generator particle{pair.merged.length > 1 ? "s" : ""} it decayed to
          {selectedTruth ? "" : ", which the candidate merges"}:{" "}
          {pair.merged.slice(0, 3).map((m) => (
            <> {c(pair.truth, m)}</>
          ))}
          {pair.merged.length > 3 ? " …" : ""}
        </p>
      )}
    </section>
  );
}
