# CMSSW side: the `NANO:@EVD` flavour

evd reads NanoAOD. The CMSSW package `DPGAnalysis/EventDisplayNanoAOD` defines a NanoAOD flavour, `NANO:@EVD`, that
writes the reconstructed event as flat tables: hits with their geometry, clusters, tracks, particle-flow and physics
objects, the links between them, and the truth graph. Nothing in it knows about the viewer: the file is plain NanoAOD
and can be read with uproot or ROOT like any other.

> **Not merged yet.** The package is two branches against CMSSW_20_1_X, to become two pull requests:
> `eventdisplay-nano-generic` (the generic table producers) and, on top of it, `eventdisplay-nano` (the other
> producers and the flavour). Neither is pushed yet. Until the package is in a release, a CMSSW area gets it with
> `git cms-merge-topic mmarriot:eventdisplay-nano` and `scram b` (see
> [Getting started](getting-started.md#what-you-need)). This page describes the branch as measured on
> CMSSW_20_1_X_2026-11-12-2300; the package's own `README.md` in CMSSW has the full column lists.

## Using it

Inside a reconstruction job (everything the job makes is at hand):

```bash
cmsDriver.py step3 -s RAW2DIGI,RECO,RECOSIM,NANO:@EVD \
    --eventcontent FEVTDEBUGHLT,NANOAODSIM --datatier GEN-SIM-RECO,NANOAODSIM  ...your other options...
```

The NanoAOD is written beside the reconstruction output, as `<fileout stem>_inNANOAODSIM.root`.

On a reconstruction file that exists (`FEVTDEBUGHLT` content, what RelVal `GEN-SIM-RECO` files hold, or `RECOSIM`):

```bash
cmsDriver.py evd -s NANO:@EVD --conditions <as the file> --geometry <as the file> --era <as the file> --mc \
    --eventcontent NANOAODSIM --datatier NANOAODSIM -n -1 --filein file:step3.root --fileout file:evd_nano.root
```

`evd step3.root` runs this for you ([the `evd` command](cli.md#evd-view)).

Scope today: **Phase-2 full simulation**, on `FEVTDEBUGHLT` and `RECOSIM` content (a `RECOSIM` file gave the same
rows in all 97 tables as the `FEVTDEBUGHLT` file of the same 10 events). Run 3, FastSim, premixed pile-up, real data
and `AODSIM` or MiniAOD inputs have not been tested.

**Input that is not there.** The flavour needs Phase-2 RECO-level content (tested in the reconstruction job, on
`FEVTDEBUGHLT` and on `RECOSIM` files); most producers stop the job when their input is missing. The exceptions are
the calorimeter hit and cluster → hit tables, which skip a missing collection (a table keeps its columns, with the
rows of the collections that are there). With truth (the `enableTruth` modifier of the Phase-2 eras), the input must
hold the truth graph (`truthLogicalGraphProducer` and its hit index): CMSSW's associators stop the job without it. A
reference into another collection than the configured one is an error: an index is never written into the wrong
table.

## What it writes

About 100 tables on a stock release (97 on the ttbar sample measured here). Rows keep the order of the CMSSW
collection they come from, so an index column (`trackIdx`, `clusterIdx`, ...) is the position in that collection,
and every index made from a reference is checked against the product it must point into when it is written. Each column carries its
description and unit in the file (`Events->Print()`, or the branch titles in uproot).

| part | tables | what |
|---|---|---|
| Calorimeter hits | `HGCalHits`; `EcalHits`, `HBHEHits`, `HFHits`, `HOHits` | every rechit with its `detId`, energy, time and position. HGCal cells carry their `halfWidth`; barrel and forward towers their `dEta`, `dPhi` and `thickness`, from the cell's corners |
| HGCal / TICL | `HGCalLayerClusters`, `HGCalLayerClusterHits`; `ticlTrackstersCLUE3DHigh`, `ticlTracksterLinks`, `ticlTracksterLinksSuperclusteringDNN`, `ticlCandidate` (each with its `...vertices` list of layer clusters); `TICLCandidates` with their tracks and tracksters | layer clusters with their hits; every trackster collection the release registers, with its layer clusters; TICL candidates. The TICL tables are those of `DPGAnalysis/HGCalNanoAOD`, reused |
| Tracker and timing | `Tracks`, `TrackHits`; `Vertices`, `VertexTracks`; `BeamSpot`; `MTDHits`; (`GeneralTrack`, `GSFTrack`, `TrackMuonInfo` from HGCalNanoAOD) | general tracks with their hits in global coordinates, MTD time and position; primary vertices with their tracks and fit weights; BTL and ETL rechits |
| Particle flow | `PFCandidates`, `PFCandidateClusters{ECAL,HCAL,HF,HO}`; `PFClusters{ECAL,HCAL,HF,HO}`, `PFCluster{...}Hits`; `Jets`, `JetConstituents`; `PuppiMET`, `PFMET` | candidates with their track, GSF track, muon, TICL candidate and clusters; PF clusters with their hits; AK4 Puppi jets with their constituents; MET |
| Physics objects | `JetsCHS`, `JetsCHSConstituents`; `SecondaryVertices`, `SecondaryVertexTracks`; `Electrons`, `ElectronsHGC`, `Photons`, `PhotonsHGC`; `EGammaSuperClusters`, `HGCalEGammaSuperClusters` and their `...Hits`; `GsfTracks`, `GsfTrackHits`; `Taus`, `TauSignalCands` | CHS jets with the b-tags RECO has; secondary vertices; electrons and photons of the barrel and of HGCal with their supercluster, tracks and PF candidate; taus with their signal candidates |
| Muon system | `Muons`, `MuonTracks`, `MuonTrackHits`, `MuonSegments`, `MuonSegmentMatches`, `MuonChamberMatches`, `MuonHits`, `MuonChambers` | muons with their standalone and global tracks, the segments and chambers they match, every segment and rechit, and the chambers in use as boxes |
| Truth graph | `TruthParticles`, `TruthVertices`, `TruthParticleChildren`; `Truth{HGCal,Ecal,HBHE,HF,HO,Muon}Hits`; `<collection>ToTruth` and `<collection>FromTruth` for tracks, vertices, secondary vertices, ECAL and HCAL PF clusters and every trackster collection | see below |

### Truth

Truth is the CMSSW truth graph (`truth::Graph`, PhysicsTools/TruthInfo) and nothing else; CaloParticles, SimClusters
and TrackingParticles are not written ([Truth graph](truth-graph.md) says why, and what the graph still lacks).

- The Phase-2 eras carry the process modifier `enableTruth`. With it, the graph and its hit index are built at the
  DIGI step and kept in `RECOSIM` and `FEVTDEBUGHLT`, and the flavour adds its truth tables. Without it (FastSim eras
  drop it) the flavour has no truth tables at all.
- `TruthParticles`: the signal interaction, every particle that entered a calorimeter (pile-up included, so every
  hit with simulated energy has its particle), every particle a reco object is matched to, and their ancestors.
  Pile-up is in the graph for the in-time bunch crossing only, by CMSSW's default.
- `Truth...Hits`: for each particle that entered a calorimeter, the simulated energy it and its descendants left in
  each hit (from the hit index); for muon hits, per simulation unit (DT wire, CSC layer, RPC roll, GEM partition).
- `...ToTruth` / `...FromTruth`: the reco ↔ truth association maps of SimGeneral/TruthGraphAssociatorProducers,
  one row per pair with its shared energy (or hits, or pT² share) and score. No standard sequence runs these
  associators: the flavour holds them in a `cms.Task`, so they run only for the maps a table reads. The collections
  follow the release's own registry (`truthGraphAssociationLabels_cff`), so a new trackster iteration appears
  without a change here.

## What it costs

Nothing unless it is asked for: no standard workflow schedules any of it.

Measured on ttbar at 14 TeV, geometry `ExtendedRun4D104`, CMSSW_20_1_X_2026-11-12-2300, the flavour run on a
reconstruction file with 8 threads (20 events without pile-up, 10 at 200 pile-up). The numbers are those of the
package's `README.md`; module times are the framework's real time per module and event, summed over the modules of a
kind.

| per event | no pile-up | 200 pile-up |
|---|---|---|
| NanoAOD size | 0.94 MB | 21.5 MB |
| event loop, real time | 0.3 to 0.4 s | 1.6 to 1.7 s |
| CMSSW's truth association producers | 35 ms | 3.6 s |
| the NanoAOD output module | 19 ms | 0.57 s |
| this package's table producers | 32 ms | 0.49 s |
| of which `HGCalHits` (a geometry lookup per hit, 0.3 µs each) | 18 ms | 0.16 s |
| the tables reused from `DPGAnalysis/HGCalNanoAOD` | 5 ms | 0.13 s |
| peak memory of the job | 3.9 GB | 11 to 12 GB |

At 200 pile-up three quarters of the module time is CMSSW's own truth association (tracks and tracksters mostly),
which this package only schedules. The largest tables there are `TruthParticles` (4.7 MB per event, 109k rows),
`HGCalHits` (3.3 MB, 487k rows), `HGCalLayerClusters` (2.0 MB) and `TruthHGCalHits` (2.0 MB).

Inside the reconstruction job (20 ttbar events without pile-up, 16 threads) the job took 63 s with the flavour and
65 s without, with the same peak memory: no measurable change. The in-job cost at 200 pile-up has not been measured;
the standalone numbers above are its upper bound per event.

Three choices keep the file small and the output fast, all in the flavour's customisation and configuration:

- **Compression: ZSTD level 5**, instead of the LZMA of analysis NanoAOD. Same content at 200 pile-up: ZSTD
  21.5 MB and 0.57 s per event in the output module; ZLIB level 4 21.9 MB and 0.78 s; LZMA level 9 15.3 MB and
  1.88 s (ZLIB and LZMA measured before tracker and MTD hits had reduced precision, which saves 1%). The file is an intermediate (the bundle is what is kept), so time was chosen over the last 30% of size.
- **Float precision.** The large tables keep 12 to 16 mantissa bits of their float columns (14 for calorimeter and
  MTD hits and truth particles, 16 for tracker hits and truth vertices, 12 for fractions and scores): 0.15 mm at
  2.5 m, 15 µm at 1 m. The zeroed bits are what compresses: 24.4 MB per event at full precision, 21.5 MB with it.
  Each producer has a `precision` parameter (`-1`: all bits).
- **No derivable columns** on the hit tables: `eta` and `phi` follow from `x`, `y`, `z`.

To see where the time goes in your own job: add `process.options.wantSummary = True` (the TimeReport per module at
the end of the log), or the `FastTimerService`.

## SoA collections

Collections in SoA form (`PortableHostCollection`) are not persistent, so a table made from one exists only when the
flavour runs **inside the job that makes the collection**; a step3 file never has them. The package has a generic
producer for them, `SoATableProducer<Collection>`: a new SoA collection needs one line (an alias and its
`DEFINE_FWK_MODULE`), and its columns take their names from the layout itself in a release whose SoA descriptors
carry names ([cms-sw/cmssw#52491](https://github.com/cms-sw/cmssw/pull/52491)), or from a list in the configuration before that.

On a stock release the flavour schedules no SoA table: the standard Phase-2 offline reconstruction makes no SoA
collection yet. The TICL v6 development branch adds its own (HGCal SoA rechits, layer clusters, tracksters) on top.

## Adding a collection

1. **A table.** If NanoAOD's `Simple<Type>FlatTableProducer` can describe it (plain columns from string
   expressions), configure one in `python/eventDisplayNano_cff.py`. If it needs geometry or links to other tables,
   write a producer in `plugins/` that puts a `nanoaod::FlatTable`: rows in collection order, a link as an index
   column made with `nanotable::rowOf` (it checks that the reference points into the collection the index is for), a
   link to hits through the hit table's `detId` column (`nanotable::KeyRows`), and `skipNonExistingSrc` for inputs a
   file may not have.
2. **Schedule it**: add the module to the Task of its part of the detector in `eventDisplayNano_cff.py`. Module
   labels start with `evd` and end with `Table` (the output keeps `*Table*`).
3. **Check it**: `test/validate_export.py evd_nano.root` runs the consistency checks (indices in range, positions
   finite, link counts equal to the objects' counts); add the new table's. The RelVal workflow of the flavour,
   `runTheMatrix.py -w upgrade -l 29634.214` (`_EventDisplayNano`), must still pass.
4. **Draw it**: a `display` entry, and relations for its links, in an evd profile ([Profiles](profiles.md)). A
   table no profile entry names is still converted and listed in the viewer's Event tab.

## Not exported yet

- **Level-1 and HLT objects.**
- **Reco ↔ truth associations that CMSSW does not have**: jets, electrons and photons, muons, taus, MET, PF
  candidates, HF and HO PF clusters, and layer clusters ([cms-sw/cmssw#52451](https://github.com/cms-sw/cmssw/pull/52451) adds the last). evd does not substitute
  its own matching for them; each appears when its associator exists ([Truth graph](truth-graph.md#gap-table)).
- **TICL candidate ↔ truth** on a stock release: CMSSW has no candidate associator. The association it writes under
  `ticlCandidateToTruth` is that of the candidates' own tracksters (table `ticlCandidate`), so the viewer shows the
  match on those tracksters ("Candidate tracksters") and none on the candidates. The profile reads the table that
  way whenever the file has `ticlCandidate` (relation option `unless`, [Profiles](profiles.md)).
- **Track → MTD rechit links** (a track carries its MTD hit's position and time), and **MTD hit truth**.
- **Tracker hits that are on no track** (RECO stores clusters; only the hits on tracks are written).
- **SoA collections** on a stock release (above).
- **Out-of-time pile-up truth**: not in the graph by default.
