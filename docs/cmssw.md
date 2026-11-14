# CMSSW side: the `NANO:@EVD` flavour

evd reads NanoAOD. The CMSSW package `DPGAnalysis/EventDisplayNanoAOD` defines a NanoAOD *flavour*, `NANO:@EVD`. It
writes the reconstructed event as flat tables:

- hits, with their geometry;
- clusters, tracks, particle-flow objects and physics objects;
- the links between them;
- the truth graph.

Nothing in the package knows about the viewer. The output is plain NanoAOD, and you can read it with uproot or ROOT
like any other NanoAOD file.

> **Not merged yet.** The package is on two branches against CMSSW_20_1_X, which will become two pull requests:
> `eventdisplay-nano-generic` (the generic table producers) and, on top of it, `eventdisplay-nano` (the other
> producers and the flavour). Neither branch is pushed yet. Until the package is in a release, add it to a CMSSW area
> with `git cms-merge-topic mmarriot:eventdisplay-nano` and `scram b`
> ([Getting started](getting-started.md#what-you-need)). This page describes the branch as measured on
> CMSSW_20_1_X_2026-11-12-2300. The package's own `README.md` in CMSSW has the full lists of columns.

## Using it

**Inside a reconstruction job**, where everything the job makes is available:

```bash
cmsDriver.py step3 -s RAW2DIGI,RECO,RECOSIM,NANO:@EVD \
    --eventcontent FEVTDEBUGHLT,NANOAODSIM --datatier GEN-SIM-RECO,NANOAODSIM  ...your other options...
```

The job writes the NanoAOD next to the reconstruction output, as `<fileout stem>_inNANOAODSIM.root`.

**On a reconstruction file that already exists**, with `FEVTDEBUGHLT` content (what RelVal `GEN-SIM-RECO` files hold)
or `RECOSIM` content:

```bash
cmsDriver.py evd -s NANO:@EVD --conditions <as the file> --geometry <as the file> --era <as the file> --mc \
    --eventcontent NANOAODSIM --datatier NANOAODSIM -n -1 --filein file:step3.root --fileout file:evd_nano.root
```

`evd step3.root` runs this for you ([The `evd` command](cli.md#evd-view)).

**Scope today:** Phase-2 full simulation, on `FEVTDEBUGHLT` and `RECOSIM` content. A `RECOSIM` file gave the same
rows in all 97 tables as the `FEVTDEBUGHLT` file of the same 10 events. Run 3, FastSim, premixed pile-up, real data,
and `AODSIM` or MiniAOD inputs have not been tested.

**When an input is missing.** The flavour needs Phase-2 RECO-level content. It was tested in the reconstruction job,
and on `FEVTDEBUGHLT` and `RECOSIM` files.

- Most producers stop the job when their input is missing.
- The exceptions are the calorimeter hit tables and the cluster → hit tables. They skip a missing collection: the
  table keeps its columns, with the rows of the collections that are there.
- With truth (the `enableTruth` modifier of the Phase-2 eras), the input must hold the truth graph
  (`truthLogicalGraphProducer` and its hit index). Without it, CMSSW's associators stop the job.
- A reference into another collection than the configured one is an error. An index is never written into the wrong
  table.

## What it writes

About 100 tables on a stock release (97 on the ttbar sample measured here).

- Rows keep the order of the CMSSW collection they come from. So an index column (`trackIdx`, `clusterIdx`, ...) is
  the position in that collection.
- When an index is made from a reference, the producer checks it against the collection it must point into.
- Each column carries its description and unit in the file. See them with `Events->Print()` in ROOT, or in the branch
  titles in uproot.

| part | tables | what |
|---|---|---|
| Calorimeter hits | `HGCalHits`; `EcalHits`, `HBHEHits`, `HFHits`, `HOHits` | every rechit with its `detId`, energy, time and position. HGCal cells carry their `halfWidth`. Barrel and forward towers carry their `dEta`, `dPhi` and `thickness`, from the cell's corners. |
| HGCal / TICL | `HGCalLayerClusters`, `HGCalLayerClusterHits`; `ticlTrackstersCLUE3DHigh`, `ticlTracksterLinks`, `ticlTracksterLinksSuperclusteringDNN`, `ticlCandidate` (each with its `...vertices` list of layer clusters); `TICLCandidates` with their tracks and tracksters | layer clusters with their hits; every trackster collection that the release registers, with its layer clusters; TICL candidates. The TICL tables are reused from `DPGAnalysis/HGCalNanoAOD`. |
| Tracker and timing | `Tracks`, `TrackHits`; `Vertices`, `VertexTracks`; `BeamSpot`; `MTDHits`; (`GeneralTrack`, `GSFTrack`, `TrackMuonInfo` from HGCalNanoAOD) | general tracks with their hits in global coordinates, and their MTD time and position; primary vertices with their tracks and fit weights; BTL and ETL rechits |
| Particle flow | `PFCandidates`, `PFCandidateClusters{ECAL,HCAL,HF,HO}`; `PFClusters{ECAL,HCAL,HF,HO}`, `PFCluster{...}Hits`; `Jets`, `JetConstituents`; `PuppiMET`, `PFMET` | candidates with their track, GSF track, muon, TICL candidate and clusters; PF clusters with their hits; AK4 Puppi jets with their constituents; MET |
| Physics objects | `JetsCHS`, `JetsCHSConstituents`; `SecondaryVertices`, `SecondaryVertexTracks`; `Electrons`, `ElectronsHGC`, `Photons`, `PhotonsHGC`; `EGammaSuperClusters`, `HGCalEGammaSuperClusters` and their `...Hits`; `GsfTracks`, `GsfTrackHits`; `Taus`, `TauSignalCands` | CHS jets with the b-tags that RECO has; secondary vertices; electrons and photons of the barrel and of HGCal, with their supercluster, tracks and PF candidate; taus with their signal candidates |
| Muon system | `Muons`, `MuonTracks`, `MuonTrackHits`, `MuonSegments`, `MuonSegmentMatches`, `MuonChamberMatches`, `MuonHits`, `MuonChambers` | muons with their standalone and global tracks, and the segments and chambers they match; every segment and rechit; the chambers in use, as boxes |
| Truth graph | `TruthParticles`, `TruthVertices`, `TruthParticleChildren`; `Truth{HGCal,Ecal,HBHE,HF,HO,Muon}Hits`; `<collection>ToTruth` and `<collection>FromTruth` for tracks, vertices, secondary vertices, ECAL and HCAL PF clusters and every trackster collection | see [Truth](#truth) below |

### Truth

Truth is the CMSSW truth graph (`truth::Graph`, PhysicsTools/TruthInfo) and nothing else. CaloParticles, SimClusters
and TrackingParticles are not written. [Truth graph](truth-graph.md) explains why, and what the graph still lacks.

- The Phase-2 eras carry the process modifier `enableTruth`. With it, the graph and its hit index are built at the
  DIGI step and kept in `RECOSIM` and `FEVTDEBUGHLT`, and the flavour adds its truth tables. Without it, the flavour
  writes no truth tables at all. FastSim eras drop the modifier.
- `TruthParticles` holds the signal interaction, every particle that entered a calorimeter (pile-up included, so
  every hit with simulated energy has its particle), every particle that a reco object is matched to, and their
  ancestors. By CMSSW's default, the graph holds pile-up from the in-time bunch crossing only.
- `Truth...Hits`: for each particle that entered a calorimeter, the simulated energy that it and its descendants
  left in each hit (from the hit index). For muon hits, this is per simulation unit: DT wire, CSC layer, RPC roll,
  GEM partition.
- `...ToTruth` / `...FromTruth`: the reco ↔ truth association maps of SimGeneral/TruthGraphAssociatorProducers. There
  is one row per pair, with its shared energy (or hits, or pT² share) and score. No standard sequence runs these
  associators. The flavour holds them in a `cms.Task`, so they run only for the maps that a table reads. The list of
  collections follows the release's own registry (`truthGraphAssociationLabels_cff`), so a new trackster iteration
  appears without a change here.

## What it costs

Nothing, unless you ask for it: no standard workflow schedules any of it.

The numbers below were measured on ttbar at 14 TeV, geometry `ExtendedRun4D104`, CMSSW_20_1_X_2026-11-12-2300. The
flavour ran on a reconstruction file with 8 threads (20 events without pile-up, 10 at 200 pile-up). They are the
numbers of the package's `README.md`. Module times are the framework's real time per module and event, summed over
the modules of a kind.

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

At 200 pile-up, three quarters of the module time is CMSSW's own truth association (mostly for tracks and
tracksters). This package only schedules it. The largest tables are then `TruthParticles` (4.7 MB per event, 109k
rows), `HGCalHits` (3.3 MB, 487k rows), `HGCalLayerClusters` (2.0 MB) and `TruthHGCalHits` (2.0 MB).

Inside the reconstruction job (20 ttbar events without pile-up, 16 threads), the job took 63 s with the flavour and
65 s without it, with the same peak memory: no measurable change. The cost inside the job at 200 pile-up has not been
measured. The standalone numbers above are its upper bound per event.

Three choices keep the file small and the output fast. All three are in the flavour's customisation and
configuration.

- **Compression: ZSTD level 5**, instead of the LZMA of analysis NanoAOD. For the same content at 200 pile-up, per
  event in the output module:

  | algorithm | size | time |
  |---|---|---|
  | ZSTD level 5 | 21.5 MB | 0.57 s |
  | ZLIB level 4 | 21.9 MB | 0.78 s |
  | LZMA level 9 | 15.3 MB | 1.88 s |

  ZLIB and LZMA were measured before the tracker and MTD hits had reduced precision, which saves 1%. The NanoAOD file
  is an intermediate step (the bundle is what is kept), so speed was chosen over the last 30% of size.
- **Float precision.** The large tables keep 12 to 16 mantissa bits of their float columns: 14 for calorimeter and
  MTD hits and truth particles, 16 for tracker hits and truth vertices, 12 for fractions and scores. This is 0.15 mm
  at 2.5 m, and 15 µm at 1 m. The zeroed bits are what compresses: 24.4 MB per event at full precision, 21.5 MB with
  reduced precision. Each producer has a `precision` parameter (`-1`: keep all bits).
- **No columns that can be derived** on the hit tables: `eta` and `phi` follow from `x`, `y`, `z`.

To see where the time goes in your own job, add `process.options.wantSummary = True` (a TimeReport per module at the
end of the log), or use the `FastTimerService`.

## SoA collections

Collections in SoA form (`PortableHostCollection`) are not persistent. So a table made from one exists only when the
flavour runs **inside the job that makes the collection**. A step3 file never has them.

The package has a generic producer for them, `SoATableProducer<Collection>`. A new SoA collection needs one line: an
alias and its `DEFINE_FWK_MODULE`. Its columns take their names from the layout itself, in a release whose SoA
descriptors carry names ([cms-sw/cmssw#52491](https://github.com/cms-sw/cmssw/pull/52491)). Before that, they take
their names from a list in the configuration.

On a stock release the flavour schedules no SoA table, because the standard Phase-2 offline reconstruction makes no
SoA collection yet. The TICL v6 development branch adds its own SoA collections (HGCal SoA rechits, layer clusters,
tracksters) on top.

## Adding a collection

1. **Write a table.** If NanoAOD's `Simple<Type>FlatTableProducer` can describe it (plain columns from string
   expressions), configure one in `python/eventDisplayNano_cff.py`. If it needs geometry or links to other tables,
   write a producer in `plugins/` that puts a `nanoaod::FlatTable`:
   - rows in collection order;
   - a link as an index column, made with `nanotable::rowOf`. It checks that the reference points into the
     collection that the index is for;
   - a link to hits through the hit table's `detId` column (`nanotable::KeyRows`);
   - `skipNonExistingSrc` for inputs that a file may not have.
2. **Schedule it.** Add the module to the Task of its part of the detector in `eventDisplayNano_cff.py`. Module
   labels start with `evd` and end with `Table` (the output keeps `*Table*`).
3. **Check it.** `test/validate_export.py evd_nano.root` runs the consistency checks: indices in range, finite
   positions, link counts equal to the objects' counts. Add checks for the new table. The flavour's RelVal workflow,
   `runTheMatrix.py -w upgrade -l 29634.214` (`_EventDisplayNano`), must still pass.
4. **Draw it.** Add a `display` entry, and relations for its links, to an evd profile ([Profiles](profiles.md)). A
   table that no profile entry names is still converted, and listed in the viewer's Event tab.

## Not exported yet

- **Level-1 and HLT objects.**
- **Reco ↔ truth associations that CMSSW does not have:** jets, electrons and photons, muons, taus, MET, PF
  candidates, HF and HO PF clusters, and layer clusters. [cms-sw/cmssw#52451](https://github.com/cms-sw/cmssw/pull/52451)
  adds the last. evd does not put its own matching in their place. Each one appears when its associator exists
  ([Truth graph](truth-graph.md#gap-table)).
- **TICL candidate ↔ truth** on a stock release. CMSSW has no candidate associator. The association it writes under
  `ticlCandidateToTruth` is that of the candidates' own tracksters (table `ticlCandidate`). So the viewer shows the
  match on those tracksters ("Candidate tracksters"), and none on the candidates. The profile reads the table this way
  whenever the file has `ticlCandidate` (relation option `unless`, [Profiles](profiles.md#relations)).
- **Track → MTD rechit links** (a track carries its MTD hit's position and time), and **MTD hit truth**.
- **Tracker hits that are on no track.** RECO stores clusters, and only the hits on tracks are written.
- **SoA collections** on a stock release ([above](#soa-collections)).
- **Out-of-time pile-up truth:** it is not in the graph by default.
