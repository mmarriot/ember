// The colour key, at the bottom of the side panel so it stays in sight from every tab. Colour has one meaning at a
// time, and the key's title says which (docs/truth.md): the reconstruction (candidates by particle type, everything
// they are made of in the same colour), the truth (everything by the generator particle it comes from), or, with
// something selected, its truth <-> reco pair. The Reco | Truth switch (key T) chooses between the first two. Bundles
// without candidates or truth, and a domain coloured layer by layer, have no key: each layer shows its own colours.
import type { Header } from "../io/format";
import { facts } from "../model/facts";
import { PAIR, type PairClass } from "../model/pair";
import { percent } from "../model/match";
import { cached } from "../model/relations";
import { COLOUR_LEVELS, colourLevel } from "../model/truth";
import { PALETTES } from "../render/colour";
import {
  activeMode,
  bundle,
  colourChoice,
  domain,
  drawnLayers,
  event,
  layerKey,
  layerOf,
  legends,
  modes,
  pairView,
  selection,
  theme,
  truthColours,
  truthLevel,
  truthName,
  truthRank,
  truthStatuses,
  truthText,
} from "../model/store";
import { Info } from "./Info";
import { jump } from "../control/navigate";

/** The pair view's classes (model/pair.ts): colour, plain name, definition (behind the ⓘ). "Its match": the objects
 *  the associator rates best for the branch, in each detector's compared kind (named in the card). */
const CLASSES: [Exclude<PairClass, 0>, string, string][] = [
  [PAIR.matched, "found", "the particle's (its branch's) hits and objects, in its match"],
  [PAIR.split, "in another object", "the particle's, in another object of the kind compared (split off)"],
  [PAIR.missed, "in no object", "the particle's, in no object of the kind compared (missed)"],
  [PAIR.contamination, "not from it", "in its match, but from other particles or from none (contamination)"],
  [PAIR.reco, "part of its match", "part of a matched object, with no truth of its own (e.g. layer clusters)"],
  [PAIR.branch, "rest of its branch", "other particles of the branch that left hits (e.g. an interaction's products)"],
  [PAIR.uncompared, "not compared", "the particle's hits where no reco kind has an association (HF, HO)"],
];

export function ColourKey() {
  const pair = pairView.value,
    pal = PALETTES[theme.value],
    mode = activeMode.value,
    b = bundle.value;
  if (!b || (!truthColours.value && mode !== "pid")) return null;
  const shown = new Set<number>();
  for (const cls of pair?.classes.values() ?? []) for (const c of cls) shown.add(c);
  const level = truthLevelOf(b.header),
    title = pair
      ? "Colour = truth ↔ reco pair"
      : mode === "truth"
        ? `Colour = ${level.name} (truth)`
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
      {!pair && mode === "truth" && <LevelPicker />}
      {!pair && mode === "truth" && <TruthKey />}
      {pair && ( // the pair itself and its numbers are in the selection's card; here only what each colour means
        <>
          <ul class="key inline">
            {CLASSES.filter(([c]) => shown.has(c)).map(([c, name]) => (
              <li>
                <i style={{ background: pal.pair[c] }} />
                {c === PAIR.reco && pair.particle < 0 ? "no particle: nothing confirmed" : name}
              </li>
            ))}
            <li>
              <i class="small" style={{ background: pal.unassigned }} />
              everything else
            </li>
          </ul>
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

/** The colour level the truth colours use: the one chosen in the key, else the profile's (the truth particles'
 *  `particle` bit). */
function truthLevelOf(header: Header) {
  const root = modes.value.roots.truth,
    d = root ? header.display.find((l) => l.table === root) : undefined;
  return colourLevel(truthLevel.value ?? 2 ** (d?.particle?.bit ?? 2));
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
  if (s?.kind === "none")
    return `Grey: no CMSSW associator for ${kind}${s.gap !== undefined ? ` (gap ${s.gap})` : ""}, ${parts}.`;
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
    profile = 2 ** d.particle.bit,
    current = truthLevelOf(b.header).mask;
  const levels = COLOUR_LEVELS.some((l) => l.mask === profile)
    ? COLOUR_LEVELS
    : [colourLevel(profile), ...COLOUR_LEVELS];
  // Per level, its signal particles in the event: one pass, once per event (not at each render of the key).
  const counts = cached(ev!, `levelCounts|${root}|${d.particle.flags}|${levels.map((l) => l.mask).join(",")}`, () => {
    const out = levels.map(() => 0);
    for (let i = 0; flags && i < t.n; i++)
      if (!first || Number(first[i])) levels.forEach((l, j) => (out[j] += Number(flags[i]) & l.mask ? 1 : 0));
    return out;
  });
  const count = (mask: number) => counts[levels.findIndex((l) => l.mask === mask)];
  return (
    <label
      class="levelpick"
      title="Which truth level is one colour: everything below a particle of the level shares its colour"
    >
      Group by{" "}
      <select
        value={String(current)}
        onChange={(e) => {
          const m = Number((e.target as HTMLSelectElement).value);
          truthLevel.value = m === profile ? null : m;
        }}
      >
        {levels.map((l) => (
          <option value={String(l.mask)}>
            {l.name} ({count(l.mask)}) · {l.flag}
            {l.mask === profile ? " · default" : ""}
          </option>
        ))}
      </select>
    </label>
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
  // In a calorimeter's view the particles are named by their energy, elsewhere by pT and η (docs/truth.md).
  const dom = domain.value,
    calo = !!dom && facts(b.header).some((f) => layerOf(f.to)?.domain === dom);
  const items = legend?.kind === "category" ? (legend.items ?? []) : [],
    selected = truthRank.value.prefer !== undefined;
  return (
    <>
      <p class="keyrule" title="Which particles have a colour of their own">
        {legend?.kind === "category" ? legend.text : ""}
      </p>
      {selected && !items.length && <p class="hint">{greyWhy()}</p>}
      <ul class="key inline">
        {items.map((it) => (
          <li>
            <i style={{ background: it.colour }} />
            {it.ref ? (
              <button class="chip" onClick={() => jump(it.ref!)}>
                {truthText(it.ref.table, it.ref.row, calo) || it.label}
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
