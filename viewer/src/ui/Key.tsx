// The colour key, at the bottom of the side panel so it stays in sight from every tab. Colour has one meaning at a
// time, and the key's title says which (docs/truth.md): the reconstruction (candidates by particle type, everything
// they are made of in the same colour), the truth (everything by the generator particle it comes from), or, with
// something selected, its truth <-> reco pair. The Reco | Truth switch (key T) chooses between the first two. Bundles
// without candidates or truth, and a domain coloured layer by layer, have no key: each layer shows its own colours.
import { PAIR, type PairClass } from "../model/pair";
import { percent } from "../model/match";
import { PALETTES } from "../render/colour";
import {
  activeMode,
  bundle,
  colourChoice,
  describe,
  drawnLayers,
  layerKey,
  layerOf,
  legends,
  modes,
  pairView,
  theme,
  truthColours,
  truthName,
  truthStatuses,
} from "../model/store";
import { Info } from "./Info";
import { jump } from "../control/navigate";

/** The pair view's classes, as the regions of the particle and the candidate: colour, name, meaning. */
const CLASSES: [Exclude<PairClass, 0 | 5>, string, string][] = [
  [PAIR.matched, "shared", "the particle's, in its candidate"],
  [PAIR.contamination, "contamination", "in the candidate, from other particles or none"],
  [PAIR.split, "split off", "the particle's, in other candidates"],
  [PAIR.missed, "missed", "the particle's, in no candidate"],
];

export function ColourKey() {
  const pair = pairView.value,
    pal = PALETTES[theme.value],
    mode = activeMode.value,
    b = bundle.value;
  if (!b || (!truthColours.value && mode !== "pid")) return null;
  const title = pair
    ? "Colour = truth ↔ reco pair"
    : mode === "truth"
      ? "Colour = generator particle (truth)"
      : mode === "pid"
        ? "Colour = candidate type (reco)"
        : "Colour = each layer's own";
  return (
    <details class="colourkey" open>
      <summary>
        {title}
        {truthColours.value && (
          <span class="switch" role="group" aria-label="What the colours show (T)" title="What the colours show (T)">
            {(["reco", "truth"] as const).map((c) => (
              <button
                class={colourChoice.value === c ? "on" : undefined}
                aria-pressed={colourChoice.value === c}
                onClick={(e) => {
                  e.preventDefault();
                  colourChoice.value = c;
                }}
              >
                {c === "reco" ? "Reco" : "Truth"}
              </button>
            ))}
          </span>
        )}
      </summary>
      {!pair && mode === "pid" && <PidKey />}
      {!pair && mode === "truth" && <TruthKey />}
      {pair && ( // the pair itself and its numbers are in the selection's card; here only what each colour means
        <ul class="key">
          {pair.particle < 0 ? (
            <li>
              <i style={{ background: pal.pair[PAIR.reco] }} />
              <b>in the candidate</b>: <span>nothing confirmed by truth</span>
            </li>
          ) : (
            CLASSES.map(([c, name, what]) => (
              <li>
                <i style={{ background: pal.pair[c] }} />
                <b>{name}</b>: <span>{what}</span>
              </li>
            ))
          )}
          <li>
            <i class="small" style={{ background: pal.unassigned }} />
            everything else
          </li>
        </ul>
      )}
    </details>
  );
}

/** Candidates by particle type: what the reconstruction says, not the truth. */
function PidKey() {
  const { roots } = modes.value,
    pal = PALETTES[theme.value];
  const candLayer = roots.reco ? layerOf(roots.reco) : undefined,
    pid = candLayer ? legends.value[layerKey(candLayer)] : undefined;
  return (
    <>
      <ul class="key inline">
        {pid?.kind === "category" &&
          pid.items?.map((it) => (
            <li>
              <i style={{ background: it.colour }} />
              {it.label}
            </li>
          ))}
        <li>
          <i class="small" style={{ background: pal.unassigned }} />
          in no candidate
        </li>
      </ul>
      <p class="hint keyhelp">
        Select anything for its truth ↔ reco pair{" "}
        <Info title="Colour = candidate type">
          <p>The reconstruction's particle type: everything a candidate is made of takes its colour.</p>
        </Info>
      </p>
    </>
  );
}

/** Everything by the generator particle it comes from; reco objects only where they are a clean match. */
function TruthKey() {
  const { roots } = modes.value,
    pal = PALETTES[theme.value],
    b = bundle.value!;
  const truthLayer = roots.truth ? layerOf(roots.truth) : undefined,
    legend = truthLayer ? legends.value[layerKey(truthLayer)] : undefined;
  // The clean-match thresholds of the drawn reco kinds, e.g. tracks 75% of hits, calorimeter objects 50% of energy.
  const rules = new Map<string, string>();
  // The kinds drawn now that have no truth of their own (docs/truth.md "Where truth stops").
  const faint = [
    ...new Set(
      b.header.display
        .filter((l) => drawnLayers.value[layerKey(l)] && truthStatuses.value.get(l.table)?.kind === "none")
        .map((l) => truthName(l.table)),
    ),
  ];
  const where = new Map<string, Set<string>>(); // per rule, the detectors it applies to
  for (const info of Object.values(b.header.relations))
    if (info.match?.good !== undefined && info.to === roots.truth) {
      const k = `${info.match.measure}|${info.match.good}`,
        w = where.get(k) ?? new Set();
      where.set(k, w.add(info.match.in));
      rules.set(
        k,
        `${percent(info.match.good)} of its ${info.match.measure === "hits" ? "hits" : "energy"} (${[...w].join(", ")})`,
      );
    }
  return (
    <>
      <ul class="key inline">
        {legend?.kind === "category" &&
          legend.items?.map((it) => (
            <li>
              <i style={{ background: it.colour }} />
              {it.ref ? (
                <button class="chip" onClick={() => jump(it.ref!)}>
                  {describe(it.ref.table, it.ref.row) || it.label}
                </button>
              ) : (
                it.label
              )}
            </li>
          ))}
        <li>
          <i style={{ background: pal.other }} />
          other signal
        </li>
        <li>
          <i class="small" style={{ background: pal.pileup }} />
          pile-up
        </li>
        <li>
          <i class="small" style={{ background: pal.unassigned }} />
          no truth, or no clean match
        </li>
      </ul>
      <p class="hint keyhelp">
        {faint.length > 0 && <span class="faintkinds">faint: no truth for that kind </span>}
        <Info title="Colour = generator particle">
          <p>
            Hits and truth lines take the colour of the generator particle they come from (secondaries, conversions and
            decays in the detector included). A hit takes the particle that left the most simulated energy in it.
          </p>
          <p>
            A reco object takes its particle's colour only when at least {[...rules.values()].join(", or ")} is from it;
            otherwise it is grey. Pile-up is drawn small.
          </p>
          <p>No truth: noise, out-of-time pile-up, or a particle the export left out.</p>
          {faint.length > 0 && (
            <p>
              Faint: kinds the truth graph has no answer for ({faint.join(", ")}). They never take a particle's colour;
              the Truth tab says why.
            </p>
          )}
        </Info>
      </p>
    </>
  );
}
