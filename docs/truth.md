# Truth in Ember: what a reco object is compared with, and how it is shown

This page gives the rules that every part of the display follows when it puts simulation truth next to the
reconstruction. With these rules, HGCal, the tracker and every subdetector added later say the same thing in the
same words.

[Truth graph](truth-graph.md) says where the truth comes from, and what is still missing in CMSSW. This page says what
the display does with it. To add a new kind of reco object, you fill one row of the table in
[Each kind's contract](#each-kinds-contract) and add one `match` hint to its profile. You do not need to repeat the
study.

## Principles

1. **One source.** Truth is the CMSSW truth graph: particles and vertices with their level flags, the hit index
   (simulated energy per particle and detector cell), and the branch associators. Ember never uses CaloParticle,
   SimCluster, TrackingParticle, genParticles or GenJets.
2. **Three kinds of statement, always labelled:**
   - *simulation*: a fact. For example, "this hit has 60% of its simulated energy from this particle";
   - *association*: the CMSSW associator's answer. It is called the "best match", with its score; never "is";
   - *derived in Ember*: a stand-in where CMSSW has no answer, for example the particle of a layer cluster.
3. **Colour means one thing at a time.** The colour key's title says which: `Colour = candidate type (reco)`,
   `Colour = generator particle (truth)` or `Colour = truth ↔ reco pair`. Truth is drawn dashed, reco solid.
4. **A reco object is never painted as truth.** It takes a particle's colour only when its match is clean: its
   purity is at or above its kind's threshold. Otherwise it is grey. An object without any truth is neutral, never the
   "shared" green. A kind with no truth of its own is drawn faint, so that it cannot be mistaken for an unmatched
   (fake) object of a matched kind.
5. **Numbers are linear and say what they divide by.** Purity and completeness are percentages, and they name the
   quantity counted and the detector ("21 of 21 hits", "of the particle's energy in HGCal"). How each is counted is
   behind the **i** next to it. The associator's score is a ranking (0 is best). It is shown as a ranking, never as a
   fraction.

## Two levels: the particle, and each kind's target

One level of the truth cannot serve every detector. Measured on ttbar without pile-up (10 events, generator-stable
particles with pT > 1 GeV and |η| < 3):

- 21% of charged hadrons interact in the tracker;
- 54% of photons convert before the calorimeter;
- 42% of neutral hadrons decay in flight.

The particles that enter the calorimeter (truth level CaloBoundary) carry 99.8–100% of the calorimeter's simulated
energy, but only 57–62% of the tracker hits. So Ember uses two levels:

- **The particle** colours and groups everything. It is the profile's `particle` level on the truth layer. In
  `hgcal` (and so in `cms`) it is truth::LevelFlag bit 2, StableDecayProducts: the **generator particle**, stable at
  generator level (`hasGen && status == 1`). This is what came out of the collision, before the detector. Every truth
  particle below it belongs to it and takes its colour, in every subdetector: Geant4 secondaries, conversion
  electrons, the daughters of an interaction or of a decay in flight. For example, the track of a conversion
  electron and the showers of that photon share the photon's colour. The lineage in the inspector shows how they are
  related.
- **The target** is what one reco kind reconstructs. Its association declares it in `match.target`:
  - tracks: the particle whose own tracker hits they collected (`trackerHits`);
  - calorimeter objects: the particle that entered the calorimeter (`caloBoundary`);
  - physics objects: the generator particle (`particle`).

  Purity and completeness are measured against the associator's match, at the level that the associator picked.

A match **below** the particle (a shower secondary, a conversion electron) is part of it. The inspector says "the
match is part of the generator particle X". A match **above** the particle means that the object merges several
generator particles: for example a π⁰ or an ω that the generator decayed. The pair view then stands for all the
generator particles below the match, and the key says so.

**Why the generator level.** Compared on ttbar without pile-up (5 events):

| colour level | groups owning HGCal hits | of them, resonances or heavy hadrons | reco matches above the level |
|---|---|---|---|
| highest ancestor that owns hits or is matched (Ember before) | 797 | 5 (K*⁰, B, …): colours given to resonances | 0 |
| **StableDecayProducts** (bit 2, generator particle) | **579** | **0** | 12 of 617 |
| ReconstructableFinalState (bit 10) | 503 | 0, but every π⁰ is one group | 8 of 617 |

Bit 10 differs from bit 2 almost only by the π⁰: in 10 events, 1945 photons become 1064 π⁰, and the neutrinos are
dropped. Bit 10 is the graph's own "reconstructable" level, and it matches TICL's π⁰ candidate type. But it calls a
trackster that cleanly resolves one photon of a low-energy π⁰ a split. Bit 2 matches CMS's legacy targets
(CaloParticle, PF photons, GenJet constituents), and shows a merged π⁰ as merging two particles. The choice is one
setting in the profile (`"particle": {"bit": 2}`). Bit 2 is the default until the owners decide otherwise.

## Measures

For a reco object R and its matched truth branch B (a particle and everything below it), in R's detector:

| | definition | tracks (`measure: "hits"`) | calorimeter objects (`measure: "energy"`) |
|---|---|---|---|
| **purity** | the share of R that comes from B | shared hits / track hits (nPixel + nOT, or nhits); equals 1 − score (for all but 1 of 7744 tracks at 200 pile-up) | shared energy / raw energy, both on the rechit scale (measured ≤ 1) |
| **completeness** | the share of B that is in R | 1 − TruthToReco score = shared cells / all tracker cells of B's branch (its secondaries' cells included, so it dilutes) | TruthToReco `sharedFraction`: of B's energy in HGCal only |
| **score** | the associator's ranking, 0 is best | linear (1 − purity) | squared and energy weighted: not 1 − purity |
| **clean** | purity ≥ `good` | 0.75 (CMS tracking validation: MultiTrackValidator) | 0.5 (the dominant particle). Layer clusters, whose particle Ember derives, use the same 0.5 of their simulated energy. |

These numbers appear in three places: the inspector's truth card (per object), the truth mode (the clean test decides
the colour), and the pair view (the purity and completeness of the pair, from the hits).

**The pair view's regions.** With something selected, the viewer compares the particle (the whole of its generator
particle) with its best candidate (the candidate that the TruthToReco association rates highest for it), hit by hit.
Each hit counts for the particle that left the most simulated energy in it:

| class | meaning |
|---|---|
| shared | the particle's, in its candidate |
| contamination | in the candidate, from other particles or from none |
| split off | the particle's, in other candidates |
| missed | the particle's, in no candidate |
| in the candidate (neutral) | a candidate with no truth match: nothing is confirmed |

The key gives completeness and purity. Completeness is a share of the particle's simulated energy in HGCal, deposited
in the sensors and not calibrated: compare it only with itself. Purity is a share of the candidate's rechit energy.

## Each kind's contract

Every reco → truth association in a profile carries a `match` hint ([Profiles](profiles.md#relations)). Its
truth → reco partner carries the completeness. From these, the viewer derives the same things for every kind: the
truth card, the clean test in the truth mode, the units and the wording.

| kind | target | measure, where | purity over | clean | completeness | status |
|---|---|---|---|---|---|---|
| tracks (generalTracks) | trackerHits | hits, tracker | nPixelHits + nOTHits | 0.75 | 1 − score (branch hits) | match |
| tracksters, linked tracksters, superclusters, interpretations | caloBoundary | energy, HGCal | raw energy | 0.5 | sharedFraction | match |
| TICL candidates | caloBoundary | energy, HGCal | raw energy | 0.5 | sharedFraction | match (calorimeter only: a track-only candidate has no match; the card shows its track's) |
| ECAL / HCAL (HB) PF clusters | caloBoundary | energy, ECAL or HCAL | raw `energy` (never HCAL `correctedEnergy`: it is unset or negative) | 0.5 | sharedFraction (of the branch's ECAL or HCAL energy) | match |
| primary / secondary vertices | the collision their tracks come from / their immediate production vertex, aiming at b and c hadron decays (a truth **vertex**) | pT² of tracks (tracks with score ≤ 0.25 vote) | the weight is the purity (`match.purity`) | 0.5 | TruthToReco fraction (of the truth vertex's findable tracks' pT²) | match; drawn neutral in the truth colours (a vertex has no particle colour); the card names the collision (signal or pile-up) or the vertex, and its distance |
| HGCal hits | — (simulation fact) | simulated energy per particle, HGCal | — | — | — | fact |
| ECAL barrel, HCAL HB / HO, HF hits | — (simulation fact) | simulated energy per particle, ECAL / HCAL / HF (HF: photoelectrons) | — | — | — | fact |
| muon hits (DT, CSC, RPC, GEM) | — (simulation fact), per unit that the simulation records: DT wire, CSC layer, RPC roll, GEM partition (`fact.unit`) | simulated energy loss per particle, muon system | — | — | — | fact; the hit's line names the unit ("per CSC layer"), and the fact tag says that every hit there shares these particles |
| MTD hits | — (simulation fact) with sim time | — | — | — | — | none: not exported (only 60% of the MTD cells at 200 pile-up are under particles that entered the calorimeter; gap 19) |
| HGCal layer clusters | caloBoundary | energy, HGCal | — | — | — | derived in Ember (no associator: gap 1; `truthGap.derived`) |
| HF, HO PF clusters | caloBoundary | energy, HCAL | raw energy | 0.5 | — | none: no associator configured in CMSSW (gap 15) |
| muon segments | particle crossing the chamber | hits, muon system | segment hits | 0.75 | of its hits in the chamber | none: no adapter or associator (gap 17) |
| reco, standalone, global muons | muon with its own muon hits (no graph level yet) | hits per stub, tracker and muon | stub hits | 0.75 per stub | 0.5 per stub | none (gap 18); the inner track's own match, named as the track's |
| MTD clusters, track times | particle with its own MTD hits | hits, MTD | cluster cells | 0.75 | — | none (gap 19) |
| PF candidates | generator particle (ReconstructableFinalState) | constituents (track + clusters) | — | 0.5 | — | none (gap 20); one constituent's own match, named as the constituent's |
| jets | generator jets of visible signal generator particles (no clustering in the graph) | constituents | — | — | — | none (gap 21); never GenJets |
| MET | −ΣpT of visible signal generator particles | vector | — | — | — | none (gap 22); never GenMET |
| electrons, photons | generator e / γ (for a conversion: the photon's PairConversion vertex) | constituents (supercluster + GSF track) | — | 0.5 | — | none (gap 23) |
| taus | TauVisibleHadronic | constituents | — | — | — | none (gap 24) |

The status words are the viewer's (`truthStatus`, below):

- *match*: matched by CMSSW;
- *fact*: a simulation fact;
- *derived*: derived in Ember;
- *none*: no truth for this kind, with the reason and gap number from the kind's `truthGap`.

The thresholds follow each domain's reference validation, so Ember agrees with DQM.

### Adding a kind

1. Name its **target** in the terms of the graph: one of the levels above, or a new one. For a new level, say which
   flag or hit-index test selects it, and why the reconstruction algorithm aims at it. Note where it disagrees with
   the other subdetectors' targets (conversions, interactions, decays in flight, bremsstrahlung), and check that the
   particle level reconciles them.
2. Export its association from the truth graph: AdaptiveNominal reco → truth, and TruthToReco. If CMSSW has none, do
   not substitute one (no ΔR, and no matching through hits in Ember). Instead, list the gap in
   [Truth graph](truth-graph.md), and give the kind a `truthGap` (`reason`, `gap`) in its profile. The viewer then
   says so everywhere ([Where truth stops](#where-truth-stops)). When the associator arrives, add the relation with
   its `match` hint (step 3), and delete the `truthGap`.
3. Add the `match` hint to the reco → truth relation (`target`, `measure`, `in`, `shared`, `over`, `good`), and the
   completeness to the truth → reco relation. Take `good` from the domain's validation.
4. If the kind has its own hits, export the hit index for its channel (simulated energy per particle and cell). Then
   its hits show their particle as a fact, not through the reco match. Mark the truth → hit relation
   `"fact": {"in": "<detector>"}`, with the same detector names as the `match` hints.
5. Never let the kind take truth through its parts or its constituents ([Constituents](#constituents)).
6. Check on a sample: purity ≤ 1 everywhere, and a few objects in the inspector against CMSSW's validation.

## Where truth stops

Every drawn kind has one truth status. The viewer works it out from the bundle (`truthStatus`,
`viewer/src/model/match.ts`), in this order:

1. **match**: the kind has its own reco → truth relation with a `match` hint;
2. **fact**: hits with a `fact` relation;
3. **derived**: `truthGap.derived` (HGCal layer clusters only);
4. **none**: the kind's `truthGap`, or else "no truth association exported for this kind";
5. for a part drawn with what contains it (the hits of a track): its container's status.

The same words appear in three places:

- **the selection's card**, on the object's step of its chain ([Viewer](viewer.md#the-selections-card)). For example
  the tag "no truth" on a jet, and behind it (click it): "no jet associator in CMSSW, and no generator-jet level in
  the truth graph (gap 21)". It adds at most one constituent's own match ([below](#constituents)). Every other step
  of the chain carries its own kind's status in the same way;
- **the truth colour key**: "faint: no truth for that kind", with the kinds and the reason behind its **i**;
- **the Truth tab**, which opens with the event's scorecard of the matched kinds (clean, impure, no match), and a
  "Truth coverage" list of every drawn kind.

In the truth mode, a kind with status none is drawn neutral and faint (cones as outlines), never in a particle's
colour. An object of a matched kind without a clean match stays small and grey.

Such a kind never opens the truth ↔ reco pair. Neither does a matched kind outside the candidates' chain: the pair
belongs to HGCal, and an ECAL cluster's card gives its own purity and completeness.

Simulated energy is never added across detectors. The pair counts only the candidates' detector. The inspector gives
one list per detector, and only for kinds with a match or with Ember's stand-in. For any other kind, a ranking of the
particles in its hits would be a match through hits, so the facts stay on the hits.

Bundles made before these hints still look as before: a truth association into a layer drawn as cells is read as a
fact in that layer's part of the detector, and the layer-cluster stand-in applies where it did.

### Constituents

A composite object (jet, muon, PF candidate, electron) may show the **own** association of one constituent, named
as the constituent's. For example: "its track #212 is matched to μ⁻ #301", with, behind its **i**, "the associator's
answer for that track, not for this muon".

This happens only where a made-of relation gives exactly one part. It does not happen through an association, a
pointer back up, or a "closest track" link. The card never adds up over several parts: "80% of its tracks are from
the b" would be a match built in Ember. Instead, the card's chain counts each part's own match on the parts' step
("9 of 9 matched"), and leaves the composite's step at "no truth".

A constituent's match never gives the composite its colour. In the truth colours, an object takes a colour only
through its own association, or from the container it is part of, never from its parts. With a jet in focus, its
tracks show in their own particles' colours: each colour is that track's own statement.

## Pitfalls

- **Pile-up**: in time only. The profile drops out-of-time particles. Their energy shows as "no truth", never as a
  fake. Pile-up particles are truth like any other, but in the truth mode they are drawn small in their own grey and
  never take a colour, so that the signal stands out at 200 pile-up.
- **No truth** (small, faint grey) is noise, out-of-time pile-up, or a particle that the export left out. The export
  cannot yet tell which ([Truth graph](truth-graph.md), gap 3).
- **Simulated energy** is the energy deposited in the sensors (sampling). A 67 GeV pion leaves about 0.2 GeV. Use it
  only for shares within one detector.
- **Track association weights are hit counts**, stored under `sharedEnergy` / `sharedFraction`. The viewer calls them
  "shared hits".
- **Nested branches**: an ancestor shares at least as much as its descendants. Never sum over a particle and its
  descendants. The pair view counts each hit once.
- **Units per detector**: simulated energy is what each detector's sensors recorded (HGCal and HCAL sampling, ECAL
  crystals, HF photoelectrons). Ember never adds it across detectors.
- **Muon hit truth** is per unit that the simulation records (DT wire, CSC layer, RPC roll, GEM partition), not per
  strip. Two particles in one CSC layer both own each of its hits.
- **Scope**: HGCal completeness counts HGCal only. A barrel particle's few MeV in HGCal are not an inefficiency. The
  key shows the amount, so you can see this.

## Words

| word | meaning (the tooltips use these) |
|---|---|
| truth particle | a particle of the truth graph (simulation) |
| generator particle | the particle level: stable at generator level, what left the collision. It colours everything below it. |
| target | what a reco kind reconstructs, in the terms of the truth graph |
| branch | a particle with everything below it. This is what the associator matches. |
| best match | the associator's choice of branch for a reco object (AdaptiveNominal) |
| purity | the share of the reco object's hits or energy that comes from its match |
| completeness | the share of the match's hits or energy (in that detector) that is in the reco object |
| score | the associator's ranking value, 0 is best; not a fraction |
| clean match | purity at or above the kind's threshold |
| shared / contamination / split off / missed | the pair view's regions ([above](#measures)) |
| merges | a match above the particle level: the object holds several generator particles |
| pile-up | particles from other collisions of the same bunch crossing |
| no truth | energy that no exported particle left: noise, out-of-time pile-up, or not exported |
| no truth for this kind | the truth graph has no answer for the kind (no associator in CMSSW, or none exported). Drawn faint, with the reason in the Truth tab. |
| fact | a truth → hit relation of simulated energy per particle and cell, in one detector |

## Samples

The ttbar samples (without pile-up and at 200 pile-up, 50 events each) contain every difficult case. Per event
without pile-up: 49 photon conversions and 57 nuclear interactions in the tracker; 3.4% of CE-E truth hits have
several owners (13% at 200 pile-up). But they have few clean, isolated objects: 0.5 isolated HGCal objects and 0.6
signal muons per event. The Signal level is empty without a selection preset.

To check definitions one particle at a time, a small particle-gun sample without pile-up would help. Make it with
the script that made the ttbar samples (`samples/run_ttbar.sh`, not in this repository), changing only the step1
fragment: for example `Gun3PhotonElectronPion_cfi` for HGCal, a barrel version of it, or `SingleMuFlatPt2To100_cfi`
for muons. It has not been made yet: the ttbar samples were enough for this design.
