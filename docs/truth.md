# Truth in evd: what a reco object is compared with, and how it is shown

The rules every part of the display follows when it puts simulation truth next to reconstruction, so that HGCal, the
tracker and every subdetector added later say the same thing in the same words. [truth-graph.md](truth-graph.md) says
where the truth comes from and what is missing in CMSSW; this page says what the display does with it. Adding a new
kind of reco object means filling one row of the table in "Each kind's contract" and one `match` hint in its profile,
not repeating the study.

## Principles

1. **One source.** Truth is the CMSSW truth graph: particles and vertices with their level flags, the hit index
   (simulated energy per particle and detector cell) and the branch associators. Never CaloParticle, SimCluster,
   TrackingParticle, genParticles or GenJets.
2. **Three kinds of statement, always labelled.** *Simulation* (a fact: this hit has 60% of its simulated energy from
   this particle), *association* (the CMSSW associator's answer: "best match", with its score; never "is"), and
   *derived in evd* (a stand-in where CMSSW has no answer, e.g. a layer cluster's particle).
3. **Colour means one thing at a time**, and the colour key's title says which: `Colour = candidate type (reco)`,
   `Colour = generator particle (truth)` or `Colour = truth ↔ reco pair`. Truth is drawn dashed, reco solid.
4. **A reco object is never painted as truth.** It takes a particle's colour only when its match is clean (purity at
   or above its kind's threshold). Otherwise it is grey. Without any truth it is neutral, never the "shared" green.
   A kind with no truth of its own is drawn faint, so it cannot be read as an unmatched (fake) object of a matched kind.
5. **Numbers are linear and say what they divide by**: purity and completeness as percentages with the counted
   quantity and detector named ("21 of its 21 hits", "of the particle's energy in HGCal"). The associator's score is a
   ranking (0 best), shown as such, never as a fraction.

## Two levels: the particle, and each kind's target

One truth level cannot serve every detector. Measured on ttbar 0PU (10 events, generator-stable particles with
pT > 1 GeV, |η| < 3): 21% of charged hadrons interact in the tracker, 54% of photons convert before the calorimeter,
42% of neutral hadrons decay in flight. The particles that enter the calorimeter (truth level CaloBoundary) carry
99.8–100% of the calorimeter's simulated energy, but only 57–62% of the tracker hits. So:

- **The particle** colours and groups everything. It is the profile's `particle` level on the truth layer: in `hgcal`
  (and so `cms`) truth::LevelFlag bit 2, StableDecayProducts, the **generator particle**: stable at generator level
  (`hasGen && status == 1`), what came out of the collision before the detector. Every truth particle below it
  (Geant4 secondaries, conversion electrons, the daughters of an interaction or of a decay in flight) belongs to it
  and takes its colour, in every subdetector. A track of a conversion electron and the showers of that photon share
  the photon's colour; the lineage in the inspector shows how they are related.
- **The target** is what one reco kind reconstructs, declared by its association's `match.target`: tracks the
  particle whose own tracker hits they collected (`trackerHits`), calorimeter objects the particle that entered the
  calorimeter (`caloBoundary`), physics objects the generator particle (`particle`). Purity and completeness are
  measured against the associator's match, at the level it picked.

A match **below** the particle (a shower secondary, a conversion electron) is part of it: the inspector says "the match
is part of the generator particle X". A match **above** it (an ancestor of several generator particles, e.g. a π⁰ or
an ω decayed by the generator) means the object merges them: the pair view then stands for all the generator particles
below it and the key says so.

**Why the generator level.** Compared on ttbar 0PU (5 events; `runs/truth/measure/levels.py` in the hackathon area):

| colour level | groups owning HGCal hits | of them, resonances or heavy hadrons | reco matches above the level |
|---|---|---|---|
| highest ancestor that owns hits or is matched (evd before) | 797 | 5 (K*⁰, B, …): colours given to resonances | 0 |
| **StableDecayProducts** (bit 2, generator particle) | **579** | **0** | 12 of 617 |
| ReconstructableFinalState (bit 10) | 503 | 0, but every π⁰ is one group | 8 of 617 |

Bit 10 differs from bit 2 almost only by the π⁰ (in 10 events: 1945 photons become 1064 π⁰; neutrinos dropped).
It is the graph's own "reconstructable" level and matches TICL's π⁰ candidate type, but it calls a trackster that
cleanly resolves one photon of a low-energy π⁰ a split. Bit 2 matches CMS's legacy targets (CaloParticle, PF photons,
GenJet constituents) and shows a merged π⁰ as merging two particles. The choice is one setting in the profile
(`"particle": {"bit": 2}`); this is the default until the owners decide otherwise.

## Measures

For a reco object R and its matched truth branch B (a particle and everything below it), in R's detector:

| | definition | tracks (`measure: "hits"`) | calorimeter objects (`measure: "energy"`) |
|---|---|---|---|
| **purity** | the share of R from B | shared hits / track hits (nPixel + nOT, or nhits); equals 1 − score (all but 1 of 7744 PU200 tracks) | shared energy / raw energy, both on the rechit scale (measured ≤ 1) |
| **completeness** | the share of B in R | 1 − TruthToReco score = shared cells / all tracker cells of B's branch (its secondaries' included, so it dilutes) | TruthToReco `sharedFraction`: of B's energy in HGCal only |
| **score** | the associator's ranking, 0 best | linear (1 − purity) | squared and energy weighted: not 1 − purity |
| **clean** | purity ≥ `good` | 0.75 (CMS tracking validation: MultiTrackValidator) | 0.5 (the dominant particle); layer clusters, whose particle evd derives, the same 0.5 of their simulated energy |

Where these numbers appear: the inspector's truth card (per object), truth mode (the clean test decides the colour) and
the pair view (purity and completeness of the pair, from the hits).

**The pair view's regions.** With something selected, the particle (the whole of its generator particle) and its best
candidate (the candidate the TruthToReco association rates highest for it) are compared hit by hit, each hit counted
for the particle that left the most simulated energy in it:

| class | meaning |
|---|---|
| shared | the particle's, in its candidate |
| contamination | in the candidate, from other particles or none |
| split off | the particle's, in other candidates |
| missed | the particle's, in no candidate |
| in the candidate (neutral) | a candidate with no truth match: nothing confirmed |

The key gives completeness (of the particle's simulated energy in HGCal, deposited in the sensors, not calibrated:
compare it only with itself) and purity (of the candidate's rechit energy).

## Each kind's contract

Every reco -> truth association in a profile carries a `match` hint ([profiles.md](profiles.md)); its truth -> reco
partner carries the completeness. What the viewer derives from it, the same for every kind: the truth card, the clean
test in truth mode, the units and wording.

| kind | target | measure, where | purity over | clean | completeness | status |
|---|---|---|---|---|---|---|
| tracks (generalTracks) | trackerHits | hits, tracker | nPixelHits + nOTHits | 0.75 | 1 − score (branch hits) | match |
| tracksters, linked tracksters, superclusters, interpretations | caloBoundary | energy, HGCal | raw energy | 0.5 | sharedFraction | match |
| TICL candidates | caloBoundary | energy, HGCal | raw energy | 0.5 | sharedFraction | match (calorimeter only: a track-only candidate has no match; the card shows its track's) |
| ECAL / HCAL (HB) PF clusters | caloBoundary | energy, ECAL resp. HCAL | raw `energy` (never HCAL `correctedEnergy`: unset, negative) | 0.5 | sharedFraction (of the branch's ECAL resp. HCAL energy) | match |
| primary / secondary vertices | the collision their tracks come from / their immediate production vertex, aiming at b and c hadron decays (a truth **vertex**) | pT² of tracks (tracks with score ≤ 0.25 vote) | the weight is the purity (`match.purity`) | 0.5 | TruthToReco fraction (of the truth vertex's findable tracks' pT²) | match; drawn neutral by truth (a vertex has no particle colour); the card names the collision (signal or pile-up) or the vertex, and its distance |
| HGCal hits | — (simulation fact) | simulated energy per particle, HGCal | — | — | — | fact |
| ECAL barrel, HCAL HB / HO, HF hits | — (simulation fact) | simulated energy per particle, ECAL / HCAL / HF (HF: photoelectrons) | — | — | — | fact |
| muon hits (DT, CSC, RPC, GEM) | — (simulation fact) per unit the simulation records: DT wire, CSC layer, RPC roll, GEM partition (`fact.unit`) | simulated energy loss per particle, muon system | — | — | — | fact; the hit's line names the unit ("in this CSC layer": every hit there shares these particles) |
| MTD hits | — (simulation fact) with sim time | — | — | — | — | none: not exported (only 60% of PU200 MTD cells are under particles that entered the calorimeter; gap 19) |
| HGCal layer clusters | caloBoundary | energy, HGCal | — | — | — | derived in evd (no associator: gap 1; `truthGap.derived`) |
| HF, HO PF clusters | caloBoundary | energy, HCAL | raw energy | 0.5 | — | none: no associator configured in CMSSW (gap 15) |
| muon segments | particle crossing the chamber | hits, muon system | segment hits | 0.75 | of its hits in the chamber | none: no adapter or associator (gap 17) |
| reco, standalone, global muons | muon with own muon hits (no graph level yet) | hits per stub, tracker and muon | stub hits | 0.75 per stub | 0.5 per stub | none (gap 18); the inner track's own match, named as the track's |
| MTD clusters, track times | particle with own MTD hits | hits, MTD | cluster cells | 0.75 | — | none (gap 19) |
| PF candidates | generator particle (ReconstructableFinalState) | constituents (track + clusters) | — | 0.5 | — | none (gap 20); one constituent's own match, named as its |
| jets | generator jets of visible signal generator particles (no clustering in the graph) | constituents | — | — | — | none (gap 21); never GenJets |
| MET | −ΣpT of visible signal generator particles | vector | — | — | — | none (gap 22); never GenMET |
| electrons, photons | generator e / γ (a conversion: the photon's PairConversion vertex) | constituents (supercluster + GSF track) | — | 0.5 | — | none (gap 23) |
| taus | TauVisibleHadronic | constituents | — | — | — | none (gap 24) |

Status words are the viewer's (`truthStatus`, below): *match* (matched by CMSSW), *fact* (simulation fact), *derived*
(derived in evd), *none* (no truth for this kind, with the reason and gap number from the kind's `truthGap`).

Thresholds follow each domain's reference validation, so evd agrees with DQM.

### Adding a kind

1. Name its **target** in graph terms: one of the levels above, or a new one (say which flag or hit-index test
   selects it, and why the reco algorithm aims at it). Note where it disagrees with the other subdetectors' targets
   (conversions, interactions, decays in flight, brems) and check that the particle level reconciles them.
2. Export its association from the truth graph (AdaptiveNominal reco -> truth, and TruthToReco). If CMSSW has none,
   do not substitute one (no ΔR, no matching through hits in evd): list the gap in truth-graph.md and give the kind a
   `truthGap` (`reason`, `gap`) in its profile; the viewer then says it everywhere ("Where truth stops"). When the
   associator arrives, add the relation with its `match` hint (step 3) and delete the `truthGap`.
3. Add the `match` hint to the reco -> truth relation (`target`, `measure`, `in`, `shared`, `over`, `good`) and the
   completeness to the truth -> reco relation. Take `good` from the domain's validation.
4. If the kind has its own hits, export the hit index for its channel (simulated energy per particle and cell), so
   its hits show their particle as a fact, not through the reco match. Mark the truth -> hit relation
   `"fact": {"in": "<detector>"}`, with the detector names the `match` hints use.
5. Never let the kind take truth through its parts or its constituents ("Constituents" below).
6. Check on a sample: purity ≤ 1 everywhere, and a few objects in the inspector against CMSSW's validation.

## Where truth stops

Every drawn kind has one truth status, worked out from the bundle (`truthStatus`, `viewer/src/model/match.ts`), in
this order: **match** (its own reco -> truth relation with a `match` hint), **fact** (hits with a `fact` relation),
**derived** (`truthGap.derived`: HGCal layer clusters only), **none** (its kind's `truthGap`, else "no truth
association exported for this kind"), or, for a part drawn with what contains it (a track's hits), its container's.
The same words appear in three places:

- the inspector's truth box: "no truth for Jets: no jet associator in CMSSW, and no generator-jet level in the truth
  graph (truth-graph.md gap 21)", plus at most one constituent's own match (below);
- the truth colour key: one line, "faint: no truth for this kind: Jets, MET, … (why: Truth tab)";
- the Truth tab, which opens with a "Truth coverage" list of every drawn kind.

In truth mode a kind with status none is drawn neutral and faint (cones as outlines), never in a particle's colour; an
object of a matched kind without a clean match stays the small grey. Such a kind never opens the truth ↔ reco pair,
and neither does a matched kind outside the candidates' chain (the pair is HGCal's: an ECAL cluster's card gives its
own purity and completeness). Simulated energy is never added across detectors: the pair counts the candidates'
detector only, and the inspector gives one list per detector, only for kinds with a match or evd's stand-in (for any
other, a ranking of the particles in its hits would be a match through hits; the facts stay on the hits).

Bundles made before the hints: a truth association into a layer drawn as cells is a fact in that layer's domain, and
the layer-cluster stand-in applies where it did, so they look as before.

### Constituents

A composite (jet, muon, PF candidate, electron) may show one constituent's **own** association, named as the
constituent's: "Its track #212 is matched to μ⁻ #301 (the associator's answer for that track, not for this muon)".
Only where a made-of relation gives exactly one part (not an association, not a pointer back up, not a "closest
track" link), never aggregated over several parts ("80% of its tracks are from the b" is a match built in evd), and
never as the composite's colour: by truth, an object takes a colour only across its own association, or from the
container it is part of, never from its parts. With a jet in focus, its tracks show in their own particles' colours:
each is the track's statement.

## Pitfalls

- **Pile-up**: in-time only. Out-of-time particles are dropped by the profile; their energy shows as "no truth",
  never as fake. Pile-up particles are truth like any other, but in truth mode they are drawn small in their own grey
  and never take a colour, so the signal shows at PU200.
- **No truth** (small, faint grey) is noise, out-of-time pile-up, or a particle the export left out; the export cannot
  yet tell which (truth-graph.md gap 3).
- **Simulated energy** is energy deposited in the sensors (sampling): a 67 GeV pion leaves about 0.2 GeV. Use it only
  for shares within one detector.
- **Track association weights are hit counts**, stored under `sharedEnergy` / `sharedFraction`; the viewer names them
  "shared hits".
- **Nested branches**: an ancestor shares at least as much as its descendants. Never sum over a particle and its
  descendants; the pair view counts each hit once.
- **Units per detector**: simulated energy is what each detector's sensors recorded (HGCal and HCAL sampling, ECAL
  crystals, HF photoelectrons); evd never adds it across detectors.
- **Muon hit truth** is per unit the simulation records (DT wire, CSC layer, RPC roll, GEM partition), not per strip:
  two particles in one CSC layer both own each of its hits.
- **Scope**: HGCal completeness counts HGCal only. A barrel particle's few MeV in HGCal are not an inefficiency; the
  key shows the amount so this is visible.

## Words

| word | meaning (tooltips use these) |
|---|---|
| truth particle | a particle of the truth graph (simulation) |
| generator particle | the particle level: stable at generator level, what left the collision; colours everything below it |
| target | what a reco kind reconstructs, in truth-graph terms |
| branch | a particle with everything below it; what the associator matches |
| best match | the associator's choice of branch for a reco object (AdaptiveNominal) |
| purity | share of the reco object's hits or energy from its match |
| completeness | share of the match's hits or energy (in that detector) in the reco object |
| score | the associator's ranking value, 0 best; not a fraction |
| clean match | purity at or above the kind's threshold |
| shared / contamination / split off / missed | the pair view's regions (above) |
| merges | a match above the particle level: the object holds several generator particles |
| pile-up | particles from other collisions of the same bunch crossing |
| no truth | energy no exported particle left: noise, out-of-time pile-up or not exported |
| no truth for this kind | the truth graph has no answer for the kind (no associator in CMSSW, or none exported): drawn faint, the reason in the Truth tab |
| fact | a truth -> hit relation of simulated energy per particle and cell, in one detector |

## Samples

The ttbar samples (`hackathon/samples/ttbar_{0PU,PU200}`, 50 events each) contain every difficult case (per 0PU event:
49 photon conversions and 57 nuclear interactions in the tracker; 3.4% of CE-E truth hits with several owners, 13% at
PU200) but few clean, isolated objects (0.5 isolated HGCal objects and 0.6 signal muons per event; the Signal level is
empty without a selection preset). For checking definitions one particle at a time, a small 0PU particle gun would help:
`samples/run_ttbar.sh` with only the step1 fragment changed (e.g. `Gun3PhotonElectronPion_cfi` for HGCal, a barrel
version of it, `SingleMuFlatPt2To100_cfi` for muons). Not made yet: the ttbar samples were enough for this design.
