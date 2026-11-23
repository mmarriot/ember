// A hit's truth in the card's truth block (TruthBlock.tsx): the simulated energy each particle deposited in it, and its
// particle's pair on request (a click on a hit shows the hit, not the pair).
import { simUnit } from "../../model/truth/facts";
import { percent } from "../../model/truth/match";
import { withUnit } from "../../model/event/describe";
import { describe, hitPair, ladder, layerOf, pairView } from "../../model/store";
import { chip } from "./chips";

/** A hit's truth (docs/truth.md "Measures"): the simulated energy each particle deposited in it, not calibrated, from
 *  the hit index (in HF: photoelectrons); its particle's pair on request. */
export function HitTruth() {
  const fact = ladder.value?.self.links.find((l) => l.kind === "fact"),
    pair = pairView.value;
  if (!fact || fact.kind !== "fact") return null;
  const shown = fact.particles.filter(([, share]) => share >= 0.005),
    unit = simUnit(fact.in),
    amount = (x: number) => withUnit(x, unit),
    what = unit === "GeV" ? "simulated energy" : `simulated ${unit}`;
  if (!shown.length) return <p class="truthline nolink">No {what} in this hit (from an exported particle).</p>;
  // the particle by its first `describe` value alone ("π⁻"), for the button
  const first = (row: number) => describe(fact.truth, row, layerOf(fact.truth)?.describe?.columns.slice(1));
  return (
    <div class="hittruth">
      <p class="truthline">
        <span class="badge truth">sim</span> {what} deposited (not calibrated){" "}
        <span class="muted">{amount(fact.total)} in all</span>
      </p>
      <ul class="partlines">
        {shown.slice(0, 4).map(([p, share]) => (
          <li>
            {chip(fact.truth, p)} <span class="muted">{amount(share * fact.total)}</span>{" "}
            <span title={`The share of the hit's ${what} that this particle left`}>
              <b>{percent(share)}</b> of its {what}
            </span>
          </li>
        ))}
        {shown.length > 4 && <li class="muted">and {shown.length - 4} more</li>}
      </ul>
      <button class="link" aria-pressed={!!pair} onClick={() => (hitPair.value = !hitPair.peek())}>
        {pair ? "Hide the particle's pair" : `Show ${first(shown[0][0]) || "its particle"}'s pair in the view`}
      </button>
    </div>
  );
}
