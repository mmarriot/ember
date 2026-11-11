# The truth graph in evd: what is used, and what is missing

"Truth" in evd means the CMSSW **truth graph** and nothing else: `truth::Graph` and its hit index
(`truth::LogicalGraphHitIndex`, PhysicsTools/TruthInfo), and the reco <-> truth associations of
SimGeneral/TruthGraphAssociatorProducers, as Fireworks/EventExport writes them to NanoAOD. CaloParticle, SimCluster
and SimTrackster are not used (the `hgcal` profile excludes their tables) and should not be.

This page says what the viewer shows from the truth graph, what it works out itself where the graph has no answer,
and what is missing, so each gap can be checked off as CMSSW adds it.

## What the viewer shows

| in the viewer | from |
|---|---|
| Truth graph · Particles, Vertices; the Truth tab (parent -> children) | `TruthParticles`, `TruthVertices`, `TruthParticleChildren` |
| a reco object's "best match", and its colour in the Truth particle mode | `<collection>ToTruth`: the AdaptiveNominal working point, one particle per reco object, with `sharedEnergy` and `score` (0 is best) |
| a truth particle's matched reco objects (Related, Matches) | `<collection>FromTruth` (TruthToReco), with `sharedFraction` and `score` |
| a hit's particle, "simulated energy in its hits, by particle" | `TruthHGCalHits`, `TruthSoAHits{EE,HSi,HSci}`: per (particle, hit) the simulated energy of the particle's subgraph |

**Worked out in evd** (stand-ins, to be replaced when CMSSW provides the information):

- **Layer cluster -> particle** (gap 1): the particle with the most simulated energy in the cluster's hits, each hit
  weighted by the cluster's fraction (`contentPartners` in `viewer/src/model/relations.ts`). Labelled "derived in
  evd" in the legend.
- **One colour per truth shower** (gap 2): a particle takes the colour of its highest ancestor that owns hits or is
  matched by a reco object (`identities` in the same file). So a π⁺ that interacted in the tracker and was matched as
  a whole has the colour of its daughters' hits, and a shower secondary matched to a trackster has the colour of the
  shower's hits. The inspector still names the particle actually matched.
- **Grey hits** mean no exported particle left energy in them: noise, or a particle that was not exported (gaps 3 to 5);
  the export cannot tell which.

## How truth reaches evd

Sources: CMSSW_20_1_0_pre5 with the truth-graph and EventExport developments; CMSSW paths are relative to `src/`
(SimDataFormats/TruthInfo as in the release). Numbers marked *measured* come from the bundles `gun3_0PU.evdb` (events
0 to 2) and `ttbar_pu200.evdb` (events 0 and 1), read with `evdtools.bundle`. Checked on 2026-11-10.

1. **Graph + hit index**, built at DIGI (`PhysicsTools/TruthInfo/python/truthGraphMixedDigi_cff.py`). The hit index
   holds, for every graph particle, its own calorimeter `PCaloHit` energy per DetId ("direct") and the
   descendant-inclusive set ("subgraph"). Calo channel = HGCal EE/HEF/HEB, ECAL barrel, HCAL
   (`SimDataFormats/TruthInfo/interface/LogicalGraphHitIndex.h:20-25`). Pile-up is in the graph for **in-time
   bunch crossings only** (`truthGraphMixedDigi_cff.py:49`, `pileupBunchCrossings=[0]`).
2. **Associators** (`SimGeneral/TruthGraphAssociatorProducers/python/truthGraphAssociators_cff.py`), scheduled
   by `customiseTruthGraphAssociators`. Each one writes a `RecoToTruth<WP>` map per working point (Fixed,
   AdaptiveTight, AdaptiveNominal) and one `TruthToReco` map. The reco types covered are listed in the
   `TruthAssociationTraits` specialisations (`plugins/AllRecoToTruthBranchAssociatorsProducer.cc:137-227`):
   `reco::Track`, `reco::Vertex`, `reco::PFCluster`, `ticl::Trackster`, `TICLCandidate`. **Not `reco::CaloCluster`.**
3. **EventExport** (`Fireworks/EventExport/plugins/TruthTableProducers.cc`, `python/eventExport_cff.py:101-142`)
   writes `TruthParticles`, `TruthVertices`, `TruthParticleChildren`, `<coll>ToTruth` (AdaptiveNominal),
   `<coll>FromTruth` (TruthToReco), and `TruthHGCalHits` / `TruthSoAHits{EE,HSi,HSci}` (particle -> hit, sim
   energy).
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
exists but EventExport does not export it; **E** = exported but evd does not read it, or reads it in a way that loses
information. Priority is for the event display.

| # | What is missing | Class | Where | Priority |
|---|---|---|---|---|
| 1 | **Layer cluster <-> truth association** | A | no `TruthAssociationTraits<reco::CaloCluster>`, no `layerClusters` domain in `truthGraphRecoLabelsPSet` (`truthGraphAssociationLabels_cff.py:37-54`), nothing in `truthGraphAssociatorsSequence` (cff `:190-199`), no LC validator in `Validation/TruthInfo` | high |
| 2 | Hits of the particle a reco object is matched to, when that particle is not the one entering the calorimeter | X | `TruthHitTableProducer` exports subgraph hits only for particles with `LevelFlag::CaloBoundary` (`TruthTableProducers.cc:398`, default `:435`) | high |
| 3 | Total simulated energy per hit (all particles), so a grey hit can be told apart as noise or as an un-exported particle | X (data in index, not exported) | `TruthTableProducers.cc:385-424` writes only (exported particle, hit) rows | high |
| 4 | Particles that deposit energy but are neither signal nor matched by a calorimeter object are not exported, so their hits stay unattributed | X | selection `TruthTableProducers.cc:105-130`; `keepMatchedBy` excludes tracks (`eventExport_cff.py:114-115`); pairs to un-exported particles dropped (`TruthTableProducers.cc:328-330`) | high at PU |
| 5 | Out-of-time pile-up has no particles at all | G | `truthGraphMixedDigi_cff.py:49` (`pileupBunchCrossings=[0]`) | medium |
| 6 | First-stage tracksters of a non-v6 (CLUE3D) reconstruction | X | the associator follows the scheduled labels (`truthGraphAssociationLabels_cff.py:170-189`), but EventExport hard-codes v6 labels (`eventExport_cff.py:105-112`); the profile has `clue3dLCs` but no CLUE3D truth relation (`hgcal.json:40-42`) | medium |
| 7 | Candidate truth is calorimeter-only; a track-only candidate has no candidate match | A (by design) | `RecoHitAdapters.h:148-161`, traits `AllRecoToTruthBranchAssociatorsProducer.cc:217-224` | medium |
| 8 | Runner-up matches per reco object (Fixed WP: every branch sharing energy) | X | only `RecoToTruthAdaptiveNominal` is exported (`eventExport_cff.py:119`) | low |
| 9 | Primary/secondary vertex truth, HLT tracksters/tracks/vertices | X | `allVertexToTruthBranchAssociators`, `hlt*Associators` exist (cff `:89-114`, `:167-184`), none exported | low |
| 10 | SoA objects are never associated directly | A | coverage only through legacy copies (`HGCalTrackstersFromSoAProducer` in `tracksterProducerTypes`, labels cff `:26-33`) plus evd `sameRows` | low (works while SoA == legacy) |
| 11 | Hit times of the sim hits | X | `LogicalGraphHitIndex::directHitTimes` (`LogicalGraphHitIndex.h:77-79,160-171`), not exported | low |

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
  Inspector's "simulated energy in its hits, by particle" (`truthInHits`, `viewer/src/ui/Inspector.tsx`) sums
  `simEnergy` over the object's hits without fractions. Neither knows the cell's total sim energy, and both inherit
  gaps 2 to 4.
- **Check:** a producer alias like `TruthBranchLayerClusterAssociatorsProducer` (or a `layerClusters` key in
  `truthGraphRecoLabelsPSet`) appears, and the step3 file has `*_truthBranchLayerClusterAssociators_*`. EventExport
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
photons). Consequence: the trackster's colour, taken from its best particle, can never agree with the hits' colour,
taken from the CaloBoundary ancestor. The ancestor's hits are still drawn, because `keepAncestors` exports it.

**Check:** `TruthHitTableProducer` gains a mode that exports hits for every exported particle with its own
(non-inclusive) direct hits, or for the association targets themselves. Today the only knob is `levelMask`.

### 3–5. Unattributed energy

*Measured.* Gun 0PU, CE-E: 99.5–100 % of the hit energy above 35 MeV has a truth particle. CE-H silicon: 18–78 %, and
the hits without truth are spread over both endcaps (η from −2.8 to +2.8, first CE-H layers), so they are noise.
ttbar PU200, event 0: CE-E 42 % (53k of 157k hits), CE-H Si 34 %, CE-H scintillator 73 %. 85k of the 140k SoA layer
clusters have no hit with truth. 7741 particles are exported (2156 signal); 2683 of them own CE-E hits (122 signal).

In PU200 the unattributed energy is noise, in-time pile-up that no calorimeter object matched (gap 4), and
out-of-time pile-up (gap 5). The export cannot tell these apart (gap 3). The per-cell total sim energy is computed
inside the associator (`BranchHitAssociator.h:187-188`, `cellTotalEnergy`) but never written out.
**Check:** a `simEnergyTotal` (or `hasSim`) column on the hit tables, or a `TruthHitTable` row for "all other
particles".

### Per-hit simulated energy: what it is, exactly

- **Per (exported CaloBoundary particle, hit)**, summed over the particle's subgraph (`TruthTableProducers.cc:401-415`,
  doc string `:422`). It is the `PCaloHit` deposited energy: sampling energy, not calibrated. Only ratios between
  particles are meaningful, not a comparison with the rechit energy.
- **Not** all particles: only exported ones (signal + matched + ancestors) that also have CaloBoundary.
- **Overlap:** a hit can have several owners. *Measured:* up to 4 owners at PU200, 20 multi-owner hits in a gun
  event. None of the sampled multi-owner hits had an owner that was an ancestor of another, so in this data the owners
  are disjoint branches. This is not guaranteed in general: nothing stops two nested particles from both carrying
  CaloBoundary.
- **Pile-up:** in-time PU particles appear only when matched, or as ancestors of matched particles. `isSignal`
  separates them. Out-of-time PU is absent (gap 5).

### 6–11. Smaller gaps, briefly

- **6:** for a TICL v5 / CLUE3D sample, `ticlTrackstersCLUE3DHigh*Truth` would be produced but not exported. The fix
  is to read `truthGraphRecoLabelsPSet.tracksters` in `eventExport_cff.py` instead of hard-coding v6 labels.
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

## What to watch for in CMSSW

1. `grep -n "reco::CaloCluster>" SimGeneral/TruthGraphAssociatorProducers/plugins/*.cc` finds a traits
   specialisation, and `truthGraphRecoLabelsPSet` has a layer-cluster domain (gap 1).
2. `TruthHitTableProducer` has a non-CaloBoundary mode, or a per-hit total sim energy column (gaps 2, 3).
3. `keepMatchedBy` includes tracks, or there is a "keep every particle with HGCal hits above E" option (gap 4).
4. `pileupBunchCrossings` widened, or an OOT summary per hit (gap 5).
5. EventExport reads its label list from `truthGraphAssociationLabels_cff` (gap 6).
