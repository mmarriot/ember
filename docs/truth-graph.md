# The truth graph in evd: what is used, and what is missing

In evd, "truth" means the CMSSW **truth graph** and nothing else:

- `truth::Graph` and its hit index (`truth::LogicalGraphHitIndex`, PhysicsTools/TruthInfo);
- the reco ↔ truth associations of SimGeneral/TruthGraphAssociatorProducers;

as the `NANO:@EVD` flavour writes them to NanoAOD. The flavour is the package DPGAnalysis/EventDisplayNanoAOD, called
"the exporter" below ([CMSSW side](cmssw.md)). CaloParticle, SimCluster and SimTrackster are not used (the `hgcal`
profile excludes their tables), and should not be.

This page says:

- what the viewer shows from the truth graph;
- what the viewer works out itself where the graph has no answer;
- what is missing, so that each gap can be checked off as CMSSW adds it.

What a reco object is compared with, the measures (purity, completeness) and the colours are in [Truth](truth.md).

## What the viewer shows

| in the viewer | from |
|---|---|
| Truth graph · Particles, Vertices; the Truth tab (parent → children) | `TruthParticles`, `TruthVertices`, `TruthParticleChildren` |
| a reco object's "best match"; the pair view's choice of particle for a candidate | `<collection>ToTruth`: the AdaptiveNominal working point, one particle per reco object, with `sharedEnergy` and `score` (0 is best) |
| a reco object's purity, and whether its match is clean (inspector, truth mode) | `ToTruth.sharedEnergy` over the object's own amount, as the relation's `match` hint says ([Truth](truth.md#measures)) |
| a truth particle's matched reco objects (its card's "Reconstructed as"), a match's completeness | `<collection>FromTruth` (TruthToReco), with `sharedFraction` and `score` |
| "the particle" that colours and groups everything below it; the levels in the lineage | `TruthParticles.levelFlags` (truth::LevelFlag; bit 2 StableDecayProducts, bit 3 CaloBoundary) |
| a hit's particle; "simulated energy in its hits, by particle" | `TruthHGCalHits`, `TruthSoAHits{EE,HSi,HSci}`: per (particle, hit), the simulated energy of the particle's subgraph |

**Worked out in evd.** These are stand-ins, to be replaced when CMSSW provides the information:

- **Layer cluster → particle** (gap 1): the particle with the most simulated energy in the cluster's hits, each hit
  weighted by the cluster's fraction (`contentPartners` in `viewer/src/model/relations.ts`). The legend labels it
  "derived in evd".
- **One colour per generator particle** (gap 2): a particle takes the colour of its highest ancestor in the profile's
  `particle` level, the generator-level stable particles (`identities` in the same file; [Truth](truth.md)). So a π⁺
  that interacted in the tracker, its daughters' hits and its track share one colour. A shower secondary matched to a
  trackster has the colour of the shower's hits. The inspector still names the particle that was actually matched,
  and its lineage.
- **Small, faint grey hits** mean that no exported particle left energy in them: noise, or a particle that was not
  exported (gaps 3 to 5). The export cannot tell which. The larger mid grey means something else: a particle beyond
  the seven that get a colour.

## How truth reaches evd

Sources: CMSSW_20_1_0_pre5 with the truth-graph and exporter developments. CMSSW paths are relative to `src/`
(SimDataFormats/TruthInfo as in the release). Numbers marked *measured* come from the bundles `gun3_0PU.evdb` (events
0 to 2) and `ttbar_pu200.evdb` (events 0 and 1), read with `evdtools.bundle`. Checked on 2026-11-10.

1. **Graph and hit index**, built at DIGI (`PhysicsTools/TruthInfo/python/truthGraphMixedDigi_cff.py`). For every
   particle of the graph, the hit index holds its own calorimeter `PCaloHit` energy per DetId ("direct"), and the set
   including its descendants ("subgraph"). The calorimeter channel covers HGCal EE/HEF/HEB, the ECAL barrel and HCAL
   (`SimDataFormats/TruthInfo/interface/LogicalGraphHitIndex.h:20-25`). By default the graph holds pile-up from the
   **in-time bunch crossing only** (`truthGraphMixedDigi_cff.py:49`, `pileupBunchCrossings=[0]`). A step2
   customisation can add out-of-time crossings (the evd reference samples have -3 to +3); the `hgcal` profile then
   keeps crossing 0 only.
2. **Associators** (`SimGeneral/TruthGraphAssociatorProducers/python/truthGraphAssociators_cff.py`), scheduled by
   `customiseTruthGraphAssociators`. Each one writes a `RecoToTruth<WP>` map per working point (Fixed,
   AdaptiveTight, AdaptiveNominal) and one `TruthToReco` map. The `TruthAssociationTraits` specialisations list the
   reco types covered (`plugins/AllRecoToTruthBranchAssociatorsProducer.cc:137-227`): `reco::Track`, `reco::Vertex`,
   `reco::PFCluster`, `ticl::Trackster`, `TICLCandidate`. **Not `reco::CaloCluster`.**
3. **The exporter** (`DPGAnalysis/EventDisplayNanoAOD/plugins/TruthTableProducers.cc`, `python/eventDisplayNano_cff.py`)
   writes `TruthParticles`, `TruthVertices`, `TruthParticleChildren`, `<coll>ToTruth` (AdaptiveNominal),
   `<coll>FromTruth` (TruthToReco), and `TruthHGCalHits` / `TruthSoAHits{EE,HSi,HSci}` (particle → hit, simulated
   energy). The SoA ones are written only where SoA hit tables are written, which a stock release does not do
   ([CMSSW side](cmssw.md#soa-collections)).
4. **The evd profile** `evdtools/profiles/hgcal.json:64-114` reads all of these as relations. `sameRows`
   redirects the legacy CLUEstering relations to the SoA tracksters (`hgcal.json:12`, `evdtools/nano.py:313-329`).

### Definitions the display inherits (shared energy, scores)

From `PhysicsTools/TruthInfo/interface/BranchHitAssociator.h:66-108`, and the producer at `:820-866`:

- A **truth branch** is a particle with its whole subgraph of descendants. A reco object is matched to branches, not
  to single particles. So an ancestor always shares at least as much energy as its descendants.
- The weight of a cell is the rechit energy of the cell (offline: the legacy `HGCalRecHit` collections, the default
  at `:951-955`). The branch owns `simE_branch / simE_cell_total` of it, and the reco object owns its hit fraction.
  The shared energy per cell is the smaller of the two.
- `ToTruth.sharedEnergy` [GeV, rechit scale] and `ToTruth.score`: normalised to the reco object, "squared uncovered
  energy over squared self energy". 0 is best. It is **not** linear, so 1 − score is not a purity.
- `FromTruth.sharedFraction` = shared energy / branch energy **in HGCal** (`denominatorDetectors`, cff `:127`), and
  `FromTruth.score` is the reverse score, normalised to the branch.
- **AdaptiveNominal** picks one branch per reco object, by minimising `score + reverseScore` over the "assignable"
  roots. Partons, beam particles, electroweak bosons and synthetic nodes are excluded (cff `:38-44`). So the match can
  be at any level: a shower secondary, a particle that entered the calorimeter, a π⁰, or a decaying hadron.
- Candidate roots: every particle that is not a parton and not synthetic, with |η| < 4, **with no pT cut**, signal
  and pile-up alike (`TruthBranchTargetsProducer.cc:126-150`, cff `:21-32`).

## Gap table

Where each gap is:

- **G**: not in the graph or the hit index;
- **A**: in the graph, but with no associator;
- **X**: an associator exists, but the exporter does not write it;
- **E**: exported, but evd does not read it, or reads it in a way that loses information.

The priority is for the event display.

| # | What is missing | Class | Where | Priority |
|---|---|---|---|---|
| 1 | **Layer cluster ↔ truth association** | A | no `TruthAssociationTraits<reco::CaloCluster>`, no `layerClusters` domain in `truthGraphRecoLabelsPSet` (`truthGraphAssociationLabels_cff.py:37-54`), nothing in `truthGraphAssociatorsSequence` (cff `:190-199`), no layer-cluster validator in `Validation/TruthInfo` | high |
| 2 | Hits of the particle that a reco object is matched to, when that particle is not the one entering the calorimeter | X | `TruthHitTableProducer` exports subgraph hits only for particles with `LevelFlag::CaloBoundary` (`TruthTableProducers.cc`, the default of its `levelMask`) | high |
| 3 | Total simulated energy per hit (all particles), to tell a grey hit apart as noise or as a particle that was not exported | X (the data is in the index, but not exported) | `TruthTableProducers.cc` writes only (exported particle, hit) rows | high |
| 4 | Particles that deposit energy, but are neither signal nor matched by a calorimeter object, are not exported, so their hits have no particle. **Fixed in evd's exporter**: `keepLevelMask`, see [3–5. Unattributed energy](#35-unattributed-energy). | X | the selection in `TruthTableProducers.cc`; `keepMatchedBy` excludes tracks (`eventDisplayNano_cff.py`); pairs with particles that are not exported are dropped (`TruthTableProducers.cc`) | high at pile-up |
| 5 | Out-of-time pile-up has no particles at all (in the default configuration; where a sample has them, the `hgcal` profile drops them) | G | `truthGraphMixedDigi_cff.py:49` (`pileupBunchCrossings=[0]`) | medium |
| 6 | First-stage tracksters of a non-v6 (CLUE3D) reconstruction. **Fixed**: the associator follows the scheduled labels (`truthGraphAssociationLabels_cff.py:170-189`), and so does the exporter now (it reads `truthGraphAssociationLabels_cff`, so a stock release writes `ticlTrackstersCLUE3DHigh{To,From}Truth`). The profile reads them (`clue3dTruth`, `truthClue3d` in `hgcal.json`), with the same `match` contract as the CLUEstering tracksters. | X | | done |
| 7 | Candidate truth is calorimeter-only: a track-only candidate has no candidate match | A (by design) | `RecoHitAdapters.h:148-161`, traits `AllRecoToTruthBranchAssociatorsProducer.cc:217-224` | medium |
| 8 | Runner-up matches per reco object (Fixed working point: every branch that shares energy) | X | only `RecoToTruthAdaptiveNominal` is exported (`eventDisplayNano_cff.py`) | low |
| 9 | HLT tracksters, tracks and vertices (for offline vertices, see 14: exported) | X | `allVertexToTruthBranchAssociators` and `hlt*Associators` exist (cff `:89-114`, `:167-184`); the HLT ones are not exported | low |
| 10 | SoA objects are never associated directly | A | covered only through legacy copies (`HGCalTrackstersFromSoAProducer` in `tracksterProducerTypes`, labels cff `:26-33`) and evd's `sameRows` | low (works while SoA == legacy) |
| 11 | Times of the simulated hits | X | `LogicalGraphHitIndex::directHitTimes` (`LogicalGraphHitIndex.h:77-79,160-171`), not exported | low |
| 12 | Hit truth for the barrel and forward calorimeters (EB, HB, HF, HO). **Fixed in evd's exporter.** | X | `TruthEcalHits`, `TruthHBHEHits`, `TruthHFHits`, `TruthHOHits` (`truthCaloHitTables` in `eventDisplayNano_cff.py`), drawn as facts (`fact` hint, `pf.json`). At 200 pile-up, before the in-time cut: 253k EB, 13k HB and 103k HF links per event (1.7, 0.09 and 0.34 MB in the NanoAOD) | high |
| 13 | ECAL and HCAL PF-cluster associations. **Fixed in evd's exporter.** | X | `particleFlowCluster{ECAL,HCAL}{To,From}Truth` (`_truthMatched` in `eventDisplayNano_cff.py`), with the `PFClusters{ECAL,HCAL}` tables in collection order; `match` hints in `pf.json` | high |
| 14 | Primary and secondary vertex associations (part of gap 9). **Fixed in evd's exporter.** Still to check: the table producer drops pairs whose truth vertex is not an exported `TruthVertices` row, without counting them. | X | `offlinePrimaryVertices{To,From}Truth`, `inclusiveSecondaryVertices{To,From}Truth` (`truthVertexTables` in `eventDisplayNano_cff.py`), joined to `TruthVertices.graphIndex`; `match` hints with `target` interaction / decayVertex, `measure` pt2, and `purity` in `physics.json` | medium |
| 15 | PF-cluster associator for HF and HO | A (CMSSW configuration) | `truthGraphRecoLabelsPSet` (`truthGraphAssociationLabels_cff.py:37-54`) has only `pfClustersEcal/Hcal`. Add `pfClustersHF = particleFlowClusterHF`, `pfClustersHO = particleFlowClusterHO`, and two module clones with `denominatorDetectors=["Hcal"]` **and** `pfRecHits` including `particleFlowRecHitHF` and `particleFlowRecHitHO`. The default list is ECAL + HBHE (`AllRecoToTruthBranchAssociatorsProducer.cc:966`); without the change, HF cells are weighted by simulated photoelectrons. | medium |
| 16 | The muon channel is not keyed by cell | G | PSimHits are keyed by `detUnitId` only (`LogicalGraphHitIndexProducer.cc:430-433`): CSC layer, RPC roll, GEM partition (DT is per wire). Two particles in one CSC layer cannot be told apart per rechit. Ask for a cell key (strip or wire group, from the PSimHit entry and exit points), as the tracker channel has. evd exports muon-hit truth at the coarser unit (`TruthMuonHits`: every rechit of a unit gets the unit's energy; `fact.unit` names it). | medium |
| 17 | Muon-segment association | A | no `truth::recoHits` for `DTRecSegment4D`, `CSCSegment`, `GEMSegment` (the sim-unit DetIds of their rechits), no traits, no `muonSegments` domain; metric SharedHits on the Muon channel; thresholds from MuonAssociatorByHits (purity 0.75, efficiency 0.5, `Validation/RecoMuon/python/associators_cff.py:23-42`) | medium |
| 18 | Muon association (reco::Muon, standaloneMuons, globalMuons) | A + G | `recoHits(reco::Track)` keeps only `TrackerSingleRecHit` (`PhysicsTools/TruthInfo/interface/RecoHitAdapters.h:46-90`). So listing `globalMuons` in the `tracks` domain would match only its tracker stub (do not do this in evd). Ask for a muon-hit adapter, a reco::Muon trait judged per stub (the tracker through the track map, the muon system through 17), and a graph level for "muon reaching the muon system" (the graph has only checkpoint 0, tracker → calorimeter; `ParticleData.h:130-131`). | medium |
| 19 | MTD-cluster and track-time association; MTD truth for particles outside CaloBoundary subgraphs | A + X | The MTD channel is filled with cells and times (`LogicalGraphHitIndexProducer.cc:436-471`), but nothing in CMSSW uses it. Ask for `recoHits(FTLCluster)` → (module, cell), an `mtdClusters` domain, and the matched particle's simulated time at MTD for track-time validation. evd exporter: a direct-hit mode and `keepWithHits` (40% of the MTD cells at 200 pile-up are outside CaloBoundary subgraphs, *measured*). evd exports the MTD rechits, `MTDHits`, keyed by rechit DetId with row and column, without truth. The join on module and cell and a direct-hit mode are exporter work. They would add about 0.4 MB and up to 17.5k particles per event at 200 pile-up. | low |
| 20 | PF-candidate association | A | the producer's `ConstituentBased` strategy names it (`AllRecoToTruthBranchAssociatorsProducer.cc:118-128`); needs a `reco::PFCandidate` trait over the track map and the PF-cluster and TICL-candidate maps (target ReconstructableFinalState, bit 10) | medium |
| 21 | Jet association and generator jets | G + A | no clustering of graph particles (StableDecayProducts ∩ isSignal ∩ visible) into a level or a product; then a constituent-based `reco::PFJet` trait over 20. Never GenJet. | low |
| 22 | Truth MET | G | −ΣpT of the visible signal generator particles, as a graph product (neutrinos are in the graph, GEN-only status 1). Never GenMET. | low |
| 23 | e/γ association | A | `GsfElectron` and `Photon` traits (supercluster clusters + GSF track); a `reco::GsfTrack` trait that reuses the track adapter (GsfTrack derives from reco::Track; `electronGsfTracks` is in step3); SuperCluster and CaloCluster not covered (gap 1) | low |
| 24 | τ association | A | a `reco::PFTau` trait over the signal constituents; target TauVisibleHadronic (bit 11, exists; 0.2 per event without pile-up) | low |
| 25 | HF rechit energy without simulated energy without pile-up; ECAL barrel rechits between 0.5 and 1 GeV without simulated energy | open (not yet a gap) | **HF:** 20–50% of the HF rechit energy above 0.5 GeV in events without pile-up has no simulated hit in its cell, although the index holds all the g4SimHits HF energy (*measured*, `hfcheck.py`). The cause is digitisation or noise. It is shown as "no truth"; check with an HF expert before the viewer calls it noise. **ECAL barrel,** without pile-up: half of the rechits above 0.5 GeV have no simulated energy (0.5–1.1 GeV, median 0.55, times −34 to +16 ns); every rechit above 1 GeV has some. Only 52% of the ECAL PF clusters above 0.5 GeV have a truth match, and 98% above 1 GeV. This is likely noise, to be confirmed with ECAL experts. The `calo` and `pf` profiles cut EB hits and PF clusters at 1 GeV by default. | — |

### 1. Layer clusters

- **Graph:** it has everything needed. A layer cluster is a list of (DetId, fraction), and the hit index has the
  simulated energy per particle per DetId.
- **Associator:** the hit adapter already exists, `truth::recoHits(reco::CaloCluster const&)`
  (`PhysicsTools/TruthInfo/interface/RecoHitAdapters.h:106-117`). `reco::PFCluster` uses it through its base class.
  What is missing: the traits specialisation for `reco::CaloCluster`, a `DEFINE_FWK_MODULE` alias, a
  `layerClusters=cms.vstring("hgcalMergeLayerClusters")` domain, and a module in the sequence. Checked both in the
  local area and in the release: there is no `LayerCluster` domain anywhere in
  `SimGeneral/TruthGraphAssociatorProducers` or `Validation/TruthInfo`.
- **In evd today:** layer clusters reach the truth only through their hits.
  - The colour (`contentPartners`, `viewer/src/model/relations.ts`) takes the particle with the largest sum of hit
    fraction × `simEnergy`.
  - The fact line on the hits' step of the card's chain (`linksOf`, `viewer/src/model/chain.ts`) sums `simEnergy`
    over the object's hits, without fractions.

  Neither knows the cell's total simulated energy, and both inherit gaps 2 to 4.
- **Check:** a producer alias such as `TruthBranchLayerClusterAssociatorsProducer` appears (or a `layerClusters` key
  in `truthGraphRecoLabelsPSet`), and the step3 file has `*_truthBranchLayerClusterAssociators_*`. The exporter then
  needs one `_truthMatched` entry (`hgcalMergeLayerClusters`), and evd needs one `ToTruth`/`FromTruth` relation pair
  from `HGCalLayerClusters`. The existing `sameRows` redirect moves it onto `HGCalSoALayerClusters`.

### 2. Hits are exported at a different level from the matches

`TruthHitTable` gives hits only to exported particles with the CaloBoundary bit, that is, particles that crossed the
boundary between tracker and calorimeter outwards (`TruthLevels.h:411-414`). Each of these particles gets the hits of
its **whole subgraph**. But the associator may match a reco object to a particle below that level (a secondary made
inside the calorimeter), or above it (a π⁰, whose photons are not exported unless they are matched themselves).

*Measured at 200 pile-up, ttbar:* 284 of the 1852 distinct CLUEstering match targets (event 0), and 179 of 1219
(event 1), lack CaloBoundary. They are mostly γ and e±, and a few π⁰. 283 and 179 of them have no exported hit
anywhere in their own subgraph. For interpretations: 373 of 2153. For candidates: 221 of 1284. *Gun, without
pile-up:* 2 of 6 CLUEstering targets in event 1 (two photons).

The consequence: the trackster's best particle is not the particle that its hits are attributed to (the
CaloBoundary ancestor). The ancestor's hits are still drawn, because `keepAncestors` exports it. evd works around
matches *below* CaloBoundary: a particle takes the colour of its generator particle (see above). A match *above* it
(for example a π⁰, whose photons own the hits) is shown as an object that merges the generator particles below it
([Truth](truth.md#two-levels-the-particle-and-each-kinds-target)).

**Check:** `TruthHitTableProducer` gets a mode that exports hits for every exported particle with its own
(non-inclusive) direct hits, or for the association targets themselves. Today the only setting is `levelMask`.

### 3–5. Unattributed energy

*Measured.*

- Gun without pile-up, CE-E: 99.5–100% of the hit energy above 35 MeV has a truth particle.
- Gun without pile-up, CE-H silicon: 18–78%. The hits without truth are spread over both endcaps (η from −2.8 to
  +2.8, the first CE-H layers), so they are noise.
- ttbar at 200 pile-up, event 0: CE-E 42% (53k of 157k hits), CE-H silicon 34%, CE-H scintillator 73%. 85k of the
  140k SoA layer clusters have no hit with truth. 7741 particles are exported (2156 signal); 2683 of them own CE-E
  hits (122 signal).

**Checked against the full graph.** On the step3 file of ttbar at 200 pile-up, with FWLite, for every RECO rechit
above 35 MeV: does any particle of the graph have simulated energy in its cell?

- In-time pile-up: 94–96% of the CE-E energy, and 84–93% of the CE-H silicon energy.
- Signal: 1–2%.
- No particle of the graph: 2–5% (CE-E) and 6–15% (CE-H silicon).

The graph holds 120–174k pile-up particles per event, and the export kept about 8k. So the sample is complete for
in-time pile-up, and the loss came from the export's selection (gap 4). The rest is noise (gun without pile-up:
about 250 CE-H silicon hits per event at E/σ ≈ 3, with no time), and, most likely, out-of-time pile-up (gap 5; about
7k such hits per event at 200 pile-up, far above the noise).

**Gap 4 is addressed in evd's exporter** (branch `evd-export` of the CMSSW developments area).
`TruthGraphTableProducer` has `keepLevelMask`, set to CaloBoundary, so every particle that enters the calorimeter is
exported with its hits, pile-up included. For ttbar at 200 pile-up:

- 82–136k particles per event (ancestors included), instead of 7.7k;
- hit energy with a particle: 95–98% (CE-E) and 85–91% (CE-H silicon), as much as the full graph allows;
- NanoAOD 1.79 GB instead of 1.16 GB, and bundle 1.56 GB instead of 0.96 GB (+62%).

The export still cannot tell noise from out-of-time pile-up (gap 3). The total simulated energy per cell is computed
inside the associator (`BranchHitAssociator.h:187-188`, `cellTotalEnergy`), but never written out.

**Check:** a `simEnergyTotal` (or `hasSim`) column on the hit tables, or a `TruthHitTable` row for "all other
particles".

### Per-hit simulated energy: what it is, exactly

- It is per (exported CaloBoundary particle, hit), summed over the particle's subgraph (`TruthTableProducers.cc`,
  doc string `:422`). It is the `PCaloHit` deposited energy: sampling energy, not calibrated. Only ratios between
  particles are meaningful, not a comparison with the rechit energy.
- It is **not** for all particles: only for exported particles (signal, matched, and their ancestors) that also have
  CaloBoundary.
- **Overlap:** a hit can have several owners. *Measured:* up to 4 owners at 200 pile-up, and 20 hits with several
  owners in a gun event. The owners are always separate branches. Every level is an antichain: `fillLevelFlags`
  keeps the earliest member of each chain (`PhysicsTools/TruthInfo/interface/TruthLevels.h:688-795`), so no
  CaloBoundary particle is an ancestor of another. Hits with several owners are overlapping showers.
- **Pile-up:** in-time pile-up particles appear only when they are matched, or as ancestors of matched particles.
  `isSignal` separates them. Out-of-time pile-up is absent by default (gap 5), and the `hgcal` profile drops it where
  it is present.

### 6–11. Smaller gaps, briefly

- **6:** fixed. The exporter reads `truthGraphRecoLabelsPSet.tracksters` instead of a hard-coded list of v6 labels,
  so a TICL v5 / CLUE3D sample gets its `ticlTrackstersCLUE3DHigh*Truth` tables.
- **7:** *measured* at 200 pile-up: 1307 of 1910 candidates have a match. The others include track-only candidates.
  Their tracks carry a `generalTracksToTruth` match, which the card shows as the track's (no CMSSW change needed).
- **8:** evd's reco → truth relations have at most one entry per object (*measured*: the number of entries equals the
  number of matched objects in every relation). "Several truth matches" exists only in the truth → reco direction
  (`FromTruth`).
- **9, 11:** the associators and the data exist; only the export is missing.
- **10:** `sameRows` drops the legacy table, and raises an error if SoA and legacy ever differ
  (`evdtools/nano.py:241-249`). The truth for SoA tracksters is then lost unless the entry is removed. A direct SoA
  associator (`TruthAssociationTraits` on the SoA view) would remove this dependency.

### Covered only by legacy simulation objects today

Layer cluster ↔ truth (gap 1) and runner-up particles per object (gap 8, partly) exist today only in the
SimCluster/CaloParticle associations of HGCalNanoAOD
(`DPGAnalysis/HGCalNanoAOD/python/hgcalTracksters_cfi.py:166,183`). The `hgcal.json` profile excludes them
(`"exclude": ["Sim*", "Reco*2Sim*", "ticlSim*", ...]`), and should keep doing so.

## Track association weights are hit counts

The track associator (`AllRecoToTruthBranchAssociatorsProducer.cc:858-877`) works with hits. Its payload is a number
of shared hits, and its score is 1 − shared hits / track hits (*measured*: exact for every track of the sample
without pile-up).

The exporter writes the count under the calorimeter names (`generalTracksToTruth.sharedEnergy`,
`generalTracksFromTruth.sharedFraction`, integers from 1 to 33). The viewer calls them "shared hits", from the
relations' `match.measure`.

The maps have no threshold. CMS tracking validation calls a track with less than 75% shared hits a fake (*measured*
at 200 pile-up: 11% of the matched tracks are below 75%). This is why the truth mode colours a track by its particle
only from 75%.

**Check:** the exporter names the column after the associator's metric.

## What the bundles carry for truth, and what the viewer does not use

*Measured* (zlib, per event; 50 events without pile-up, events 0–2 at 200 pile-up, in-time cut applied): truth is
0.41 of 1.58 MB without pile-up (26%), and 13.6 of 31.0 MB at 200 pile-up (44%). At 200 pile-up: particles 5.2 MB
(102k rows), truth hit relations 4.3 MB, TruthToReco 2.6 MB, vertices 1.0 MB.

What no profile, converter or viewer code uses, at 200 pile-up (the inspector lists every column, so nothing is
invisible):

| what | MB / event | note |
|---|---|---|
| `TruthParticles` pt, eta, phi, mass, t | 1.5 | can be derived from the momentum and the vertex |
| `TruthParticles` x, y, z | 0.56 | the production vertex's position (used for drawing; could be read through `truthProdVertex`) |
| legacy truth hits (`TruthHGCalHits`) | 2.1 | duplicate the SoA truth hits where SoA exists (legacy hits start hidden) |
| TruthToReco entries with `sharedFraction` < 0.1 | ≈ 1.6 (62% of 2.6) | 56 particles per interpretation trackster |
| particles with neither HGCal hits nor matches | ≈ 3.5 (estimate) | 73k of 108k rows: CaloBoundary particles in the barrel and forward regions, kept for barrel truth hits that are not exported yet |

None of these is dropped yet. Each is a choice to make when the bundle is split into parts. The leaner direction is
to export what the truth display needs (per-particle direct hits, a total simulated energy per hit, barrel hits), and
to drop what it does not need.

## What to watch for in CMSSW

1. `grep -n "reco::CaloCluster>" SimGeneral/TruthGraphAssociatorProducers/plugins/*.cc` finds a traits
   specialisation, and `truthGraphRecoLabelsPSet` has a layer-cluster domain (gap 1).
2. `TruthHitTableProducer` has a mode that is not limited to CaloBoundary, or a column with the total simulated
   energy per hit (gaps 2, 3).
3. `keepMatchedBy` includes tracks, or there is an option "keep every particle with HGCal hits above E" (gap 4).
4. `pileupBunchCrossings` is widened, or there is an out-of-time summary per hit (gap 5).
5. Done: the exporter reads its list of labels from `truthGraphAssociationLabels_cff` (gap 6).
