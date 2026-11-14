// The guided tour's story (ui/tour.ts runs it): an event built up outwards from the collision point and from the
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

export const TOUR_STEPS: TourStep[] = [
  {
    kinds: ["beamSpot", "vertex"],
    title: "The collision point",
    detail:
      "Bunches of protons cross at the centre of CMS. Each marker is a primary vertex: a point where two protons collided, found from the tracks that come out of it.",
  },
  {
    kinds: ["trackHit"],
    title: "Tracker hits",
    detail:
      "Charged particles cross the layers of the silicon tracker around the beam, each layer measuring a precise point. Shown: the hits that tracks use.",
  },
  {
    kinds: ["track", "gsfTrack"],
    title: "Tracks",
    detail:
      "Hits are joined into tracks: helices bent by the 3.8 T magnetic field. The bending gives each charged particle's momentum, the start where it came from.",
  },
  {
    kinds: ["mtdHit"],
    title: "Timing layer",
    detail:
      "Just outside the tracker, a thin timing layer (MTD) records when each charged particle passed, to a few tens of picoseconds: collisions at the same place but different times can be told apart.",
  },
  {
    kinds: ["caloHit", "rechit"],
    title: "Calorimeter hits",
    hide: ["trackHit", "mtdHit"],
    detail:
      "Electrons and photons shower and stop in the electromagnetic calorimeter (ECAL), hadrons in the hadron calorimeter (HCAL) behind it; each cell measures the energy left in it. The endcaps have the high-granularity calorimeter (HGCal).",
  },
  {
    kinds: ["pfCluster", "layerCluster"],
    title: "Clusters",
    hide: ["caloHit", "rechit"],
    detail:
      "Neighbouring cells with energy are grouped into clusters, ideally one per particle, each with an energy and a position.",
  },
  {
    kinds: ["candidate"],
    title: "Showers in HGCal",
    detail:
      "In HGCal, clusters on successive layers are linked into 3D showers, which are matched with the tracks that point at them.",
  },
  {
    kinds: ["muonHit", "muonSegment"],
    title: "Muon chambers", // not the chambers in use: big boxes over the hits
    detail:
      "Only muons get through the calorimeters and the magnet. Chambers in the steel outside it record their hits, combined into short segments in each chamber.",
  },
  {
    kinds: ["muonTrack"],
    title: "Muon tracks",
    detail:
      "Segments are joined into tracks through the muon system, and matched with tracker tracks: a muon's momentum is measured with both.",
  },
  {
    kinds: ["pfCandidate"],
    title: "Particle flow",
    frame: "all",
    fresh: true,
    keep: ["vertex"],
    detail:
      "Particle flow links each track to the clusters and muon hits on its path, and turns the whole event into one list of particles: charged hadrons, electrons, muons, photons, and neutral hadrons from energy no track explains.",
  },
  {
    kinds: ["jet"],
    title: "Jets",
    detail:
      "Quarks and gluons turn into sprays of particles. A jet gathers the particles within a cone into one object, after removing those likely to come from other collisions (pile-up).",
  },
  {
    kinds: ["met"],
    title: "Missing momentum",
    frame: "all",
    detail:
      "Across the beam, the momenta of all the particles should balance. What is missing (the arrow) was carried away unseen, e.g. by neutrinos.",
  },
  {
    kinds: ["electron", "photon", "muon", "tau"],
    title: "Leptons and photons",
    frame: "all",
    fresh: true,
    keep: ["vertex", "jet", "met"],
    detail:
      "Electrons, photons, muons and taus: particles identified from the tracks, clusters and muon hits they left, most of them isolated from the rest of the event.",
  },
  {
    kinds: ["secondaryVertex"],
    title: "b tagging",
    detail:
      "Hadrons with a b quark fly a few millimetres before they decay: their tracks meet at a displaced secondary vertex, which marks the jet around it as a b jet.",
  },
];

/** The layers a tour step shows: for each of its kinds, the layers the bundle shows by default, else all of them (e.g.
 *  the beam spot), but not alternatives (another reconstruction of a kind shown), truth or background. Of a kind with
 *  reconstruction stages (e.g. HGCal showers), only the last stage. */
export function stepLayers(display: DisplayLayer[], step: Pick<TourStep, "kinds">): DisplayLayer[] {
  return step.kinds.flatMap((kind) => {
    const ds = display.filter((d) => d.kind === kind && !d.alternative && !d.truth && !d.context),
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
