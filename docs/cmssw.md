# CMSSW side: what `ember` runs

Ember reads NanoAOD. It gets it in one of two ways:

- **NanoAOD that CMS already makes** is read as it is, with no CMSSW job: standard NanoAOD (any `NANO` flavour, for
  example from MiniAOD), and the HGCal tables of `NANO:@HGCAL` (DPGAnalysis/HGCalNanoAOD).
- **For a reconstruction file** (RECO, FEVT, AOD) `ember` writes a cmsRun configuration of its own, `ember_cfg.py`,
  from modules that **your CMSSW release already has**, runs it, and converts its output. A MiniAOD gets standard
  NanoAOD instead (`cmsDriver.py -s NANO`).

Nothing has to be merged in CMSSW for this to work. The modules are CMSSW's own NanoAOD table producers, so the
output is plain NanoAOD, which you can read with uproot or ROOT like any other. Two CMSSW branches, not merged yet,
add generic table producers for what the release cannot write: the hits of each cluster, and the truth graph
([below](#the-cmssw-branches)). `ember` uses them when your release has them.

The code is `embertools/cmsrun.py` (the configuration) and `embertools/export.py` (the settings and the job). This
page describes them as tested with the integration build CMSSW_20_1_X_2026-11-17-2300.

## How `ember` writes the configuration

What goes in `ember_cfg.py` is decided from three things:

- **what your release has:** its module plugins, from `edmPluginDump -a` (0.1 s, so it is not cached);
- **what the input holds:** its products, from the branch names of its `Events` tree;
- **the era:** Phase 2 (HGCal, TICL, the ECAL barrel, HCAL) or Run 3 (also the ECAL endcap, the preshower and the
  HCAL endcap). The era, geometry and global tag are found from the file, or given with `--era`, `--geometry` and
  `--conditions` ([How-to](how-to.md#convert-a-step3-file-you-already-have)).

A table whose producer the release lacks, or whose collection the input lacks, is left out. The header of the
configuration lists each one, with the reason, and `ember` prints the same lines (`left out: ...`). Products of the
input whose class the release has no dictionary for (the SoA collections of a development release, for example) are
dropped on input, so that cmsRun can open the file. What was made from them stays.

`--config FILE.py` keeps the configuration. It is one readable Python file, with the input files, the number of
events and the settings written in it. `cmsRun FILE.py` runs it again in the same release, and
`ember convert ember_nano.root -o NAME.ember` converts its output. A failed job keeps it next to its log.

```python
# The NanoAOD that Ember reads, from a CMSSW reconstruction file, with modules of this release only.
# Written by embertools 0.2.0; keep it, change it, and run it again with: cmsRun ember_cfg.py
# Then: ember convert ember_nano.root -o NAME.ember
#
# Phase 2 simulation: era Phase2C22I13M9, geometry ExtendedRun4D104, conditions 201X_mcRun4_realistic_v1
# Left out (not in the input, or not in this release):
#   - the hits of clusters: this release has no CaloClusterHitsTableProducer, PFClusterHitsTableProducer,
#     SuperClusterHitsTableProducer (add them with git cms-merge-topic mmarriot:nanoaod-cluster-hits)
#   - this release has no TruthGraphFlatTableProducer, TruthGraphHitFlatTableProducer (add them with git
#     cms-merge-topic mmarriot:truthgraph-nano-tables)
import FWCore.ParameterSet.Config as cms

...
```

## What it writes

| part | tables | module (package) | era |
|---|---|---|---|
| HGCal hits | `rechits`: every rechit of CE-E and CE-H (silicon and scintillator) with its DetId, energy, time and position (its `rechit_radius` is left out by the profile: it is not a cell size) | `RecHitFlatTableProducer` (PhysicsTools/TruthInfo), positions from TICLGeom (RecoTICL/Geometry) | Phase 2 |
| ECAL and HCAL hits | `pfrechits`: the rechits above the particle-flow thresholds, with DetId, energy, time and position. The converter splits it into `EBHits`, `EEHits`, `ESHits`, `HBHits`, `HEHits`, `HOHits` and `HFHits`. | `PFRecHitFlatTableProducer` (PhysicsTools/TruthInfo), positions from CaloGeometry. When the input does not keep the PF rechits (Run 3 RECO keeps only those that cleaning removed), the reconstruction's own producers make them again in the job. | both |
| HGCal reconstruction | `HGCalLayerClusters`; one table per trackster collection of the input, named after it (for example `ticlTrackstersCLUE3DHigh`, `ticlTracksterLinks`, `ticlCandidate`), each with its list of layer clusters; `TICLCandidates`, with their tracksters and tracks | the tables that `NANO:@HGCAL` writes (DPGAnalysis/HGCalNanoAOD), with only the columns that are drawn | Phase 2 |
| PF clusters | `PFClusterECAL`, `PFClusterHCAL`, `PFClusterHF`, `PFClusterHO`, and `PFClusterPS` in Run 3 | `LayerClustersCollectionTableProducer` (DPGAnalysis/HGCalNanoAOD), a table of any `reco::CaloCluster` collection | both |
| Superclusters | `SuperClusterEB`; `SuperClusterEE` (Run 3); `SuperClusterHGCal` (Phase 2) | `SimpleSuperclusterFlatTableProducer` (PhysicsTools/NanoAOD) | both |
| The hits of each cluster | for each cluster table `X` above and `HGCalLayerClusters`: a count `nXHits` on `X`, and a table `XHits` of `detId` and `fraction`, one row per (cluster, hit) | `CaloClusterHitsTableProducer`, `PFClusterHitsTableProducer`, `SuperClusterHitsTableProducer`: the branch `nanoaod-cluster-hits` | both |
| Tracks | `GeneralTrack`: the general tracks, with their momentum, reference point and outermost hit (and, in Phase 2 with TICL candidates, their HGCal entry point; with MTD, their time at the beam line `t0`, from `tofPID`); `GsfTrack`: the electrons' GSF tracks | HGCalNanoAOD's track table (`hgcalGeneralTracks_cfi`); `SimpleGsfTrackFlatTableProducer` | both |
| Vertices | `PV`: every primary vertex (row 0 the leading one), with its time in Phase 2; `SV`: the inclusive secondary vertices | `SimpleVertexFlatTableProducer` | both |
| PF candidates | `PFCandidates` (`particleFlow`): momentum, type, vertex, ECAL entrance, energies, time, PUPPI weight (`puppi`), and the rows of their track, GSF track, muon, electron and photon (`trackIdx`, `gsfTrackIdx`, `muonIdx`, `electronIdx`, `photonIdx`) | `SimplePFCandidateFlatTableProducer`; the rows are the keys of the candidate's references (`trackRef().key()`), which point into the collections of those tables | both |
| Muon system | `DTSegment`, `CSCSegment`, `GEMSegment` (global position and direction), `GEMRecHit`, `RPCRecHit` (global position), each with its DetId and its fields | DPGAnalysis/MuonTools's table producers, with the global position configured | both |
| Physics objects | `Jet` (AK4 Puppi jets, or CHS jets where the file has no Puppi jets: uncorrected), `JetCHS` (the CHS jets, next to the Puppi ones), `Tau` (HPS: kinematics, decay mode, the row of the leading charged hadron in `PFCandidates`), `PuppiMET`, `PFMET`, `Electron`, `Photon`, `Muon`, `ElectronHGC` and `PhotonHGC` (the HGCal electrons and photons of Phase 2), `OfflineBeamSpot`. Uncut, so that index columns address their rows. Electrons and photons have the rows of their supercluster (`superClusterEBIdx`, `superClusterEEIdx`: the PF supercluster, `parentSuperCluster()`; `superClusterIdx` for HGCal), electrons of their track and GSF track, muons of their inner track. | PhysicsTools/NanoAOD's `Simple*FlatTableProducer`s on the RECO collections, with the names and columns that standard NanoAOD uses; the index columns from the references' keys (`lazyEval`, as the producer is that of `reco::Candidate`). With `--pat`: standard NanoAOD ([below](#physics-objects-and-pat)), without these index columns. | both |
| Truth | the truth graph tables ([below](#truth)) | the branch `truthgraph-nano-tables` | Phase 2 |

- The tables keep the order of the CMSSW collection they come from.
- The cluster-hit tables give each hit by its DetId. The converter finds the hit with that DetId in a hit table:
  the profiles have one relation per hit table, all built from the same cluster-hit table (for example the ECAL PF
  clusters' hits in `EBHits` and in `EEHits`). A hit below the PF thresholds is
  not in `pfrechits`, and its link is dropped.
- No table carries a cell size. The converter works it out from the DetId ([Profiles](profiles.md#derive-new-columns)).
- The float columns that `ember` configures keep only the mantissa bits they need, 6 to 14 of the 23, chosen per
  column: 14 for positions (about 0.3 mm at 5 m), 12 for cluster energies, η and φ, 10 for pT, times, axes and widths,
  8 for fractions, 6 for the jets' energy fractions. The TruthInfo hit tables have no precision option, and keep all
  23.
- The NanoAOD file is temporary, so it is written with LZ4, which is quick to write and to read back.

## Physics objects, and PAT

RECO has no jet energy corrections, jet IDs or b-tag tables that a NanoAOD table producer of the release can read.
So, by default, the physics objects come straight from the RECO collections: uncorrected jets with no IDs (b-tags with
the branch `nanoaod-jet-tags`), and HPS taus with their decay mode.
These tables cost under 1 ms per event.

`--pat` takes the physics objects from PAT and standard NanoAOD instead. `ember` writes the configuration of
`cmsDriver.py ember -s PAT,NANO --processName EMBER`, and appends its own tables of the hits, clusters, HGCal objects
and tracks to it, in the same output file. The bundle then has:

- corrected jets with their IDs and b-tags, and taus (`Tau`);
- `PV`, `SV` and MET with the columns of standard NanoAOD;
- one `Electron` and one `Photon` table, as standard NanoAOD has: no `ElectronHGC` or `PhotonHGC`.

It costs (Phase-2 ttbar, 10 events, 4 threads):

| | `ember`'s tables, whole job | PAT and NANO alone |
|---|---|---|
| time per event, no pile-up | 0.57 s | 0.85 s |
| time per event, 200 pile-up | 0.71 s | 2.25 s |
| time to start | 19 s | about 32 s |
| memory, 200 pile-up | 3.3 GB | 8.6 GB |

End to end with `--pat`, 5 events took 55 s and 5.5 GB on Phase-2 ttbar without pile-up, and 52 s and 3.5 GB on Run 3
RECO.

A MiniAOD always gets standard NanoAOD (`cmsDriver.py -s NANO`): it has no hits or clusters to add. With a MiniAOD or
`--pat`, when the file has a trigger that was run again (`reHLT`, in RelVals), the trigger objects are read from it.

## Truth

Truth in Ember is CMSSW's truth graph (`truth::Graph`, PhysicsTools/TruthInfo), its hit index, and the reco ↔ truth
associations of SimGeneral/TruthGraphAssociatorProducers, and nothing else. CaloParticles, SimClusters and
TrackingParticles are not used. [Truth graph](truth-graph.md) explains why, and what the graph still lacks.

**The tables.** The release has no NanoAOD tables of the truth graph. The branch `truthgraph-nano-tables` adds them.
When your release has them and the input holds the graph, `ember_cfg.py` writes:

- `TruthParticles`, `TruthVertices`, `TruthParticleChildren`: the signal interaction, the particles that reco objects
  are matched to, every particle that entered the calorimeter (so that each hit's simulated energy has its particle),
  and the ancestors of all of them; their production and end vertices; the parent → child links;
- `TruthHGCalRecHits` and `TruthPFRecHits`: the simulated energy that each of these particles and its descendants
  left in each hit of `rechits` and `pfrechits`, from the graph's hit index;
- `<Key>ToTruth` and `TruthTo<Key>`, with their `...Links` tables: the reco ↔ truth associations in both directions,
  for the collections that the release's label registry names: general tracks, the trackster collections, ECAL and
  HCAL PF clusters, and the primary and secondary vertices (`OfflinePrimaryVerticesToTruth`, ..., with the truth
  vertices they match kept). The vertex associations are written when the associators run in the job, not from an
  input's own maps.

The associations come from the maps the input holds, when it has them (the TICL v6 samples were made with the
associators), and no associator runs; the header names the tables whose maps the input lacks. Otherwise CMSSW's
associators run in the job. `--no-truth-associators` skips
them: the bundle then has the graph and the hit energies, but no reco ↔ truth matches.

**Which inputs have it.** The Phase-2 eras carry the process modifier `enableTruth`. With it, the DIGI step builds the
graph and its hit index, and `FEVTDEBUGHLT` and `RECOSIM` keep them. So a stock Phase-2 step3 file has them, with the
pile-up of the in-time bunch crossing only (the TICL v6 samples have all crossings; the profile keeps the in-time
one). AOD, MiniAOD, NanoAOD, premixed pile-up, FastSim and Run 3 files have no truth graph. For Phase-2 simulation
without it, the header of `ember_cfg.py` says so.

**What it costs**, on Phase-2 ttbar at 200 pile-up (3 events, 4 threads): the job takes 3.1 s per event with the
associators, 2.1 s without them (`--no-truth-associators`), and 0.7 s without truth. Summed over the threads, the
associators take 1.8 s per event for the tracks, 1.0 s for the tracksters and 0.25 s for the PF clusters (3 s of CPU
for 1 s of wall time, as they run beside the rest), and the truth tables 0.14 s; the rest is reading the stored graph
and hit index. The bundle is 17.0 MB per event instead of 5.9 (both with the cluster hits), and 14.0 MB without the
associators.
Without pile-up, a job of 10 events takes 29 s with truth and 28 s without.

## The CMSSW branches

All are generic NanoAOD table producers, useful for truth-graph studies, validation and ML training without Ember.
Add them to a CMSSW_20_1_X area with `git cms-merge-topic` ([How-to](how-to.md#get-every-table-the-cmssw-branches)).

| branch | what it adds | state |
|---|---|---|
| `mmarriot:nanoaod-cluster-hits` | PhysicsTools/NanoAOD: `CaloClusterHitsTableProducer`, `PFClusterHitsTableProducer`, `SuperClusterHitsTableProducer`. For any `reco::CaloCluster`, `reco::PFCluster` or `reco::SuperCluster` collection, a hit count on the cluster table, and a table of `detId` and `fraction` (from `hitsAndFractions()`). At 200 pile-up, the layer-cluster hits take 0.006 s per event. | pushed; the pull request to CMSSW is not open yet |
| `mmarriot:truthgraph-nano-tables` | PhysicsTools/TruthInfo and SimGeneral/TruthGraphAssociatorProducers: the truth graph tables above (`TruthGraphFlatTableProducer`, `TruthGraphHitFlatTableProducer`, `truthGraphNanoTables_cff`) | pushed; it builds on [cms-sw/cmssw#52451](https://github.com/cms-sw/cmssw/pull/52451) and contains its commits. Its pull request follows when #52451 is merged. |
| `mmarriot:nanoaod-calo-rechits` | every ECAL (EB, EE, ES) and HCAL (HBHE, HF, HO) rechit with the position of its cell: `RecHitEB`, ..., `RecHitHO` (`detId energy time x y z`; EE and ES not in Phase 2, where those collections are empty). They replace the PF rechits, and the cluster hits are found in them. The names are HcalNanoAOD's: `ember_cfg.py` does not also write HcalNanoAOD's tables, which would collide. | pushed |
| `mmarriot:nanoaod-track-hits` | the valid hits of any `reco::Track` collection of a RECO file (an AOD keeps none: left out, with a note): `n<T>Hits` on the track table `T`, and `<T>Hits` (`detId x y z layer`), for `GeneralTrack`, `GsfTrack`, and the standalone and global muon tracks (`StandaloneMuonTrack`, `GlobalMuonTrack`, written with their hits) | pushed |
| `mmarriot:nanoaod-vertex-tracks` | `PVTracks`, `SVTracks`: (vertex, track) pairs with the track's weight | pushed |
| `mmarriot:nanoaod-pfcandidate-links` | on `PFCandidates`: the rows of its track, GSF track, muon (checked against the collection each reference points into) and TICL candidate; `PFCandidateClusters<ECAL, HCAL, HF, HO, PS>`: (candidate, cluster) pairs from the PF blocks | pushed |
| `mmarriot:nanoaod-reco-constituents` | `JetPFCands`, `JetCHSPFCands` (`jetIdx`, `pfCandIdx`), `TauPFCands` (`tauIdx`, `pfCandIdx`) | pushed |
| `mmarriot:nanoaod-jet-tags` | the b-tags of the CHS jets as columns of `JetCHS` (`btagDeepCSVB`, `btagJP`; in RECO only the CHS jets have tags) | pushed |
| `mmarriot:nanoaod-muon-track-links` | on `Muon`: the row of its standalone track (`standaloneTrackIdx`), checked against the collection the reference points into (`standAloneMuons:UpdatedAtVtx`, or `standAloneMuons` when the update at the vertex failed: then -1) | pushed |
| `mmarriot:nanoaod-mtd-rechits` | `RecHitBTL`, `RecHitETL`: every MTD rechit with its time, time error, energy (MeV) and position, and its cell (`row`, `column`: an ETL DetId is the sensor's, so an ETL hit is its DetId with its cell) | pushed |
| `mmarriot:muontools-rechits-chambers` | DPGAnalysis/MuonTools: `DTRecHit`, `CSCRecHit` with global positions; `MuonChamber`, the chambers that hold a rechit or a segment (centre, axes, half sizes), which the rechits and segments find by DetId; `Muon<DT, CSC, GEM>Segments`, each muon's segments | pushed |
| `mmarriot:nanoaod-reco-tables-all` | all of the above together | pushed |

For each branch whose producers the release lacks, the configuration's header names the branch and the branch of all
of them. The table and column names above are those of the branches as pushed (reviewed, with their review fixes), and
`ember` reads them as they are. The pull request text of each branch is kept with the branches.

## What it costs

Measured with the integration build CMSSW_20_1_X_2026-11-17-2300, 4 threads, 10 events, without truth. Phase 2 is
ttbar with geometry `ExtendedRun4D104` and the stock reconstruction; Run 3 is JetMET 2025C RECO data, read from EOS.

| per event | Phase 2, no pile-up | Phase 2, 200 pile-up | Run 3 data |
|---|---|---|---|
| cmsRun: time to start (once per job) | 19 s | 20 s | 16 s |
| cmsRun: time per event | 0.57 s | 0.71 s | 0.24 s |
| NanoAOD | 0.69 MB | 7.7 MB | 0.79 MB |
| bundle | 0.40 MB | 5.4 MB | 0.21 MB |
| with the cluster hits and truth: bundle | 0.70 MB | 17.9 MB | (no truth) |

The PF candidates, CHS jets, taus, GSF tracks, every vertex and the muon system's tables (measured against the main
branch on the same events: 3 events at 200 pile-up, 10 otherwise) add 0.02 MB per event to the bundle without
pile-up, 0.46 MB at 200 pile-up (10k PF candidates) and 0.07 MB in Run 3. At 200 pile-up their modules take about
50 ms per event of the job's 0.7 s (TimeReport over 3 events: the PF candidate table 21 ms, which includes reading
`particleFlow` from the file, as the first module that asks for a product pays for its decompression; the HGCal
electrons 10 ms, whose index columns are evaluated by name for each object, `lazyEval`). Warm, a Run 3 job of 10
events takes 28 s against 27 s.

**With every branch** (`nanoaod-reco-tables-all`, cluster hits and truth included), on the stock ttbar files: the
bundle is 0.77 MB per event without pile-up and 19.7 MB at 200 pile-up (the RECO file itself: 8.0 and 177 MB). Their
largest additions at 200 pile-up, in the NanoAOD: the hits of the general tracks (1.15 MB), the MTD rechits (0.58 MB)
and the PF candidates (0.34 MB). Measured side by side on the same 3 events at 200 pile-up, 4 threads, on a loaded
machine: 5.4 s per event with every branch against 5.0 s with the cluster hits and truth only (8.7 → 11.0 s of
CPU, mostly reading more of the RECO file: track extras and hits, PF blocks, MTD hits). Most of either is the truth
associators (tracks 1.8 s, tracksters 1.0 s).

- The job start is most of the time for 10 events: loading the libraries, building the geometry and the conditions.
  Before it, `ember` takes a few seconds to find the settings and to check the input's classes.
- A RECO event at 200 pile-up is 177 MB on disk, but the job takes 0.7 s for it. The source reads a product from the
  file only when a module asks for it, so most of the event (truth, trigger, digis) is never read or decompressed.
- At 200 pile-up with the cluster hits, the largest tables are the HGCal rechits (4.7 MB per event, at full
  precision), the hits of the layer clusters (1.6 MB), the layer clusters (1.1 MB) and the tracks (0.44 MB).

To see where the time goes in a job, add `process.options.wantSummary = True` to the configuration (a TimeReport per
module at the end of the log), and run it with `cmsRun`.

## SoA collections

Offline reconstruction (`step3`, `FEVTDEBUGHLT`) of a stock release stores no SoA collections. SoA reaches a file only
from HLT or NGT outputs, or from samples made with extra keep rules (such as the TICL v6 development samples). The
release cannot write SoA collections as NanoAOD tables yet: that needs a generic SoA table producer, which waits for
[cms-sw/cmssw#52491](https://github.com/cms-sw/cmssw/pull/52491). So `ember_cfg.py` writes the legacy collections, and
lists the input's SoA collections as left out. Where a NanoAOD file has both, the converter writes one source per kind
of object ([Profiles](profiles.md#display-kinds-prefer-stages-layers)).

## Planned: every hit and every object

The goal is that the viewer shows all the hits and all the objects of an event. This is what `ember_cfg.py` does not
write yet with the release alone, and how each one is planned. Bundles made with Ember's earlier export (for example the ttbar data sets on
https://marriot-evd.web.cern.ch) have most of them, through tables that are no longer made.

| not written yet | planned route |
|---|---|
| what the branches above add | the branches, as cms-sw pull requests |
| SoA tables | the generic SoA table producer ([above](#soa-collections)) |
| exact HGCal cell outlines | see below |
| HGCal fine scintillator tiles (the v19 geometries: D120, D122, D123, D126–D128) | sized as 432 tiles around the ring from the DetId; still to check against every cell of such a geometry |

**HGCal cells as drawn today.** Each HGCal cell is drawn as a regular hexagon centred on the cell's position, with
its corners at the cell's half-width (the apothem for silicon, r·Δφ/2 for a scintillator tile). So:

- every cell has the same orientation. The real cell lattice is rotated by 30° from it in most layers, and the
  rotation changes from layer to layer;
- a cell is drawn slightly smaller than it is (its corners where its sides are), so neighbours never overlap;
- partial cells at the edge of a wafer are drawn whole, and scintillator tiles are drawn as hexagons.

Positions, energies and the hits that each object owns are exact; only the outline of each cell is approximate. The
plan: the converter takes each layer's lattice angle from the cell centres (rotation only, nothing in CMSSW), and
exact outlines come later with a CMSSW producer of the cells' corners.

Requests for what is still missing are welcome in the
[issue tracker](https://github.com/mmarriot/ember/issues).
