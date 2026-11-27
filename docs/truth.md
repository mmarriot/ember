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
2. **Two kinds of statement, always labelled:**
   - *simulation*: a fact. For example, "this hit has 60% of its simulated energy from this particle";
   - *association*: the CMSSW associator's answer. It is called the "best match", with its score; never "is".

   Ember derives no truth of its own. Where CMSSW has no associator for a kind (layer clusters, TICL candidates, PF
   candidates, jets, ...), the display says so, with the gap's number: what the truth is missing is shown as plainly
   as what it has.
3. **Colour means one thing at a time.** The colour key's title says which: `Colour = candidate type (reco)`,
   `Colour = each layer's own`, `Colour = generator particle (truth)` or `Colour = truth ↔ reco pair`. Truth is drawn dashed, reco solid.
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

- **The particle** colours everything in the truth colours. It is the profile's `particle` level on the truth layer. In
  `hgcal` (and so in `cms`) it is truth::LevelFlag bit 2, StableDecayProducts: the **generator particle**, stable at
  generator level (`hasGen && status == 1`). This is what came out of the collision, before the detector. Every truth
  particle below it belongs to it and takes its colour, in every subdetector: Geant4 secondaries, conversion
  electrons, the daughters of an interaction or of a decay in flight. For example, the track of a conversion
  electron and the showers of that photon share the photon's colour. The Truth tab's tree (and the crumb under a
  truth particle's name in its card) shows how they are related.
- **The target** is what one reco kind reconstructs. Its association declares it in `match.target`:
  - tracks: the particle whose own tracker hits they collected (`trackerHits`);
  - calorimeter objects: the particle that entered the calorimeter (`caloBoundary`);
  - physics objects: the generator particle (`particle`).

  Purity and completeness are measured against the associator's match, at the level that the associator picked.

A match **below** the particle (a shower secondary, a conversion electron) is part of it. The inspector says "the
match is part of the generator particle X". A match **above** the particle means that the object merges several
generator particles: for example a π⁰ or an ω that the generator decayed.

The particle level is for the colours only. A selection is never widened to it: the pair view
([below](#the-pair-view)) stands for the branch of the particle selected (or matched), exactly.

**Why the generator level.** Compared on ttbar without pile-up (5 events):

| colour level | groups owning HGCal hits | of them, resonances or heavy hadrons | reco matches above the level |
|---|---|---|---|
| highest ancestor that owns hits or is matched (the previous rule) | 797 | 5 (K*⁰, B, …): colours given to resonances | 0 |
| **StableDecayProducts** (bit 2, generator particle) | **579** | **0** | 12 of 617 |
| ReconstructableFinalState (bit 10) | 503 | 0, but every π⁰ is one group | 8 of 617 |

Bit 10 differs from bit 2 almost only by the π⁰: in 10 events, 1945 photons become 1064 π⁰, and the neutrinos are
dropped. Bit 10 is the graph's own "reconstructable" level, and it matches TICL's π⁰ candidate type. But it calls a
trackster that cleanly resolves one photon of a low-energy π⁰ a split. Bit 2 matches CMS's legacy targets
(CaloParticle, PF photons, GenJet constituents), and shows a merged π⁰ as merging two particles. The choice is one
setting in the profile (`"particle": {"bit": 2}`). Bit 2 is the default until the owners decide otherwise.

### Which particles get a colour

The truth colours have seven colours of their own (one per particle, never repeated); every other signal particle is
grey, and pile-up is a smaller warm grey. Which seven depends on what is looked at, and the colour key's line under its
title always says which rule is in force (`model/colour/identities.ts` `identities`):

| looking at | the seven slots go to | key says |
|---|---|---|
| a selection with no pair of its own (a jet, an electron, a PF or TICL candidate) | first the particles its parts are matched to (by their pT), then those that left simulated energy in its hits (by energy, detector by detector). The key lists only these: the rest of the view is faded | "the selection's particles: …" |
| a calorimeter's view (HGCal, Calo: simulated energy in hits drawn as cells) | the particles with the most simulated energy in that view's hits, summed per particle of the level within **one** detector. A view with several (Calo: ECAL, HCAL, HF, HO) ranks the particles in each detector on its own and gives the slots to each detector's next particle in turn (ECAL's first, HCAL's first, …): energies of different detectors are never compared or added (their sampling fractions differ, and HF counts photoelectrons). Particles with none there take no slot | "top 7 by simulated energy in HGCal"; "… within each of ECAL, HCAL, HF, HO, in turn" |
| any other view of a detector (the tracker; a muon system, whose chamber deposits are no measure of a particle's size) | the particles its reco objects (tracks) are matched to, by pT; without such matches, the Physics rule | "top 7 by pT among the particles matched to Tracker objects" |
| Physics, or everything | the signal particles by pT, those with \|η\| < 5 first | "top 7 signal particles by pT" |

Only signal particles take a slot (never pile-up). Particles of the level come before those above it (a π⁰ that an
object is matched to as a whole). Ranking by energy, as Ember did before, gave six of the seven slots to beam remnants
at \|η\| ≈ 5 with pT 1–2 GeV in 8 of 10 ttbar events: they reach only HF, where nothing is compared. The simulated
energy per particle is summed once per event, view and level (one pass over the hit-index relations), and the slot
order is kept; a new selection only puts its particles first, and recolours the view only when the seven change.

**The level picker.** The key's "Group by" chooses the level that is one colour: generator particle (bit 2,
StableDecayProducts), entered the calorimeter (bit 3, CaloBoundary), reconstructable (bit 10,
ReconstructableFinalState), parton jet (bit 7, PartonJets), b / c hadron (bits 8 and 9) or τ visible (bits 11 and 12).
For the last three only the level's particles take colours: the rest stays grey and small. Each option gives the
number of signal particles in that level in the event (its flags in its tooltip); a level with none in the event can
not be chosen. The profile's level is the default. The level changes the colours only: the lineage, the pair and the
cards keep the profile's. The link keeps it (`g=`).

**Classes.** The picker's second group colours by class, one colour each, every class drawn alike (pile-up at full
size too): collision (signal collision, pile-up), signal process / underlying event (bits 4 and 5, bit 6) and τ decay
(bit 11, bit 12). A particle takes the class of its nearest ancestor (or itself) with one of the classes' bits, else
"rest of the signal collision" (grey); pile-up is its own class whatever its bits (bit 6 is set on pile-up too). Hits
and matched reco objects follow their particle as in every truth colouring, and a selection changes no colour. The key
lists the classes of the particles that left hits or are matched, and hits without simulated energy as "no in-time
truth" (noise, out-of-time pile-up), drawn small. Bits 4–6 are set only in samples made with a truth preset at DIGI
(`applyTruthPreset`); bits 11–12 in every sample.

**Before a selection.** In the truth colours the signal particles of the level with pT ≥ 1 GeV are drawn as dashed
lines (the truth layer is otherwise drawn only for a selection). Pile-up stays off.

## Measures

For a reco object R and its matched truth branch B (a particle and everything below it), in R's detector:

| | definition | tracks (`measure: "hits"`) | calorimeter objects (`measure: "energy"`) |
|---|---|---|---|
| **purity** | the share of R that comes from B | shared hits / track hits (nPixel + nOT, or nhits); equals 1 − score (for all but 1 of 7744 tracks at 200 pile-up) | shared energy / raw energy, both on the rechit scale (measured ≤ 1) |
| **completeness** | the share of B that is in R | 1 − TruthToReco score = shared cells / all tracker cells of B's branch (its secondaries' cells included, so it dilutes) | TruthToReco `sharedEnergyFraction`: of B's energy in R's detector only, on the rechit scale: each cell's rechit energy split between the branches by the simulated energy they left in it (cells with simulated energy but no rechit count 0; `BranchHitAssociator.cc`) |
| **score** | the associator's ranking, 0 is best | linear (1 − purity) | squared and energy weighted: not 1 − purity |
| **clean** | purity ≥ `good` | 0.75 (CMS tracking validation: MultiTrackValidator) | 0.5 (the dominant particle) |

These numbers appear in three places: the inspector's truth card (per object), the truth mode (the clean test decides
the colour), and the pair view (its own bars, from the hits: below).

**Which energy.** Every number says which of these it counts:

| energy | what it is | where |
|---|---|---|
| simulated | what the particles deposited in the sensors (Geant4), not calibrated: a 67 GeV pion leaves about 0.2 GeV in HGCal. A share within one detector only. | facts on hits; the pair's first bar |
| rechit (reconstructed) | the reconstructed energy of hits; for a cluster or trackster its raw energy (the rechits', each by its fraction); a particle's rechit energy is each cell's, split by the simulated energy shares in it | purity; completeness; the pair's second bar |
| generator | the particle's energy at generation | a truth particle's name ("e⁻ · 71.2 GeV") |

### The pair view

With a truth particle, a matched reco object or a hit selected, the view shows one **pair**
(`viewer/src/model/truth/pair.ts`):

- **The truth side is one branch, exactly**: the particle selected; for a reco object, its best match (the
  associator's, at the kind's target); for a hit, the particle that left the most simulated energy in it; for a part
  drawn with its container (a track's hits), the container's best match. The branch is
  that particle and everything below it: never its siblings, its parent's other descendants, or the generator particle
  above it. The crumb under its name in the card goes up: select a parent there (or in the Truth tab) for a larger branch (a W,
  a B hadron, a top).
- **The hits are the simulation's.** The file gives hits to the particles that entered the calorimeter (truth level
  CaloBoundary), each with its whole shower inside the calorimeter. So the branch's hits are those of its particles
  that entered the calorimeter, each hit counted once:
  - *its own shower*, when the selected particle entered the calorimeter itself;
  - *its descendants'*, from particles made before the calorimeter: conversion electrons, the products of an
    interaction or of a decay in the tracker. A π⁺ that interacted in the tracker has none of its own;
  - when the selected particle is itself inside a shower (a brem photon, a shower secondary), the file has no hits of
    its own for it: the pair shows the hits and energies of the shower it is in, says so, and the key says "the
    shower's". Its matches are still its own first (the associator does match such particles, e.g. a brem photon to
    its own ECAL cluster);
  - a particle with no hits in the file at all (it never entered the calorimeter, and none of its descendants did)
    still shows its matches, with no bars.

  Separating a brem photon's deposits from its electron's needs a direct-hits table from CMSSW
  ([Truth graph](truth-graph.md), gap 2).
- **The reco side is per detector**: in each detector the branch left hits in, the kind the associator matches there
  (HGCal: the last trackster stage with a match, the candidates' tracksters; ECAL and HCAL: PF clusters; the
  tracker: tracks), and its **matches**: the object that the TruthToReco association rates best for the selected
  particle, and those it rates best for the branch's particles that entered the calorimeter. A selected object that is
  not one of them (a fragment) shows as split off. A vertex, which only points at its tracks, opens no pair.
- **A detector without an association is shown, not compared** (HF and HO hits: no PF-cluster associator, gap 15).
  Kinds made of matched objects (PF candidates, jets, TICL candidates, muons) have no association of their own and are
  not part of the pair; their parts are.

Each object is coloured by where it ended up:

| class (as the key says it) | meaning |
|---|---|
| found | the branch's, in its match (a hit: the branch left the most simulated energy in it) |
| not from it | in its match, from other particles or none (contamination) |
| in another object | the branch's, in another object of the kind compared, and that object (split off) |
| in no object | the branch's, in no object of the kind compared (missed) |
| part of its match | part of a matched object with no truth of its own (a trackster's layer clusters, a track's hits) |
| rest of its branch | the branch's other particles that entered the calorimeter on their own |
| not compared | the branch's hits in a detector whose reco has no association |

The card gives, per detector, two bars that name their energy:

- **the branch's simulated energy** there: in its match, in other objects of the kind, in none; and how much is its
  own shower and how much its descendants';
- **the match's rechit energy**: from the branch, from other particles, or with no simulated energy at all (noise,
  out-of-time pile-up, or a particle the export left out). Each hit's rechit energy is split by the simulated energy
  each particle left in it.

These are not the associator's purity and completeness of one object: those are on its truth card.

## Each kind's contract

Every reco → truth association in a profile carries a `match` hint ([Profiles](profiles.md#relations)). Its
truth → reco partner carries the completeness. From these, the viewer derives the same things for every kind: the
truth card, the clean test in the truth mode, the units and the wording.

| kind | target | measure, where | purity over | clean | completeness | status |
|---|---|---|---|---|---|---|
| tracks (generalTracks) | trackerHits | hits, tracker | nPixelHits + nOTHits | 0.75 | 1 − score (branch hits) | match |
| tracksters, linked tracksters, superclusters, the candidates' tracksters (interpretations in TICL v6) | caloBoundary | energy, HGCal | raw energy | 0.5 | sharedEnergyFraction | match, for each trackster collection whose maps the input has (the TICL v6 bundle has none for CLUEstering tracksters and interpretations) |
| TICL candidates | — | — | — | — | — | none: the truth graph has no TICL-candidate associator. The trackster each candidate is built on (one per candidate: its candidate trackster) has its own match, and a charged candidate's track has its own; the card names them as theirs ([Constituents](#constituents)) |
| ECAL / HCAL (HB) PF clusters | caloBoundary | energy, ECAL or HCAL | raw `energy` (never HCAL `correctedEnergy`: it is unset or negative) | 0.5 | sharedFraction (of the branch's ECAL or HCAL energy) | match |
| primary / secondary vertices | the collision their tracks come from / their immediate production vertex, aiming at b and c hadron decays (a truth **vertex**) | pT² of tracks (tracks with score ≤ 0.25 vote) | the weight is the purity (`match.purity`) | 0.5 | TruthToReco fraction (of the truth vertex's findable tracks' pT²) | match; drawn neutral in the truth colours (a vertex has no particle colour); the card names the collision (signal or pile-up) or the vertex, and its distance |
| HGCal hits | — (simulation fact) | simulated energy per particle, HGCal | — | — | — | fact |
| ECAL barrel, HCAL HB / HO, HF hits | — (simulation fact) | simulated energy per particle, ECAL / HCAL / HF (HF: photoelectrons) | — | — | — | fact |
| muon hits (DT, CSC, RPC, GEM) | — (simulation fact), per unit that the simulation records: DT wire, CSC layer, RPC roll, GEM partition (`fact.unit`) | simulated energy loss per particle, muon system | — | — | — | fact in Ember's earlier export (`muon` profile); none in `ember`'s own NanoAOD (`muonsystem`, gap 16): it does not write the muon hit table yet, although the table producer can |
| MTD hits | — (simulation fact) with sim time | — | — | — | — | none: the hit index fills an MTD channel, but the hit table producer reads only the calorimeter and muon channels, and only particles that entered the calorimeter (60% of the MTD cells at 200 pile-up; gap 19) |
| HGCal layer clusters | caloBoundary | energy, HGCal | — | — | — | none: the truth graph has no layer-cluster associator (gap 1). Their hits carry the facts. |
| HF, HO PF clusters | caloBoundary | energy, HCAL | raw energy | 0.5 | — | none: the truth graph's associator is not configured for them (gap 15) |
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
`viewer/src/model/truth/match.ts`), in this order:

1. **match**: the kind has its own reco → truth relation with a `match` hint;
2. **fact**: hits with a `fact` relation;
3. **none**: the kind's `truthGap`, or else "no truth association exported for this kind";
4. for a part drawn with what contains it (the hits of a track): its container's status.

The same words appear in three places, each saying which of three things it is: "no CMSSW associator" (the kind has
no answer), "not matched" (an object of a matched kind the associator matched to nothing), or "no simulated energy"
(a hit no exported particle left energy in). A gap number is never in the main text: it is behind an **i**, as a link
to the [gap table](truth-graph.md#gap-table).

- **the selection's card**, in its truth block at the top ([Viewer](viewer.md#the-selections-card)). For a kind
  without an association, one line: the match of its parts that are each the only one of their collection in their
  step, when no other part is matched and they name one particle ("via its track · e⁻ …", with its purity and
  completeness), else "No match of its own"; behind its **i**: "the truth graph has no jet associator, and no
  generator-jet level", with the gap as a link. Under the card's **More**, "Its parts' truth" gives each step of its
  parts with its own truth a tag (match, sim) and names the kinds without an associator ([below](#constituents));
- **the truth colour key**: "faint: no CMSSW associator for that kind", once, with the kinds behind its **i** (the
  side panel's rows of those kinds carry no line of their own); its
  switch reads "Colour by: reco type | truth particle", and its grey reads "no simulated energy, or not cleanly
  matched";
- **the Truth tab**, whose folded Details hold the event's scorecard of the matched kinds (clean, impure, not
  matched), and the **Metadata tab**, whose "Truth coverage" lists every drawn kind ("no CMSSW associator" with its
  reason, the gap behind its **i**). The side panel's heading of such a kind reads "no associator".

In the truth mode, a kind with status none is drawn neutral and faint (cones as outlines; markers made of calorimeter
cells, such as layer clusters and superclusters, as small dots under the hits, also in the pair view, so the hits'
colours show), never in a particle's colour. An object of a matched kind without a clean match stays small and grey.

Such a kind never opens the truth ↔ reco pair; its parts may.

Simulated energy is never added across detectors. The pair has one block per detector. The inspector gives one list
per detector, and only for kinds with a match. For any other kind, a ranking of the particles in its hits would be a
match through hits, so the facts stay on the hits.

Bundles made before these hints read as before where they can: a truth association into a layer drawn as cells is a
fact in that layer's part of the detector. Bundles whose layer clusters still carry Ember's former stand-in
(`truthGap.derived`) show them as a gap, without the stand-in.

### Constituents

A composite object (jet, muon, PF candidate, electron) shows the **own** associations of its parts in its card's truth
block, each named as the part's. Its line names one only when its matched parts are each the only one of their
collection in their step and all name one particle: "via its track · μ⁺ · pT 95.3 · η 1.11 from W⁺ decay", with the track's purity and completeness: the track's
answer, which its **i** says is not a verdict for the muon. Under the card's **More**, "Its parts' truth", every step
with its own truth: a step of one part names its particle and the match's purity ("match μ⁺ · pT 95.3 · η 1.11 ·
purity 100%"), a step of several counts them ("3 clean"). The parts are the steps of what it is made of, and the
objects built only from its parts (an electron's PF cluster inside its supercluster).
`X` goes to the particle the line names, else offers the parts' particles in a chooser, larger parts first among
those whose matches count the same thing. Naming one part's match when the parts disagree, or ranking particles by
size across a track's pT and a cluster's energy, would be a verdict built in Ember.

It never happens through an association, a pointer back up, or a "closest track" link. The card never adds up over
several parts and never gives the composite a verdict: "80% of its tracks are from the b" would be a match built in
Ember, and a pion's track inside a photon's cluster is the story, not a contradiction to resolve.

The pair of a part may stand in for the composite's in the view (owner decision D4, a trial). A TICL candidate's
single parts that are matched (its candidate trackster, linked trackster, track) must all point to one particle; the
view then shows the pair of the first of them that is an earlier reconstruction step (the candidate trackster; in a
TICL v6 bundle, the linked trackster), and the card says it is that part's. Parts that disagree give no pair.

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

## Physics from the graph

The particle card states what the truth graph itself says of a particle, read from its particles and vertices alone
(`viewer/src/model/truth/graph.ts`, unit-tested in `graph.test.ts`). These are summaries of the simulation, never
associations: nothing is matched by ΔR or by hits.

| line | for | how it is computed |
|---|---|---|
| made at | every particle | the production vertex of its first generator copy: R = √(x² + y²), z, and the vertex named as below |
| last vertex with daughters | every particle | its last copy's `decayVertexIdx`. In the file this is only the latest in time of the vertices where its kept daughters were made, not necessarily where it stopped; its children are those of all those vertices. So what a particle did is read from each child's own production vertex, as in the lines below |
| "decays where it was made (0 cm)", "decays 3 mm from where it was made", "last vertex 26.3 cm from where it was made" | every particle with both vertices | the straight-line distance from the "made at" vertex to the last vertex with daughters (`vertexDistance`): not where the particle stopped, and not the length of its helix. "decays" when that vertex's reason is decay, else "last vertex". 0 for the partons of the hard process, which the generator makes and ends at the collision |
| vertex name, "B⁰ decay · 3 charged" | every truth vertex | the parent of the first particle made there, the vertex's `reason` (truth::VertexReason), and the number of particles made there with a non-zero charge **that the graph keeps** (not every particle Geant4 made) |
| copies, "×4 (status 23→1)" | generator particles | a particle's copy is its only child of the same pdgId, a generator particle (status > 0) with that one parent (a τ written again beside a photon it radiated is still one τ; a Geant4 electron's delta ray is not its copy) |
| brem in the tracker: n photons, ΣE, radius range | e⁻, e⁺ | the photons among its last copy's children made at a vertex of reason bremsstrahlung (a generator copy's radiated photons are not brem) before it left the tracker volume (the vertex's time `t` before its checkpoint's `boundaryT`, at the simulation's tracker–calorimeter boundary: R 123 cm in the barrel, \|z\| 293.5 cm in the endcaps, in front of the ETL and HGCal; a photon made later is radiated in front of or in the calorimeter), their summed energy, and the smallest and largest R of those vertices. Only the photons the graph keeps count: those that reached the calorimeter, or that something is matched to, or that made such particles; very soft ones may be missing |
| left the tracker (R, z) with E | e⁻, e⁺ | its last copy's energy and place at its tracker–calorimeter boundary checkpoint (`boundaryE`, `boundaryX/Y/Z`). E at production = ΣE + this, but for ionisation (within 0.21 GeV for the egamma sample's prompt electrons with \|η\| < 3). None without a checkpoint. Not the reco fbrem, (p_in − p_out) / p_in of the GSF track, which stops at the track's last hit: an e⁻ of 32.6 GeV that radiated 16.0 GeV up to R 57 cm and 16.1 GeV more near the boundary (R 115–119 cm) leaves the tracker with 0.46 GeV, while its track's fbrem is 0.44 |
| converted at R, z → e⁻ e⁺ | γ | the vertex of reason conversion among those where its last copy's daughters were made, and the e± made at that vertex (a Compton electron made earlier is not one); else "did not convert", and "in the tracker" when it left the tracker |
| did not convert in the tracker: first pair at R, z | γ | that conversion vertex when it is at or after the time of its boundary checkpoint: its first pair beyond the tracker–calorimeter boundary (e.g. at R 129 cm in the barrel ECAL, or at \|z\| 296–315 cm in front of HGCal), not a conversion tracking could find. A pair made inside the boundary but beyond the outermost tracker layer (R 111 cm) still reads "converted": telling those apart needs the tracker's geometry |
| from π⁰, with γ | γ | its parent, if a π⁰, and that π⁰'s other photons |
| τ decays → …, visible E | τ | the children of its last copy, and the sum of their energies without the neutrinos (νe, νμ, ντ) |
| flight, transverse | b and c hadrons (bits 8, 9) | the distance from its production vertex to its decay vertex (where its last copy's daughters were made by a decay), in 3D and in x–y |
| decay vertex matched by SV k (completeness x%) | b and c hadrons | the truth → reco vertex association whose reverse matches decay vertices (`match.target` "decayVertex": `truthSecondaryVertices`), from its decay vertex and from the decay vertices of the b and c hadrons below it (a B → D cascade), with the association's `match.completeness` weight (the share of the truth vertex's tracks' pT² the reco vertex holds), best first, three shown. Never the associator's score. A bundle without that association says "no vertex associator for decay vertices" |

## Collisions and places

The generator writes each collision as many vertices: the hard scatter, the shower branchings and hadronizations of
its partons (reasons 17, 18, 19), or a pile-up collision's (reasons 0, 1; some of the signal's are 0 too). They are
steps of its calculation, not places: a parton shower's branchings are ordered by an evolution variable, not by time or
distance, and the whole collision happens within about a femtometre. The vertex smearing then moves each collision,
as a whole, to its own random point and time in the luminous region (`IOMC/EventVertexGenerators`). Short-lived
particles (ρ, ω, η, π⁰, K*) decay where they were made, at the collision's point or at a b or c hadron's decay. So a
collision's generator steps are one point: in the site's tt̄ bundles, all of them are, in every event. Only a decay
with a measurable lifetime, or Geant4's interaction in matter, is a vertex somewhere else.

Reco cannot tell vertices at one position apart. The viewer counts the vertices of one collision (the collision of the
first particle made at each) within 1 µm of each other as one **place** (`viewer/src/model/truth/places.ts`
`vertexPlaces`): a collision's point (a place with one of the generator's steps), or a b hadron's decay with the ω it
made there. A place's reco is that of all its vertices (`recoOfTruth`'s `rows`): a secondary vertex best matched to the
ω is not "merged" on the B decay's card. The lowest-numbered vertex of a collision's point stands for the collision,
as in CMSSW's associator (`truth::interactions`: the interaction's lowest-numbered usable production vertex, when no
truth preset made an interaction vertex): it is the one the primary vertices' associations name (in both tt̄ bundles,
every one). Selecting any of the generator's steps there shows the collision ([Viewer](viewer.md#a-truth-vertex)).

The primary vertices' association aims at collisions; the secondary vertices' at the vertex where a reco vertex's
tracks' particles were made, whatever it is: a b or c hadron's decay (its efficiency counts only those), but also a
resonance's decay, a conversion, or a collision's point for one built from prompt tracks (in the 0 pile-up tt̄
bundle, 32 of the 81 truth vertices it names are at a collision's point).

## One look for truth

Truth and reco are told apart by one visual grammar, everywhere:

| means | looks | used for |
|---|---|---|
| simulation (the truth graph, the hit index) | violet, dashed lines, hollow rings; the selection's truth lines between edges of the background's colour, the Truth tab's picks' vertices in one neutral grey | truth particles and vertices, the TRUTH badge, truth labels in the view |
| a CMSSW associator's answer | a small solid `match` tag, the associator named | the chain's and the card's match lines |
| simulated energy on hits | a small solid `sim` tag | the chain's hit steps, the side panel's kind headings |
| reco | solid lines, filled markers, type colours | all reco |
| no information | plain grey text, no badge | "no truth" |

A truth particle has one name everywhere, by its pT and η (`μ⁺ · pT 96.6 · η 1.11`): its card, every chip naming it,
its label in the view, the colour key, the choices of `X` and the Truth tab's tree. A beam particle (pT 0) is named by
its energy. The same particle never reads as two (`E 72.6 GeV` in one place and `pT 39.4` in another).

Violet is the truth's only: no category colour of the palettes is violet, and the profiles give RPC hits and taus,
violet before, other colours. Bundles converted before that are drawn in the new colours by a shim
(`render/colour.ts` `RETIRED`).

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
| found / not from it / in another object / in no object / not compared | the pair view's classes ([above](#the-pair-view)) |
| merges | a match above the particle level: the object holds several generator particles |
| pile-up | particles from other collisions of the same bunch crossing |
| no simulated energy | a hit in which no exported particle left energy: noise, out-of-time pile-up, or not exported |
| not matched | an object of a matched kind that the associator matched to nothing (a fake, or not considered) |
| no CMSSW associator | the truth graph has no answer for the kind (no associator for it in the truth graph, or none exported). Drawn faint, with the reason behind an **i**. Ember builds none in its place. |
| simulated energy | energy deposited in the sensors (Geant4), not calibrated; a share within one detector only |
| rechit energy | the reconstructed energy of hits (of a cluster or trackster: its raw energy) |
| fact (tag "sim") | a truth → hit relation of simulated energy per particle and cell, in one detector |

## Samples

The ttbar samples (without pile-up and at 200 pile-up, 50 events each) contain every difficult case. Per event
without pile-up: 49 photon conversions and 57 nuclear interactions in the tracker; 3.4% of CE-E truth hits have
several owners (13% at 200 pile-up). But they have few clean, isolated objects: 0.5 isolated HGCal objects and 0.6
signal muons per event. The Signal level is empty without a selection preset.

To check definitions one particle at a time, a small particle-gun sample without pile-up would help. Make it with
the script that made the ttbar samples (`samples/run_ttbar.sh`, not in this repository), changing only the step1
fragment: for example `Gun3PhotonElectronPion_cfi` for HGCal, a barrel version of it, or `SingleMuFlatPt2To100_cfi`
for muons. It has not been made yet: the ttbar samples were enough for this design.
