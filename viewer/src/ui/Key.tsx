// The colour key, at the bottom of the side panel so it stays in sight from every tab. Colour has one meaning at a
// time, and the key's title says which (docs/truth.md): the reconstruction (candidates by particle type, everything
// they are made of in the same colour), the truth (everything by the generator particle it comes from), or, with
// something selected, its truth <-> reco pair. The "Colour by: reco type | truth particle" switch (key T) chooses between the first two. Bundles
// without candidates or truth, and a domain coloured layer by layer, have no key: each layer shows its own colours.
import { CLASSES, type KeyEntry, modeKey, truthLevelOf } from "../model/key";
import { percent } from "../model/match";
import { cached } from "../model/relations";
import { COLOUR_LEVELS, type ColourLevel, colourLevel } from "../model/truth";
import {
  activeMode,
  bundle,
  colourChoice,
  drawnLayers,
  event,
  layerKey,
  layerOf,
  legends,
  modes,
  pairView,
  selection,
  truthColours,
  truthLevel,
  truthName,
  truthRank,
  truthStatuses,
} from "../model/store";
import { Info } from "./Info";
import { jump } from "../control/navigate";

/** A key line's colours, as a saved picture draws them too: a dot (small: pile-up, no truth), a few dots (one colour
 *  per object), or a value ramp. */
export function Swatch({ e }: { e: KeyEntry }) {
  if (e.ramp) return <span class="ramp" style={{ background: `linear-gradient(to right, ${e.colours.join(",")})` }} />;
  if (e.colours.length > 1)
    return (
      <span class="dots">
        {e.colours.map((c) => (
          <i style={{ background: c }} />
        ))}
      </span>
    );
  return <i class={e.small ? "small" : undefined} style={{ background: e.colours[0] }} />;
}

/** The mode's key lines; a line that names a truth particle is a chip that selects it. */
function Lines({ entries }: { entries: KeyEntry[] }) {
  return (
    <ul class="key inline">
      {entries.map((e) => (
        <li>
          <Swatch e={e} />
          {e.ref ? (
            <button class="chip" onClick={() => jump(e.ref!)}>
              {e.label}
            </button>
          ) : (
            e.label
          )}
        </li>
      ))}
    </ul>
  );
}

export function ColourKey() {
  const key = modeKey.value,
    pair = pairView.value,
    mode = activeMode.value;
  if (!key) return null;
  const shown = new Set<number>();
  for (const cls of pair?.classes.values() ?? []) for (const c of cls) shown.add(c);
  return (
    <details class="colourkey" open>
      <summary>
        Colour = {key.title}
        {truthColours.value && (
          <span class="switch" role="group" aria-label="What the colours show (T)" title="What the colours show (T)">
            <span class="muted">Colour by:</span>
            {(["reco", "truth"] as const).map((c) => (
              <button
                class={colourChoice.value === c ? "on" : undefined}
                aria-pressed={colourChoice.value === c}
                onClick={(e) => {
                  e.preventDefault();
                  colourChoice.value = c;
                }}
              >
                {c === "reco" ? "reco type" : "truth particle"}
              </button>
            ))}
          </span>
        )}
      </summary>
      {!pair && mode === "pid" && <PidKey entries={key.entries} />}
      {!pair && mode === "truth" && <LevelPicker />}
      {!pair && mode === "truth" && <TruthKey entries={key.entries} />}
      {pair && ( // the pair itself and its numbers are in the selection's card; here only what each colour means
        <>
          <Lines entries={key.entries} />
          <p class="hint keyhelp">
            Where the particle's hits and energy went{" "}
            <Info title="Colour = truth ↔ reco pair">
              <ul>
                {CLASSES.filter(([c]) => shown.has(c)).map(([, name, what]) => (
                  <li>
                    <b>{name}</b>:{" "}
                    {pair.hitsOf >= 0 && pair.hitsOf !== pair.particle
                      ? what.replace("the particle's", "the shower's")
                      : what}
                  </li>
                ))}
              </ul>
              <p>The particle's numbers (its match, where its energy went) are in the card.</p>
            </Info>
          </p>
        </>
      )}
    </details>
  );
}

/** Candidates by particle type: what the reconstruction says, not the truth. */
function PidKey({ entries }: { entries: KeyEntry[] }) {
  const { roots } = modes.value;
  return (
    <>
      <Lines entries={entries} />
      <p class="hint keyhelp">
        {roots.truth ? "Select anything for its truth ↔ reco pair " : "The reconstruction's particle type "}
        <Info title="Colour = candidate type">
          <p>The reconstruction's particle type: everything a candidate is made of takes its colour.</p>
          <p>
            One colour per type in every layer: PF and TICL candidates of a type look the same, and so do the electrons,
            muons and photons of the physics objects.
          </p>
        </Info>
      </p>
    </>
  );
}

/** Why the view is grey in the truth colours with a selection whose particles take no colour, from what the truth
 *  says of its kind (model/match.ts truthStatus) and of its parts. */
function greyWhy() {
  const sel = selection.value,
    s = sel ? truthStatuses.value.get(sel.table) : undefined,
    pointed = (truthRank.value.prefer?.length ?? 0) > 0,
    kind = sel ? truthName(sel.table) : "";
  if (pointed)
    return "Grey: the particles the selection's parts are matched to, or that left energy in its hits, are pile-up or outside the level chosen: they take no colour.";
  const parts = "and none of its parts is matched to a particle or holds simulated energy";
  if (s?.kind === "none") return `Grey: no CMSSW associator for ${kind}, ${parts}.`;
  if (s?.kind === "match") return `Grey: not matched by the associator, ${parts}.`;
  return `Grey: ${parts.replace(/^and /, "")}.`;
}

/** The level picker: the levels the colours can group the particles by, each with the number of signal particles in
 *  it in this event; the profile's level is the default. */
function LevelPicker() {
  const b = bundle.value!,
    ev = event.value,
    root = modes.value.roots.truth,
    d = root ? layerOf(root) : undefined,
    t = root ? ev?.tables[root] : undefined;
  if (!d?.particle || !t) return null;
  const flags = t.columns[d.particle.flags],
    first = d.particle.first ? t.columns[d.particle.first] : undefined,
    profile = colourLevel(2 ** d.particle.bit),
    current = truthLevelOf(b.header).id;
  const levels = COLOUR_LEVELS.includes(profile) ? COLOUR_LEVELS : [profile, ...COLOUR_LEVELS];
  // Per level, its signal particles in the event: one pass, once per event (not at each render of the key).
  const counts = cached(ev!, `levelCounts|${root}|${d.particle.flags}|${levels.map((l) => l.id).join(",")}`, () => {
    const out = levels.map(() => 0);
    for (let i = 0; flags && i < t.n; i++)
      if (!first || Number(first[i])) levels.forEach((l, j) => (out[j] += Number(flags[i]) & l.mask ? 1 : 0));
    return out;
  });
  // A level with no particle in this event would draw everything grey: offered, but not chosen.
  const option = (l: ColourLevel, j: number) => (
    <option value={l.id} title={l.flag} disabled={!!l.mask && !counts[j] && l.id !== current}>
      {l.name}
      {l.mask ? ` (${counts[j]})` : ""}
      {l === profile ? " · default" : ""}
    </option>
  );
  return (
    <label
      class="levelpick"
      title="What is one colour: a particle of the level and everything below it, or a class of particles"
    >
      Group by{" "}
      <select
        value={current}
        onChange={(e) => {
          const l = levels.find((x) => x.id === (e.target as HTMLSelectElement).value);
          truthLevel.value = !l || l === profile ? null : l;
        }}
      >
        <optgroup label="one colour per particle">{levels.map((l, j) => !l.classes && option(l, j))}</optgroup>
        <optgroup label="one colour per class">{levels.map((l, j) => l.classes && option(l, j))}</optgroup>
      </select>
    </label>
  );
}

/** Everything by the generator particle it comes from; reco objects only where they are a clean match. */
function TruthKey({ entries }: { entries: KeyEntry[] }) {
  const { roots } = modes.value,
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
  const selected = truthRank.value.prefer !== undefined,
    coloured = legend?.kind === "category" && !!legend.items?.length;
  return (
    <>
      <p class="keyrule" title="Which particles have a colour of their own">
        {legend?.kind === "category" ? legend.text : ""}
      </p>
      {selected && !coloured && <p class="hint">{greyWhy()}</p>}
      <Lines entries={entries} />
      <p class="hint keyhelp">
        {faint.length > 0 && <span class="faintkinds">faint: no CMSSW associator for that kind </span>}
        <Info title="Colour = truth particle">
          <p>
            Hits and truth lines take the colour of the particle of the level chosen ("Group by") they come from
            (secondaries, conversions and decays in the detector included). A hit takes the particle that left the most
            simulated energy in it.
          </p>
          <p>
            Seven particles have a colour of their own, as the line under the title says: with a selection, the
            particles its parts are matched to or that left simulated energy in its hits come first; in a calorimeter's
            view, the particles with the most simulated energy in its hits, each detector's in turn (never compared
            across detectors); in the tracker, the particles its tracks are matched to, by pT; in Physics and All, the
            signal particles by pT (|η| &lt; 5 first). The other signal particles are grey.
          </p>
          <p>Before a selection, the signal particles of the level with pT ≥ 1 GeV are drawn as dashed lines.</p>
          <p>
            A reco object takes its particle's colour only when at least {[...rules.values()].join(", or ")} is from it;
            otherwise it is grey. Pile-up is drawn small.
          </p>
          <p>
            Grouped by class ("one colour per class"), a particle takes the class of its nearest ancestor (or itself)
            with that class's level, and pile-up is a class of its own; every class is drawn alike, and a selection
            changes no colour. The signal, underlying-event and τ levels are set only in samples made with a truth
            preset.
          </p>
          <p>No simulated energy: noise, out-of-time pile-up, or a particle the export left out.</p>
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
