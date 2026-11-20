// What the truth graph says, in words: the truth levels (truth::LevelFlag bits), the levels the truth colours can
// group by, and how a truth particle is named next to reco objects. Plain lookups, no store: the UI and the colours
// share them.

/** A truth level: its bit in the particles' level flags (SimDataFormats/TruthInfo ParticleData.h truth::LevelFlag), its
 *  plain name, the flag's own name (for experts) and what it means. */
export interface Level {
  bit: number;
  name: string;
  flag: string;
  what: string;
}
/** The levels shown on a particle (its tags) and offered as search chips, in the order of the flags. Bit 0 (stable legs
 *  of the initial state), 4 (signal: the `first` column says it), 5 (reconstructable from the signal) and 6 (the
 *  underlying event) are not shown: they repeat what the signal flag and bit 10 say. */
export const LEVELS: Level[] = [
  {
    bit: 1,
    name: "hard process",
    flag: "HardProcess",
    what: "an outgoing leg of the hard scatter (b, W decay products)",
  },
  {
    bit: 2,
    name: "generator particle",
    flag: "StableDecayProducts",
    what: "stable at generator level: what came out of the collision, before the detector",
  },
  {
    bit: 3,
    name: "entered the calorimeter",
    flag: "CaloBoundary",
    what: "crossed from the tracker into the calorimeter: it carries the hits of its shower",
  },
  { bit: 7, name: "parton jet", flag: "PartonJets", what: "a hard-process parton, standing for everything below it" },
  { bit: 8, name: "b hadron", flag: "BHadrons", what: "the weakly decaying hadron of a b chain" },
  { bit: 9, name: "c hadron", flag: "CHadrons", what: "the weakly decaying hadron of a c chain" },
  {
    bit: 10,
    name: "reconstructable",
    flag: "ReconstructableFinalState",
    what: "what the detector can see as one object (a π⁰ is one, not two photons; no neutrinos)",
  },
  { bit: 11, name: "τ visible (hadronic)", flag: "TauVisibleHadronic", what: "the visible part of a hadronic τ decay" },
  { bit: 12, name: "τ visible (leptonic)", flag: "TauVisibleLeptonic", what: "the lepton of a leptonic τ decay" },
];

/** A level the truth colours can group the particles by: its plain name, the flags' names, and the bits (any of them
 *  set makes a particle a member). */
export interface ColourLevel {
  name: string;
  flag: string;
  mask: number;
  only?: boolean; // only the level's particles take colours (the rest grey)
}
/** The levels offered in the colour key's picker. */
export const COLOUR_LEVELS: ColourLevel[] = [
  { name: "generator particle", flag: "bit 2, StableDecayProducts", mask: 1 << 2 },
  { name: "entered the calorimeter", flag: "bit 3, CaloBoundary", mask: 1 << 3 },
  { name: "reconstructable", flag: "bit 10, ReconstructableFinalState", mask: 1 << 10 },
  { name: "b / c hadron", flag: "bits 8, 9, BHadrons, CHadrons", mask: (1 << 8) | (1 << 9), only: true },
];
/** The colour level of `mask` (one of COLOUR_LEVELS, else named after its bits). */
export function colourLevel(mask: number): ColourLevel {
  const known = COLOUR_LEVELS.find((l) => l.mask === mask);
  if (known) return known;
  const bits = [...Array(32).keys()].filter((b) => (mask >>> b) & 1);
  return { name: `bit ${bits.join(", ")}`, flag: `bit ${bits.join(", ")}`, mask };
}

/** The rule the truth colours give their slots by (model/relations.ts identities), as the colour key's title says it:
 *  - `selection`: the particles the selection and its parts are matched to or hold simulated energy in, first;
 *  - `by`: then the rest by simulated energy in one detector of the domain (`in`: the domain, `detectors`: those it
 *    has), by pT among the particles the domain's reco objects are matched to, or by pT among the signal particles. */
export interface SlotRule {
  selection: boolean;
  by: "simEnergy" | "matchedPt" | "pt" | "size";
  in?: string;
  detectors?: string[];
  column?: string; // "size": the layer's colour column
}
/** The key's title for a rule: "top 7 by simulated energy in HGCal". */
export function ruleText(rule: SlotRule, slots: number) {
  const rest =
    rule.by === "simEnergy"
      ? rule.detectors && rule.detectors.length > 1
        ? `by simulated energy within each of ${rule.detectors.join(", ")}, in turn`
        : `by simulated energy in ${rule.in}`
      : rule.by === "matchedPt"
        ? `by pT among the particles matched to ${rule.in} objects`
        : rule.by === "pt"
          ? "signal particles by pT"
          : `by ${rule.column ?? "size"}`;
  return rule.selection
    ? "the selection's particles: those its parts are matched to, then those that left simulated energy in its hits"
    : `top ${slots} ${rest}`;
}
