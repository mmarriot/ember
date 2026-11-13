# The truth graph in evd: what is used, and what is missing

"Truth" in evd means the CMSSW **truth graph** and nothing else: `truth::Graph` and its hit index
(`truth::LogicalGraphHitIndex`, PhysicsTools/TruthInfo), and the reco <-> truth associations of
SimGeneral/TruthGraphAssociatorProducers, as the `NANO:@EVD` flavour (DPGAnalysis/EventDisplayNanoAOD, "the
exporter" below; [CMSSW side](cmssw.md)) writes them to NanoAOD. CaloParticle, SimCluster
and SimTrackster are not used (the `hgcal` profile excludes their tables) and should not be.

This page says what the viewer shows from the truth graph, what it works out itself where the graph has no answer,
and what is missing, so each gap can be checked off as CMSSW adds it. What a reco object is compared with, the
measures (purity, completeness) and the colours are in [truth.md](truth.md).

## What the viewer shows

| in the viewer | from |
|---|---|
| Truth graph · Particles, Vertices; the Truth tab (parent -> children) | `TruthParticles`, `TruthVertices`, `TruthParticleChildren` |
| a reco object's "best match"; the pair view's choice of particle for a candidate | `<collection>ToTruth`: the AdaptiveNominal working point, one particle per reco object, with `sharedEnergy` and `score` (0 is best) |
| a reco object's purity and whether its match is clean (inspector, truth mode) | `ToTruth.sharedEnergy` over the object's own amount, as the relation's `match` hint says ([truth.md](truth.md#measures)) |
| a truth particle's matched reco objects (its card's "Reconstructed as"), a match's completeness | `<collection>FromTruth` (TruthToReco), with `sharedFraction` and `score` |
| "the particle" that colours and groups everything below it; the lineage's levels | `TruthParticles.levelFlags` (truth::LevelFlag; bit 2 StableDecayProducts, bit 3 CaloBoundary) |
| a hit's particle, "simulated energy in its hits, by particle" | `TruthHGCalHits`, `TruthSoAHits{EE,HSi,HSci}`: per (particle, hit) the simulated energy of the particle's subgraph |

**Worked out in evd** (stand-ins, to be replaced when CMSSW provides the information):

- **Layer cluster -> particle** (gap 1): the particle with the most simulated energy in the cluster's hits, each hit
  weighted by the cluster's fraction (`contentPartners` in `viewer/src/model/relations.ts`). Labelled "derived in
  evd" in the legend.
- **One colour per generator particle** (gap 2): a particle takes the colour of its highest ancestor in the profile's
  `particle` level, the generator-level stable particles (`identities` in the same file; [truth.md](truth.md)). So a
  π⁺ that interacted in the tracker, its daughters' hits and its track share a colour, and a shower secondary matched
  to a trackster has the colour of the shower's hits. The inspector still names the particle actually matched, and
  its lineage.
- **Small, faint grey hits** mean no exported particle left energy in them: noise, or a particle that was not exported
  (gaps 3 to 5); the export cannot tell which. (The larger mid-grey is different: a particle beyond the seven that get
  a colour.)

## How truth reaches evd

Sources: CMSSW_20_1_0_pre5 with the truth-graph and exporter developments; CMSSW paths are relative to `src/`
(SimDataFormats/TruthInfo as in the release). Numbers marked *measured* come from the bundles `gun3_0PU.evdb` (events
0 to 2) and `ttbar_pu200.evdb` (events 0 and 1), read with `evdtools.bundle`. Checked on 2026-11-10.

1. **Graph + hit index**, built at DIGI (`PhysicsTools/TruthInfo/python/truthGraphMixedDigi_cff.py`). The hit index
   holds, for every graph particle, its own calorimeter `PCaloHit` energy per DetId ("direct") and the
   descendant-inclusive set ("subgraph"). Calo channel = HGCal EE/HEF/HEB, ECAL barrel, HCAL
   (`SimDataFormats/TruthInfo/interface/LogicalGraphHitIndex.h:20-25`). Pile-up is in the graph for **in-time
   bunch crossings only** by default (`truthGraphMixedDigi_cff.py:49`, `pileupBunchCrossings=[0]`); a step2
   customisation can add out-of-time crossings (the evd reference samples have -3..+3), and the `hgcal` profile then
   keeps crossing 0 only.
2. **Associators** (`SimGeneral/TruthGraphAssociatorProducers/python/truthGraphAssociators_cff.py`), scheduled
   by `customiseTruthGraphAssociators`. Each one writes a `RecoToTruth<WP>` map per working point (Fixed,
   AdaptiveTight, AdaptiveNominal) and one `TruthToReco` map. The reco types covered are listed in the
   `TruthAssociationTraits` specialisations (`plugins/AllRecoToTruthBranchAssociatorsProducer.cc:137-227`):
   `reco::Track`, `reco::Vertex`, `reco::PFCluster`, `ticl::Trackster`, `TICLCandidate`. **Not `reco::CaloCluster`.**
3. **The exporter** (`DPGAnalysis/EventDisplayNanoAOD/plugins/TruthTableProducers.cc`, `python/eventDisplayNano_cff.py`)
   writes `TruthParticles`, `TruthVertices`, `TruthParticleChildren`, `<coll>ToTruth` (AdaptiveNominal),
   `<coll>FromTruth` (TruthToReco), and `TruthHGCalHits` / `TruthSoAHits{EE,HSi,HSci}` (particle -> hit, sim
   energy; the SoA ones only where SoA hit tables are written, which a stock release does not do: [CMSSW side](cmssw.md#soa-collections)).
4. **evd profile** `evdtools/profiles/hgcal.json:64-114` reads all of these as relations. Legacy CLUEstering
   relations are redirected to the SoA tracksters by `sameRows` (`hgcal.json:12`, `evdtools/nano.py:313-329`).

### Definitions the display inherits (shared energy, scores)

From `PhysicsTools/TruthInfo/interface/BranchHitAssociator.h:66-108`, plus the producer at `:820-866`:

- A **truth branch** is a particle plus its whole descendant subgraph. A reco object is matched to branches, not to
  single particles, so an ancestor always shares at least as much energy as its descendants.
- Cell weight = rechit energy of the cell (offline: legacy `HGCalRecHit` collections, default at `:951-955`). The
  branch owns `simE_branch / simE_cell_total` of it, the reco object owns its hit fraction. Shared energy per cell is
  the minimum of the two.
- `ToTruth.sharedEnergy` [GeV, rechit scale] and `ToTruth.score`: reco-normalised, "squared uncovered energy over
  squared self energy". 0 is best. It is **not** linear, so 1 − score is not a purity fraction.
- `FromTruth.sharedFraction` = shared energy / branch energy **in HGCal** (`denominatorDetectors`, cff `:127`), and
  `FromTruth.score` = branch-normalised reverse score.
- **AdaptiveNominal** picks one branch per reco object by minimising `score + reverseScore` over the "assignable" roots.
  Partons, beam particles, EW bosons and synthetic nodes are excluded (cff `:38-44`). The match can therefore be at any
  level: a shower secondary, a calorimeter-entering particle, a π⁰, or a decaying hadron.
- Candidate roots: every non-parton, non-synthetic particle with |η| < 4, **no pt cut**, signal and pile-up alike
  (`TruthBranchTargetsProducer.cc:126-150`, cff `:21-32`).

## Gap table

Location classes: **G** = not in the graph/hit index; **A** = in the graph but no associator; **X** = associator
exists but the exporter does not write it; **E** = exported but evd does not read it, or reads it in a way that loses
information. Priority is for the event display.

| # | What is missing | Class | Where | Priority |
|---|---|---|---|---|
| 1 | **Layer cluster <-> truth association** | A | no `TruthAssociationTraits<reco::CaloCluster>`, no `layerClusters` domain in `truthGraphRecoLabelsPSet` (`truthGraphAssociationLabels_cff.py:37-54`), nothing in `truthGraphAssociatorsSequence` (cff `:190-199`), no LC validator in `Validation/TruthInfo` | high |
| 2 | Hits of the particle a reco object is matched to, when that particle is not the one entering the calorimeter | X | `TruthHitTableProducer` exports subgraph hits only for particles with `LevelFlag::CaloBoundary` (`TruthTableProducers.cc`, its `levelMask` default) | high |
| 3 | Total simulated energy per hit (all particles), so a grey hit can be told apart as noise or as an un-exported particle | X (data in index, not exported) | `TruthTableProducers.cc` writes only (exported particle, hit) rows | high |
| 4 | Particles that deposit energy but are neither signal nor matched by a calorimeter object are not exported, so their hits stay unattributed (**fixed in evd's exporter**: `keepLevelMask`, see the section "3–5. Unattributed energy") | X | selection `TruthTableProducers.cc`; `keepMatchedBy` excludes tracks (`eventDisplayNano_cff.py`); pairs to un-exported particles dropped (`TruthTableProducers.cc`) | high at PU |
| 5 | Out-of-time pile-up has no particles at all (default configuration; where a sample has them, the `hgcal` profile drops them) | G | `truthGraphMixedDigi_cff.py:49` (`pileupBunchCrossings=[0]`) | medium |
| 6 | First-stage tracksters of a non-v6 (CLUE3D) reconstruction | X | the associator follows the scheduled labels (`truthGraphAssociationLabels_cff.py:170-189`), and **the exporter now does too** (it reads `truthGraphAssociationLabels_cff`, so a stock release writes `ticlTrackstersCLUE3DHigh{To,From}Truth`); the profile has `clue3dLCs` but no CLUE3D truth relation yet (`hgcal.json`) | medium |
| 7 | Candidate truth is calorimeter-only; a track-only candidate has no candidate match | A (by design) | `RecoHitAdapters.h:148-161`, traits `AllRecoToTruthBranchAssociatorsProducer.cc:217-224` | medium |
| 8 | Runner-up matches per reco object (Fixed WP: every branch sharing energy) | X | only `RecoToTruthAdaptiveNominal` is exported (`eventDisplayNano_cff.py`) | low |
| 9 | HLT tracksters/tracks/vertices (offline vertices: see 14, exported) | X | `allVertexToTruthBranchAssociators`, `hlt*Associators` exist (cff `:89-114`, `:167-184`); the HLT ones are not exported | low |
| 10 | SoA objects are never associated directly | A | coverage only through legacy copies (`HGCalTrackstersFromSoAProducer` in `tracksterProducerTypes`, labels cff `:26-33`) plus evd `sameRows` | low (works while SoA == legacy) |
| 11 | Hit times of the sim hits | X | `LogicalGraphHitIndex::directHitTimes` (`LogicalGraphHitIndex.h:77-79,160-171`), not exported | low |
| 12 | Barrel/forward calorimeter hit truth (EB, HB, HF, HO) | X → **fixed in evd's exporter** | `TruthEcalHits`, `TruthHBHEHits`, `TruthHFHits`, `TruthHOHits` (`truthCaloHitTables` in `eventDisplayNano_cff.py`), drawn as facts (`fact` hint, `pf.json`). At PU200, before the in-time cut: 253k EB, 13k HB, 103k HF links per event (1.7, 0.09, 0.34 MB in the nano) | high |
| 13 | ECAL/HCAL PF-cluster associations | X → **fixed in evd's exporter** | `particleFlowCluster{ECAL,HCAL}{To,From}Truth` (`_truthMatched` in `eventDisplayNano_cff.py`), with the `PFClusters{ECAL,HCAL}` tables in collection order; `match` hints in `pf.json` | high |
| 14 | Primary/secondary vertex associations (part of gap 9) | X → **fixed in evd's exporter** | `offlinePrimaryVertices{To,From}Truth`, `inclusiveSecondaryVertices{To,From}Truth` (`truthVertexTables` in `eventDisplayNano_cff.py`), joined to `TruthVertices.graphIndex`; `match` hints with `target` interaction / decayVertex, `measure` pt2, `purity` in `physics.json`. Still to check: pairs whose truth vertex is not an exported `TruthVertices` row are dropped by the table producer without being counted | medium |
| 15 | PF-cluster associator for HF and HO | A (CMSSW config) | `truthGraphRecoLabelsPSet` (`truthGraphAssociationLabels_cff.py:37-54`) has `pfClustersEcal/Hcal` only. Add `pfClustersHF = particleFlowClusterHF`, `pfClustersHO = particleFlowClusterHO`, two module clones with `denominatorDetectors=["Hcal"]` **and** `pfRecHits` including `particleFlowRecHitHF`, `particleFlowRecHitHO` (default list is ECAL + HBHE, `AllRecoToTruthBranchAssociatorsProducer.cc:966`; without it HF cells are weighted by simulated photoelectrons) | medium |
| 16 | Muon channel not cell-keyed | G | PSimHits keyed by `detUnitId` only (`LogicalGraphHitIndexProducer.cc:430-433`): CSC layer, RPC roll, GEM partition (DT is per wire). Two particles in one CSC layer cannot be told apart per rechit. Ask: a cell key (strip / wire group from the PSimHit entry/exit point), as the tracker channel has. evd exports muon-hit truth at that unit (`TruthMuonHits`: every rechit of a unit gets the unit's energy; `fact.unit` names it) | medium |
| 17 | Muon-segment association | A | no `truth::recoHits` for `DTRecSegment4D`, `CSCSegment`, `GEMSegment` (their rechits' sim-unit DetIds), no traits, no `muonSegments` domain; metric SharedHits on the Muon channel; thresholds from MuonAssociatorByHits (purity 0.75, efficiency 0.5, `Validation/RecoMuon/python/associators_cff.py:23-42`) | medium |
| 18 | Muon association (reco::Muon, standaloneMuons, globalMuons) | A + G | `recoHits(reco::Track)` keeps only `TrackerSingleRecHit` (`PhysicsTools/TruthInfo/interface/RecoHitAdapters.h:46-90`): listing `globalMuons` in the `tracks` domain would match its tracker stub only (do not do this in evd). Ask: a muon-hit adapter, a reco::Muon trait judged per stub (tracker via the track map, muon via 17), and a graph level for "muon reaching the muon system" (the graph has only checkpoint 0, tracker → calorimeter; `ParticleData.h:130-131`) | medium |
| 19 | MTD-cluster and track-time association; MTD truth for particles outside CB subgraphs | A + X | MTD channel filled with cells and times (`LogicalGraphHitIndexProducer.cc:436-471`) but no consumer in CMSSW; ask: `recoHits(FTLCluster)` → (module, cell), an `mtdClusters` domain, and the matched particle's sim time at MTD for track-time validation. evd exporter: direct-hit mode + `keepWithHits` (40% of PU200 MTD cells are outside CB subgraphs, **M**). evd exports the MTD rechits, `MTDHits`, keyed by rechit DetId with row and col, without truth: the join on module + cell and a direct-hit mode are exporter work, and would add about 0.4 MB and up to 17.5k particles per PU200 event. | low |
| 20 | PF-candidate association | A | the producer's `ConstituentBased` strategy names it (`AllRecoToTruthBranchAssociatorsProducer.cc:118-128`); a `reco::PFCandidate` trait over the track map and the PF-cluster/TICL-candidate maps (target ReconstructableFinalState, bit 10) | medium |
| 21 | Jet association and generator jets | G + A | no clustering of graph particles (StableDecayProducts ∩ isSignal ∩ visible) into a level or product; then a constituent-based `reco::PFJet` trait over 20. Never GenJet | low |
| 22 | Truth MET | G | −ΣpT of visible signal generator particles as a graph product (neutrinos are in the graph, GEN-only status 1). Never GenMET | low |
| 23 | e/γ association | A | `GsfElectron`/`Photon` traits (supercluster clusters + GSF track); a `reco::GsfTrack` trait reusing the track adapter (GsfTrack derives from reco::Track; `electronGsfTracks` is in step3); SuperCluster/CaloCluster not covered (gap 1) | low |
| 24 | τ association | A | `reco::PFTau` trait over signal constituents; target TauVisibleHadronic (bit 11, exists; 0.2 per 0PU event) | low |
| 25 | HF rechit energy without simulated energy at 0PU; ECAL barrel rechits between 0.5 and 1 GeV without simulated energy | open (not yet a gap) | 20–50% of HF rechit energy above 0.5 GeV in 0PU events has no simulated hit in its cell, although the index holds all g4SimHits HF energy (**M**, `hfcheck.py`): digitisation or noise. Shown as "no truth"; check with an HF expert before calling it noise in the UI ECAL barrel at 0PU: half of the rechits above 0.5 GeV have no simulated energy (0.5–1.1 GeV, median 0.55, times −34 to +16 ns), every one above 1 GeV has; only 52% of the ECAL PF clusters above 0.5 GeV have a truth match, 98% above 1 GeV. Likely noise, to confirm with ECAL experts; the `calo` and `pf` profiles cut EB hits and PF clusters at 1 GeV by default. | — |

### 1. Layer clusters

- **Graph:** has everything needed. A layer cluster is a list of (DetId, fraction), and the hit index has sim energy
  per particle per DetId.
- **Associator:** the hit adapter already exists, `truth::recoHits(reco::CaloCluster const&)`
  (`PhysicsTools/TruthInfo/interface/RecoHitAdapters.h:106-117`). `reco::PFCluster` uses it through its base class.
  What is missing is the traits specialisation for `reco::CaloCluster`, a `DEFINE_FWK_MODULE` alias, a
  `layerClusters=cms.vstring("hgcalMergeLayerClusters")` domain, and a module in the sequence. Checked in both the
  local area and the release: no `LayerCluster` domain anywhere in `SimGeneral/TruthGraphAssociatorProducers` or
  `Validation/TruthInfo`.
- **Today in evd:** layer clusters reach truth only through their hits. The colour (`contentPartners`,
  `viewer/src/model/relations.ts`) takes the particle with the largest sum of hit fraction × `simEnergy`; the
  fact line on the hits' step of the card's chain (`linksOf`, `viewer/src/model/chain.ts`) sums `simEnergy` over the
  object's hits without fractions. Neither knows the cell's total sim energy, and both inherit
  gaps 2 to 4.
- **Check:** a producer alias like `TruthBranchLayerClusterAssociatorsProducer` (or a `layerClusters` key in
  `truthGraphRecoLabelsPSet`) appears, and the step3 file has `*_truthBranchLayerClusterAssociators_*`. The exporter
  then needs one `_truthMatched` entry (`hgcalMergeLayerClusters`), and evd one `ToTruth`/`FromTruth` relation pair
  from `HGCalLayerClusters`. The existing `sameRows` redirect moves it onto `HGCalSoALayerClusters`.

### 2. Hits are exported at a different level from the matches

`TruthHitTable` gives hits only to exported particles with the CaloBoundary bit, i.e. particles that crossed the
tracker–calorimeter boundary outwards (`TruthLevels.h:411-414`). Each one gets its **whole subgraph's** hits. The
associator, though, may match a reco object to a particle below that level (a secondary created inside the
calorimeter) or above it (a π⁰, whose photons are not exported unless matched themselves).

*Measured, ttbar PU200:* 284 of the 1852 distinct CLUEstering match targets (event 0) and 179 of 1219 (event 1) lack
CaloBoundary: mostly γ and e±, a few π⁰. 283 and 179 of them have no exported hit anywhere in their own subgraph. For
interpretations: 373 of 2153. For candidates: 221 of 1284. *Gun, 0PU:* 2 of 6 CLUEstering targets in event 1 (two
photons). Consequence: the trackster's best particle is not the particle its hits are attributed to, the
CaloBoundary ancestor. The ancestor's hits are still drawn, because `keepAncestors` exports it. evd works around the
case of matches *below* CaloBoundary by giving a particle the colour of its highest ancestor that owns hits or is
matched (see above); matches *above* it (e.g. a π⁰, whose photons own the hits) still get a colour of their own.

**Check:** `TruthHitTableProducer` gains a mode that exports hits for every exported particle with its own
(non-inclusive) direct hits, or for the association targets themselves. Today the only knob is `levelMask`.

### 3–5. Unattributed energy

*Measured.* Gun 0PU, CE-E: 99.5–100 % of the hit energy above 35 MeV has a truth particle. CE-H silicon: 18–78 %, and
the hits without truth are spread over both endcaps (η from −2.8 to +2.8, first CE-H layers), so they are noise.
ttbar PU200, event 0: CE-E 42 % (53k of 157k hits), CE-H Si 34 %, CE-H scintillator 73 %. 85k of the 140k SoA layer
clusters have no hit with truth. 7741 particles are exported (2156 signal); 2683 of them own CE-E hits (122 signal).

**Checked against the full graph** (step3 of ttbar PU200, FWLite, every RECO rechit above 35 MeV: does any graph
particle have simulated energy in its cell?): in-time pile-up 94–96 % of the CE-E energy and 84–93 % of the CE-H
silicon energy, signal 1–2 %, no graph particle 2–5 % (CE-E) and 6–15 % (CE-H silicon). The graph holds 120–174k
pile-up particles per event; the export kept about 8k. So the sample is complete for in-time pile-up and the loss was
the export's selection (gap 4). The rest is noise (gun 0PU: about 250 CE-H silicon hits per event at E/σ ≈ 3, no
time) and, most likely, out-of-time pile-up (gap 5; about 7k such hits per PU200 event, far above the noise).

**Gap 4 addressed in evd's exporter** (branch `evd-export` of the CMSSW developments area): `TruthGraphTableProducer`
has `keepLevelMask`, set to CaloBoundary, so every particle entering the calorimeter is exported, pile-up included,
with its hits. ttbar PU200: 82–136k particles per event (ancestors included) instead of 7.7k; hit energy with a particle 95–98 % (CE-E) and
85–91 % (CE-H silicon), as the full graph allows; NanoAOD 1.79 GB instead of 1.16 GB, bundle 1.56 GB instead of
0.96 GB (+62 %). The export still cannot tell noise from out-of-time pile-up (gap 3). The per-cell total sim energy is computed
inside the associator (`BranchHitAssociator.h:187-188`, `cellTotalEnergy`) but never written out.
**Check:** a `simEnergyTotal` (or `hasSim`) column on the hit tables, or a `TruthHitTable` row for "all other
particles".

### Per-hit simulated energy: what it is, exactly

- **Per (exported CaloBoundary particle, hit)**, summed over the particle's subgraph (`TruthTableProducers.cc`,
  doc string `:422`). It is the `PCaloHit` deposited energy: sampling energy, not calibrated. Only ratios between
  particles are meaningful, not a comparison with the rechit energy.
- **Not** all particles: only exported ones (signal + matched + ancestors) that also have CaloBoundary.
- **Overlap:** a hit can have several owners. *Measured:* up to 4 owners at PU200, 20 multi-owner hits in a gun
  event. The owners are always disjoint branches: every level is an antichain (`fillLevelFlags` keeps the earliest
  member of each chain, `PhysicsTools/TruthInfo/interface/TruthLevels.h:688-795`), so no CaloBoundary particle is an
  ancestor of another. Multi-owner hits are overlapping showers.
- **Pile-up:** in-time PU particles appear only when matched, or as ancestors of matched particles. `isSignal`
  separates them. Out-of-time PU is absent by default (gap 5), and dropped by the `hgcal` profile where present.

### 6–11. Smaller gaps, briefly

- **6:** for a TICL v5 / CLUE3D sample, `ticlTrackstersCLUE3DHigh*Truth` would be produced but not exported. The fix
  is to read `truthGraphRecoLabelsPSet.tracksters` in `eventDisplayNano_cff.py` instead of hard-coding v6 labels.
- **7:** *measured* PU200, 1307 of 1910 candidates have a match. The rest include track-only candidates. Their tracks
  carry a `generalTracksToTruth` match, which evd could fall back on (no CMSSW change needed).
- **8:** evd's reco -> truth relations have at most one entry per object (*measured:* entries = matched objects in
  every relation). "Several truth matches" exists only in the truth -> reco direction (`FromTruth`).
- **9, 11:** associators/data exist; export only.
- **10:** `sameRows` drops the legacy table and raises an error if SoA and legacy ever differ
  (`evdtools/nano.py:241-249`). Truth for SoA tracksters is then lost unless the entry is removed. A direct SoA
  associator (`TruthAssociationTraits` on the SoA view) would remove the dependency.

### Covered only by legacy simulation objects today

Layer-cluster <-> truth (gap 1) and runner-up particles per object (gap 8, partly) currently exist only in the
SimCluster/CaloParticle associations of HGCalNanoAOD (`DPGAnalysis/HGCalNanoAOD/python/hgcalTracksters_cfi.py:166,183`).
The `hgcal.json` profile excludes those (`"exclude": ["Sim*", "Reco*2Sim*", "ticlSim*", ...]`), and should keep doing
so.

## Track association weights are hit counts

The track associator (`AllRecoToTruthBranchAssociatorsProducer.cc:858-877`) is hit-based: its payload is a number of
shared hits, and its score is 1 − shared hits / track hits (measured: exact for every track of the 0PU sample).
The exporter writes the count under the calorimeter names (`generalTracksToTruth.sharedEnergy`,
`generalTracksFromTruth.sharedFraction`, integers 1–33). The viewer names them "shared hits" from the relations'
`match.measure`. The maps have no threshold: CMS tracking validation calls a track with < 75% shared hits a fake
(*measured*, PU200: 11% of matched tracks are below 75%), which is why truth mode colours a track by its particle
only from 75%. **Check:** the exporter names the column by the associator's metric.

## What the bundles carry for truth, and what the viewer does not use

*Measured* (zlib per event; 0PU 50 events, PU200 events 0–2, in-time cut applied): truth is 0.41 of 1.58 MB at 0PU
(26%) and 13.6 of 31.0 MB at PU200 (44%): particles 5.2 MB (102k rows), truth hit relations 4.3 MB, TruthToReco 2.6 MB,
vertices 1.0 MB. What no profile, converter or viewer code uses (the Inspector lists every column, so nothing is
invisible), PU200:

| what | MB / event | note |
|---|---|---|
| `TruthParticles` pt, eta, phi, mass, t | 1.5 | derivable from the momentum and the vertex |
| `TruthParticles` x, y, z | 0.56 | the production vertex's position (used for drawing; could be read through `truthProdVertex`) |
| legacy truth hits (`TruthHGCalHits`) | 2.1 | duplicate the SoA truth hits when SoA exists (legacy hits start hidden) |
| TruthToReco entries with `sharedFraction` < 0.1 | ≈ 1.6 (62% of 2.6) | 56 particles per interpretation trackster |
| particles with neither HGCal hits nor matches | ≈ 3.5 (estimate) | 73k of 108k rows: CaloBoundary particles in the barrel and forward, kept for barrel truth hits that are not exported yet |

None of these is dropped yet: each is a choice to make when the bundle is split into parts. The leaner direction is
to export what truth display needs (per-particle direct hits, a total simulated energy per hit, barrel hits) and drop
what it does not.

## What to watch for in CMSSW

1. `grep -n "reco::CaloCluster>" SimGeneral/TruthGraphAssociatorProducers/plugins/*.cc` finds a traits
   specialisation, and `truthGraphRecoLabelsPSet` has a layer-cluster domain (gap 1).
2. `TruthHitTableProducer` has a non-CaloBoundary mode, or a per-hit total sim energy column (gaps 2, 3).
3. `keepMatchedBy` includes tracks, or there is a "keep every particle with HGCal hits above E" option (gap 4).
4. `pileupBunchCrossings` widened, or an OOT summary per hit (gap 5).
5. Done: the exporter reads its label list from `truthGraphAssociationLabels_cff` (gap 6).
