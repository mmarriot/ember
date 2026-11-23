// The truth levels (truth::LevelFlag bits of the particles' level flags): the tags and search chips, and the levels
// the truth colours can group the particles by.

/** A truth level: its bit in the particles' level flags (SimDataFormats/TruthInfo ParticleData.h truth::LevelFlag), its
 *  plain name, the flag's own name (for experts) and what it means. */
export interface Level {
  bit: number;
  name: string;
  flag: string;
  what: string;
}
/** The levels shown on a particle (its tags) and offered as search chips, in the order of the flags. Bit 0 (stable legs
 *  of the initial state) is not shown. Bits 4-6 are set only by a truth preset (its seeds name the signal process). */
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
  { bit: 4, name: "signal process", flag: "Signal", what: "the particle a truth preset's seeds name (e.g. a top)" },
  {
    bit: 5,
    name: "from the signal process",
    flag: "ReconstructableFromSignal",
    what: "a first reconstructable decay product of the signal process (a π⁰ as one, no neutrinos)",
  },
  {
    bit: 6,
    name: "underlying event",
    flag: "UnderlyingEvent",
    what: "a stable leg of a collision's underlying event (pile-up's too)",
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

/** A class of a class level: its name, and the level bits that make a particle a member (none: every particle of the
 *  signal collision). */
export interface TruthClass {
  name: string;
  mask?: number;
}
/** A level the truth colours can group the particles by: its id (in links), names, and the bits that make a particle
 *  a member (any of them). With `classes`, one colour per class instead of per particle (colour/identities.ts
 *  truthClasses). */
export interface ColourLevel {
  id: string;
  name: string;
  flag: string;
  mask: number;
  only?: boolean; // only the level's particles take colours (the rest grey)
  classes?: TruthClass[];
}
/** The levels offered in the colour key's picker. Bits 4-6 are set only by a truth preset at DIGI. */
export const COLOUR_LEVELS: ColourLevel[] = [
  { id: "gen", name: "generator particle", flag: "bit 2, StableDecayProducts", mask: 1 << 2 },
  { id: "calo", name: "entered the calorimeter", flag: "bit 3, CaloBoundary", mask: 1 << 3 },
  { id: "reco", name: "reconstructable", flag: "bit 10, ReconstructableFinalState", mask: 1 << 10 },
  { id: "parton", name: "parton jet", flag: "bit 7, PartonJets", mask: 1 << 7, only: true },
  { id: "bc", name: "b / c hadron", flag: "bits 8, 9, BHadrons, CHadrons", mask: (1 << 8) | (1 << 9), only: true },
  {
    id: "tau",
    name: "τ visible",
    flag: "bits 11, 12, TauVisibleHadronic, TauVisibleLeptonic",
    mask: 3 << 11,
    only: true,
  },
  {
    id: "collision",
    name: "collision",
    flag: "isSignal",
    mask: 0,
    classes: [{ name: "signal collision" }],
  },
  {
    id: "signal",
    name: "signal process / underlying event",
    flag: "bits 4, 5, 6, Signal, ReconstructableFromSignal, UnderlyingEvent",
    mask: 7 << 4,
    classes: [
      { name: "signal process", mask: 3 << 4 },
      { name: "underlying event", mask: 1 << 6 },
    ],
  },
  {
    id: "taudecay",
    name: "τ decay",
    flag: "bits 11, 12, TauVisibleHadronic, TauVisibleLeptonic",
    mask: 3 << 11,
    classes: [
      { name: "τ → hadrons", mask: 1 << 11 },
      { name: "τ → lepton", mask: 1 << 12 },
    ],
  },
];
/** The colour level of `mask` (one of COLOUR_LEVELS by particle, else named after its bits). */
export function colourLevel(mask: number): ColourLevel {
  const known = COLOUR_LEVELS.find((l) => l.mask === mask && !l.classes);
  if (known) return known;
  const bits = [...Array(32).keys()].filter((b) => (mask >>> b) & 1);
  return { id: `bit${bits.join("-")}`, name: `bit ${bits.join(", ")}`, flag: `bit ${bits.join(", ")}`, mask };
}
