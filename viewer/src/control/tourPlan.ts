// The guided tour's story (control/tour.ts runs it): an event built up outwards from the collision point and from the
// detector's hits to the physics objects, one step per kind of object. Each step names the kinds it shows (the
// display hint `kind`), so a bundle without them skips it. Pure functions of the header, so they can be tested.
import type { DisplayLayer } from "../io/format";

export interface TourStep {
  kinds: string[]; // the kinds of object shown (display hint `kind`)
  title: string;
  detail: string; // what it is and how it is made, in plain words
  /** What the camera frames: the step's own objects (default), or the whole event drawn. */
  frame?: "own" | "all";
  /** Start a new picture: the earlier steps' objects make way (except the kinds in `keep`). */
  fresh?: boolean;
  keep?: string[];
  /** Kinds shown by earlier steps that make way from this step on (e.g. hits once clusters are made of them). */
  hide?: string[];
}

/** ms a step is shown: time to read its caption while the camera moves, 1 s to find it and then 30 ms a character (a
 *  75-character caption: 3.25 s, 23 characters a second). */
export const stepMs = (detail: string) => Math.min(4500, 1000 + 30 * detail.length);

export const TOUR_STEPS: TourStep[] = [
  {
    kinds: ["beamSpot", "vertex"],
    title: "The collision point",
    detail: "Each marker is a vertex, where two protons collided at the centre of CMS.",
  },
  {
    kinds: ["trackHit", "track", "gsfTrack", "mtdHit"],
    title: "Tracks",
    detail: "Hits join into tracks bent by the 3.8 T field; in Phase 2, the MTD times them.",
  },
  {
    kinds: ["caloHit", "rechit"],
    title: "Calorimeter hits",
    hide: ["trackHit", "mtdHit"],
    detail: "Electrons and photons stop in the ECAL, hadrons in the HCAL behind it.",
  },
  {
    kinds: ["pfCluster", "layerCluster"],
    title: "Clusters",
    hide: ["caloHit", "rechit"],
    detail: "Neighbouring cells are grouped into clusters, ideally one per particle.",
  },
  {
    kinds: ["candidate"],
    title: "Showers in HGCal",
    detail: "HGCal links clusters on successive layers into 3D showers, matched to tracks.",
  },
  {
    kinds: ["muonHit", "muonSegment", "muonTrack"], // not the chambers in use: big boxes over the hits
    title: "Muons",
    detail: "Only muons get through to the chambers outside the magnet, which track them.",
  },
  {
    kinds: ["pfCandidate"],
    title: "Particle flow",
    frame: "all",
    fresh: true,
    keep: ["vertex"],
    detail: "Particle flow combines tracks, clusters and muon hits into one list of particles.",
  },
  {
    kinds: ["jet"],
    title: "Jets",
    detail: "A jet gathers the spray of particles from a quark or gluon within a cone.",
  },
  {
    kinds: ["electron", "photon", "muon", "tau", "met"],
    title: "Leptons, photons, missing momentum",
    frame: "all",
    fresh: true,
    keep: ["vertex", "jet"],
    detail: "The arrow: transverse momentum that doesn't balance, carried off unseen (e.g. neutrinos).",
  },
  {
    kinds: ["secondaryVertex"],
    title: "b tagging",
    detail: "A b hadron flies millimetres before decaying: a displaced vertex tags its jet.",
  },
];

/** The layers a tour step shows: for each of its kinds, the layers the bundle shows by default, else all of them (e.g.
 *  the beam spot), but not truth or background. Of a kind with reconstruction stages (e.g. HGCal showers), only the
 *  last stage. */
export function stepLayers(display: DisplayLayer[], step: Pick<TourStep, "kinds">): DisplayLayer[] {
  return step.kinds.flatMap((kind) => {
    const ds = display.filter((d) => d.kind === kind && !d.truth && !d.context),
      shown = ds.filter((d) => d.visible);
    const last = Math.max(...ds.map((d) => d.stage ?? -Infinity));
    return (shown.length ? shown : ds).filter((d) => d.stage === undefined || d.stage === last);
  });
}

/** The steps a bundle can show (with at least one layer), each with its layers; fewer than two: the tour falls back
 *  to the replay and the showers (test beam, cosmics: no kinds). */
export function tourPlan(display: DisplayLayer[], steps = TOUR_STEPS) {
  const plan = steps.map((step) => ({ step, layers: stepLayers(display, step) })).filter((s) => s.layers.length);
  return plan.length >= 2 ? plan : [];
}
