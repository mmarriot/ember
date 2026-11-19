"""From a reconstruction file to NanoAOD: telling the kinds of file apart, what a file records of how it was made, the
settings of the job (Phase 2 and Run 3), the configuration ember writes from what the release and the input have, and
running it (with stand-ins for edmPluginDump, cmsRun and cmsDriver.py)."""

import ast
import io
import json
import os
import subprocess
from pathlib import Path

import numpy as np
import pytest
import uproot

from embertools import Problem, cmsrun, export

pytest.importorskip("awkward")  # writes the input files


def root_file(path, branches, tree="Events"):
    # mktree: a TTree, as CMSSW writes; recent uproot (5.7.7 in CI) writes f[tree] = {...} as an RNTuple
    with uproot.recreate(str(path)) as f:
        f.mktree(tree, {b: np.int64 for b in branches})
        f[tree].extend({b: np.arange(3) for b in branches})
    return str(path)


def test_a_file_is_nanoaod_or_a_reconstruction_file_or_refused(tmp_path):
    assert export.describe(root_file(tmp_path / "nano.root", ["run", "luminosityBlock", "event", "nHit"])) == (
        "nano",
        3,
        None,
    )
    assert export.describe(root_file(tmp_path / "reco.root", ["EventAuxiliary", "recoTracks_generalTracks__RECO"]))[
        :2
    ] == ("edm", 3)
    for path, message in (
        (str(tmp_path / "missing.root"), "no such file"),
        (root_file(tmp_path / "other.root", ["x"]), "neither NanoAOD"),
        (root_file(tmp_path / "trees.root", ["x"], tree="Other"), "no Events tree"),
    ):
        with pytest.raises(Problem, match=message):
            export.describe(path)
    (tmp_path / "text.root").write_text("not a ROOT file at all")
    with pytest.raises(Problem, match="cannot be read as a ROOT file"):
        export.describe(str(tmp_path / "text.root"))


# Parameter sets as an EDM file stores them (copied from a step3 file, shortened)
BLOBS = (
    b"connect=+Z(frontier://FrontierProd/CMS_CONDITIONS\x00);globaltag=+Z(200X_mcRun4_realistic_v1\x00);snapshotTime=+Z(\x00)"
    b"...connect=+Z(frontier://FrontierProd/CMS_CONDITIONS\x00);globaltag=+Z(\x00);snapshotTime=+Z(\x00)"
    b"...@module_type=+Z(XMLIdealGeometryESSource\x00);geomXMLFiles=+z({\x00Geometry/CMSCommonData/data/materials.xml\x00,"
    b"Geometry/CMSCommonData/data/rotations.xml\x00,Geometry/HGCalCommonData/data/hgcal/v18/hgcal.xml\x00});rootNodeName=+Z(cms:OCMS\x00)"
    b"...globaltag=+Z(200X_mcRun4_realistic_v1\x00);"
)


def test_the_global_tag_and_the_geometry_files_are_read_from_the_stored_parameter_sets():
    tags, xml = export._stored_settings(BLOBS)
    assert tags == ["200X_mcRun4_realistic_v1"]  # once, and not the empty one
    assert xml == [
        (
            "Geometry/CMSCommonData/data/materials.xml",
            "Geometry/CMSCommonData/data/rotations.xml",
            "Geometry/HGCalCommonData/data/hgcal/v18/hgcal.xml",
        )
    ]
    assert export._stored_settings(b"nothing of the kind") == ([], [])
    assert export.provenance("/no/such/file.root") == ([], [])


def test_geometry_names_are_completed():
    assert [export.geometry_name(g) for g in ("D110", "Run4D110", "ExtendedRun4D110", "DB:Extended")] == [
        "ExtendedRun4D110"
    ] * 3 + ["DB:Extended"]


SIMULATION = cmsrun.Inventory([cmsrun.Product("recoGenParticles", "genParticles", "", "HLT")])
DATA = cmsrun.Inventory([])


def release(
    monkeypatch, matches, known=None, tags=("T_file",), xml=(("a.xml",),), run3=("Run3", "Run3_2025"), run=None
):
    """Stand in for the file's provenance, for what the release says of its geometries and eras, and for the run."""
    known = {"ExtendedRun4D110": {"era": "Phase2C17I13M9", "conditions": "auto:T33"}} if known is None else known
    monkeypatch.setenv("CMSSW_BASE", "/somewhere")
    monkeypatch.setattr(export, "provenance", lambda path: (list(tags), [tuple(x) for x in xml]))
    monkeypatch.setattr(export, "first_run", lambda *a: run)
    out = {"known": known, "matches": matches, "run3": list(run3)}
    monkeypatch.setattr(
        subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout=json.dumps(out), stderr="")
    )


def test_phase2_settings_come_from_the_file_and_the_release_unless_given(monkeypatch):
    release(monkeypatch, ["ExtendedRun4D110"])
    log = io.StringIO()
    s = export.settings("f.root", log=log, inv=SIMULATION)
    assert s == cmsrun.Settings(True, False, "Phase2C17I13M9", "ExtendedRun4D110", "T_file")
    assert "from the file's geometry files" in log.getvalue() and "the file's global tag" in log.getvalue()
    assert export.settings("f.root", era="E", conditions="C", log=log, inv=SIMULATION)[2:] == (
        "E",
        "ExtendedRun4D110",
        "C",
    )
    # two global tags: the newest release's made the reconstruction (the step after the simulation's)
    release(monkeypatch, ["ExtendedRun4D110"], tags=("201X_mcRun4_realistic_v1", "200X_mcRun4_realistic_v1"))
    assert export.settings("f.root", log=log, inv=SIMULATION).conditions == "201X_mcRun4_realistic_v1"
    assert "the newest of 201X_mcRun4_realistic_v1, 200X_mcRun4_realistic_v1" in log.getvalue()
    release(monkeypatch, ["ExtendedRun4D110"], tags=())  # none recorded: the release's default for the geometry
    assert export.settings("f.root", log=log, inv=SIMULATION).conditions == "auto:T33"


def test_phase2_settings_that_cannot_be_found_are_asked_for(monkeypatch):
    release(monkeypatch, [], known={})
    with pytest.raises(Problem, match="give --geometry"):
        export.settings("f.root", log=io.StringIO(), inv=SIMULATION)
    release(monkeypatch, ["ExtendedRun4D110", "ExtendedRun4D114"])
    with pytest.raises(Problem, match="matches ExtendedRun4D110 and ExtendedRun4D114"):
        export.settings("f.root", log=io.StringIO(), inv=SIMULATION)
    release(monkeypatch, [], known={}, tags=())
    with pytest.raises(Problem, match="give --era and --conditions"):
        export.settings("f.root", geometry="D200", log=io.StringIO(), inv=SIMULATION)
    # all given: nothing looked up
    assert export.settings("f.root", "D200", "E", "C", inv=SIMULATION) == (True, False, "E", "ExtendedRun4D200", "C")


def test_run3_data_takes_the_era_of_its_run_and_the_global_tag_of_its_reconstruction(monkeypatch):
    tags = ("161X_dataRun3_HLT_frozen_v1", "150X_dataRun3_Prompt_v1", "161X_dataRun3_Prompt_frozen_v1")
    release(monkeypatch, [], tags=tags, xml=(), run=392294)
    log = io.StringIO()
    assert export.settings("f.root", log=log, inv=DATA) == (
        False,
        True,
        "Run3_2025",
        "",
        "161X_dataRun3_Prompt_frozen_v1",
    )
    assert "era Run3_2025 (from run 392294" in log.getvalue()
    release(monkeypatch, [], tags=tags, xml=(), run=401234)  # after the last run of a known year: a warning
    assert export.settings("f.root", log=log, inv=DATA).era == "Run3_2025" and "--era Run3_2026" in log.getvalue()
    release(monkeypatch, [], tags=tags, xml=(), run=360000)
    assert export.settings("f.root", log=log, inv=DATA).era == "Run3"  # 2022
    release(monkeypatch, [], tags=tags, xml=(), run=300000)
    with pytest.raises(Problem, match="before Run 3"):
        export.settings("f.root", log=log, inv=DATA)
    release(monkeypatch, [], tags=tags, xml=(), run=380000, run3=("Run3",))  # a release without Run3_2024
    with pytest.raises(Problem, match="give --era"):
        export.settings("f.root", log=log, inv=DATA)


def test_run3_simulation_takes_the_era_of_its_global_tag(monkeypatch):
    release(monkeypatch, [], tags=("150X_mcRun3_2025_realistic_v1",), xml=())
    assert export.settings("f.root", log=io.StringIO(), inv=SIMULATION) == (
        False, False, "Run3_2025", "", "150X_mcRun3_2025_realistic_v1",
    )  # fmt: skip
    release(monkeypatch, [], tags=(), xml=())
    with pytest.raises(Problem, match="records no global tag; give --conditions"):
        export.settings("f.root", log=io.StringIO(), inv=SIMULATION)


def test_the_release_plugins_and_the_input_products_are_read():
    dump = (
        "Category CMS EDM Framework ESModule:\n  SomeESProducer\n   /lib/a.so\n"
        "Category CMS EDM Framework Module:\n  RecHitFlatTableProducer\n   /lib/b.so\n  PFRecHitFlatTableProducer\n"
        "   /lib/b.so\nCategory CMS EDM Framework Service:\n  Timing\n   /lib/c.so\n"
    )
    assert cmsrun.module_plugins(dump) == {"RecHitFlatTableProducer", "PFRecHitFlatTableProducer"}
    inv = cmsrun.Inventory(
        cmsrun.products(
            [
                "EventAuxiliary",
                "ticlTracksters_ticlTrackstersCLUE3DHigh__RECO.",
                "ticlTracksters_hltTiclTrackstersCLUE3DHigh__HLT.",
                "ticlTracksters_ticlTracksterLinks__RECO.",
                "recoPFRecHits_particleFlowRecHitECAL_Cleaned_RECO.",
                "128falseHGCalSoARecHitsLayoutPortableHostCollection_hgcalSoARecHitsEE__RECO.",
            ]
        )
    )
    assert inv.modules("ticlTracksters") == ["ticlTrackstersCLUE3DHigh", "ticlTracksterLinks"]  # not the HLT's
    assert inv.has("particleFlowRecHitECAL", "Cleaned") and not inv.has("particleFlowRecHitECAL")
    assert inv.soa() == ["hgcalSoARecHitsEE"]


# What a stock Phase-2 step3 holds of what the configuration reads (labels as in its edmDumpEventContent)
PHASE2 = [
    "HGCRecHits_HGCalRecHit_HGCEERecHits_RECO.",
    "ticlTracksters_ticlTrackstersCLUE3DHigh__RECO.",
    "ticlTracksters_ticlTrackstersCLUEstering__RECO.",
    "recoPFRecHits_particleFlowRecHitECAL__RECO.",
    "recoPFRecHits_particleFlowRecHitHBHE__RECO.",
    "HFRecHitsSorted_hfreco__RECO.",
    "HORecHitsSorted_horeco__RECO.",
    "recoPFClusters_particleFlowClusterECAL__RECO.",
    "recoSuperClusters_particleFlowSuperClusterHGCal__RECO.",
    "recoCaloClusters_hgcalMergeLayerClusters__RECO.",
    "recoTracks_generalTracks__RECO.",
    "recoPFJets_ak4PFJetsPuppi__RECO.",
    "recoPFJets_ak4PFJetsCHS__RECO.",
    "recoPFMETs_pfMetPuppi__RECO.",
    "recoGsfElectrons_gedGsfElectrons__RECO.",
    "recoMuons_muons__RECO.",
    "recoVertexs_offlinePrimaryVertices__RECO.",
    "recoBeamSpot_offlineBeamSpot__RECO.",
    "recoGenParticles_genParticles__HLT.",
    "recoPFCandidates_particleFlow__RECO.",
    "floatedmValueMap_puppi__RECO.",
    "floatedmValueMap_tofPID_t0_RECO.",
    "recoGsfTracks_electronGsfTracks__RECO.",
    "TrackingRecHitsOwned_generalTracks__RECO.",
    "TrackingRecHitsOwned_electronGsfTracks__RECO.",
    "recoPFTaus_hpsPFTauProducer__RECO.",
    "recoGsfElectrons_ecalDrivenGsfElectronsHGC__RECO.",
    "recoPhotons_gedPhotons__RECO.",
    "recoSuperClusters_particleFlowSuperClusterECAL_particleFlowSuperClusterECALBarrel_RECO.",
    "recoVertexs_inclusiveSecondaryVertices__RECO.",
    "DTChamberIdDTRecSegment4DedmIdToHitRange_dt4DSegments__RECO.",
    "CSCDetIdCSCSegmentedmIdToHitRange_cscSegments__RECO.",
    "GEMDetIdGEMSegmentedmIdToHitRange_gemSegments__RECO.",
    "GEMDetIdGEMRecHitedmIdToHitRange_gemRecHits__RECO.",
    "RPCDetIdRPCRecHitedmIdToHitRange_rpcRecHits__RECO.",
]
# Run 3 data RECO: PF rechits kept only cleaned away, preshower clusters, no HGCal
RUN3 = [
    "recoPFRecHits_particleFlowRecHitECAL_Cleaned_reRECO.",
    "EcalRecHitsSorted_ecalRecHit_EcalRecHitsEB_reRECO.",
    "EcalRecHitsSorted_ecalPreshowerRecHit_EcalRecHitsES_reRECO.",
    "HBHERecHitsSorted_hbhereco__reRECO.",
    "HFRecHitsSorted_hfreco__reRECO.",
    "HORecHitsSorted_horeco__reRECO.",
    "recoPFClusters_particleFlowClusterECAL__reRECO.",
    "recoPFClusters_particleFlowClusterPS__reRECO.",
    "recoSuperClusters_particleFlowSuperClusterECAL_particleFlowSuperClusterECALBarrel_reRECO.",
    "recoTracks_generalTracks__reRECO.",
    "recoPFJets_ak4PFJetsCHS__reRECO.",
]
RELEASE = {
    "RecHitFlatTableProducer", "PFRecHitFlatTableProducer", "TracksterCollectionTableProducer",
    "TICLCandidateTableProducer", "TICLCandidateExtraTableProducer", "LayerClustersCollectionTableProducer",
    "SimpleSuperclusterFlatTableProducer", "SimplePFJetFlatTableProducer", "SimpleTrackFlatTableProducer", "SimpleMETFlatTableProducer",
    "SimpleCandidateFlatTableProducer", "SimpleVertexFlatTableProducer", "SimpleBeamspotFlatTableProducer",
    "SimplePFCandidateFlatTableProducer", "SimpleGsfTrackFlatTableProducer", "SimplePFTauCandidateFlatTableProducer",
    "DTSegmentFlatTableProducer", "CSCSegmentFlatTableProducer", "GEMSegmentFlatTableProducer",
    "GEMRecHitFlatTableProducer", "RPCRecHitFlatTableProducer",
}  # fmt: skip


def configuration(settings, branches, release=RELEASE):
    text, notes = cmsrun.config(
        settings, ["file:/in/step3.root"], 5, cmsrun.Inventory(cmsrun.products(branches)), release
    )
    ast.parse(text)  # valid Python
    return text, notes


def test_the_phase2_configuration_has_what_the_input_and_the_release_have():
    s = cmsrun.Settings(True, False, "Phase2C22I13M9", "ExtendedRun4D104", "auto:phase2_realistic_T35")
    text, notes = configuration(s, PHASE2)
    assert 'cms.Process("EMBER", Phase2C22I13M9)' in text and "GeometryExtendedRun4D104Reco_cff" in text
    assert "PhysicsTools.TruthInfo.recHitTable_cfi" in text and "TICLGeom_cff" in text
    assert (
        "HGCalNanoAOD_cff" in text and 'table("ticlTrackstersCLUEsteringTracksterTable"' in text
    )  # a TICL v6 collection
    assert '"particleFlowRecHitHF"' in text and "Reconstruction_cff" in text  # HF and HO are not in this input
    assert 'src=cms.InputTag("ak4PFJetsPuppi")' in text and "maxEvents.input = 5" in text
    assert "SuperClusterHGCal" in text and "PFClusterECAL" in text and "PFClusterPS" not in text
    assert "ClusterHitsTableProducer" not in text.split("# Left out")[1].split("import")[1]  # only in the notes
    assert any("hits of clusters" in n for n in notes) and "#   - the hits of clusters" in text

    text, notes = configuration(s, PHASE2, RELEASE | cmsrun.CLUSTER_HITS)
    branches = [
        n for n in notes if "or every table at once with git cms-merge-topic mmarriot:nanoaod-reco-tables-all" in n
    ]
    assert [n for n in notes if n not in branches] == [
        "truth: the input has no truth graph (truthLogicalGraphProducer)"
    ]
    assert 'cms.EDProducer("CaloClusterHitsTableProducer",\n    src=cms.InputTag("hgcalMergeLayerClusters")' in text
    assert 'hitsName=cms.string("PFClusterECALHits")' in text


def test_the_whole_detector_is_written_from_what_the_release_and_the_input_have():
    s = cmsrun.Settings(True, False, "Phase2C22I13M9", "ExtendedRun4D104", "auto:phase2_realistic_T35")
    text, notes = configuration(s, PHASE2)
    # PF candidates with their PUPPI weight and the rows of what they were made from (references' keys)
    pf = text.split('name=cms.string("PFCandidates")')[1].split("table(")[0]
    assert 'puppiWeight=ExtVar("puppi"' in pf and 'endX=Var("?positionAtECALEntrance().R() > 0' in pf
    for column in ("trackIdx", "gsfTrackIdx", "muonIdx", "electronIdx", "photonIdx"):
        assert f"{column}=ref(" in pf
    assert "def ref(r, doc, lazy=False):" in text
    # objects are uncut, so that index columns address their rows; CHS jets next to the Puppi ones; taus
    assert 'cut=cms.string("pt' not in text
    assert 'src=cms.InputTag("ak4PFJetsCHS"), name=cms.string("JetCHS")' in text
    assert 'name=cms.string("Tau")' in text and "leadCandIdx=ref(" in text
    # electrons and photons point at the barrel PF superclusters (their parents), HGCal ones at their own; tracks
    electron = text.split('name=cms.string("Electron")')[1].split("table(")[0]
    assert "superClusterEBIdx=" in electron and "superClusterEEIdx" not in electron  # no ECAL endcap in Phase 2
    assert "gsfTrackIdx=ref(" in electron and "trackIdx=ref(" in electron
    assert "superClusterIdx=" in text.split('name=cms.string("ElectronHGC")')[1].split("table(")[0]
    assert 'trackIdx=ref("innerTrack()"' in text.split('name=cms.string("Muon")')[1]
    # every primary vertex with its time, GSF tracks, the tracks' time, the muon system with global positions
    assert 'name=cms.string("PV")' in text and "maxLen" not in text and 't=Var("t"' in text
    assert 'name=cms.string("GsfTrack")' in text and 'ExtVar("tofPID:t0"' in text
    for name in ("DTSegment", "CSCSegment", "GEMSegment", "GEMRecHit", "RPCRecHit"):
        assert f'name="{name}"' in text
    assert "globalDirVariables" in text and 'x=GlobGeomVar("x()"' in text
    # an input without them, or a release without the producers: left out, with a note for the release
    text, notes = configuration(s, [b for b in PHASE2 if "puppi" not in b and "Gsf" not in b and "tofPID" not in b])
    assert "puppiWeight" not in text and "gsfTrackIdx" not in text and "tofPID" not in text
    text, notes = configuration(s, PHASE2, RELEASE - {"SimplePFCandidateFlatTableProducer"})
    assert "PFCandidates" not in text and "leadCandIdx" not in text
    assert "this release has no SimplePFCandidateFlatTableProducer" in notes
    # with PAT, the PF candidates point at no physics object (the PAT ones are in another order)
    text, _ = cmsrun.config(s, ["file:/in.root"], 5, cmsrun.Inventory(cmsrun.products(PHASE2)), RELEASE, pat=True)
    assert "PFCandidates" in text and "trackIdx=ref(" in text and "muonIdx" not in text and "electronIdx" not in text


# What the CMSSW branches' producers read, in a stock Phase-2 step3
FULL = [
    "EcalRecHitsSorted_ecalRecHit_EcalRecHitsEB_RECO.",
    "HBHERecHitsSorted_hbhereco__RECO.",
    "recoPFCandidates_pfTICL__RECO.",
    "recoTracks_standAloneMuons_UpdatedAtVtx_RECO.",
    "recoTracks_globalMuons__RECO.",
    "FTLRecHitsSorted_mtdRecHits_FTLBarrel_RECO.",
    "FTLRecHitsSorted_mtdRecHits_FTLEndcap_RECO.",
    "DTLayerIdDTRecHit1DPairedmIdToHitRange_dt1DRecHits__RECO.",
    "CSCDetIdCSCRecHit2DedmIdToHitRange_csc2DRecHits__RECO.",
    "JetTagsAssociation_pfDeepCSVJetTags_probb_RECO.",
    "JetTagsAssociation_pfDeepCSVJetTags_probbb_RECO.",
    "JetTagsAssociation_pfJetProbabilityBJetTags__RECO.",
    "recoPFClusters_particleFlowClusterHCAL__RECO.",
    "TrackingRecHitsOwned_standAloneMuons__RECO.",
    "recoTracks_standAloneMuons__RECO.",
    "TrackingRecHitsOwned_globalMuons__RECO.",
    "recoPFBlocks_particleFlowBlock__RECO.",
]


def test_each_cmssw_branch_s_producers_are_used_once_the_release_has_them():
    s = cmsrun.Settings(True, False, "Phase2C22I13M9", "ExtendedRun4D104", "auto:phase2_realistic_T35")
    plugins = set().union(*cmsrun.BRANCHES.values())
    text, notes = configuration(s, PHASE2 + FULL, RELEASE | plugins)
    assert not [n for n in notes if "cms-merge-topic" in n and "cluster" not in n and "truth" not in n]
    # every rechit instead of the PF rechits, with their truth tables keyed by DetId when the truth is written
    assert 'cms.EDProducer("EcalRecHitTableProducer", src=cms.InputTag("ecalRecHit", "EcalRecHitsEB")' in text
    assert 'name=cms.string("RecHitHBHE")' in text and "pfRecHitTable" not in text and "RecHitEE" not in text
    # the hits of the general, GSF and muon tracks, and the muons' rows of their muon tracks
    for name in ("GeneralTrack", "GsfTrack", "StandaloneMuonTrack", "GlobalMuonTrack"):
        assert f'name=cms.string("{name}"), hitsName=cms.string("{name}Hits")' in text
    assert 'globalTrackIdx=ref("globalTrack()"' in text and "standaloneTrackIdx=ref(" not in text
    # the standalone track's row comes from the branch's producer, given both collections an outer track can be in
    assert 'cms.EDProducer("MuonTrackLinkTableProducer"' in text and 'name=cms.string("standaloneTrackIdx")' in text
    assert 'src=cms.InputTag("standAloneMuons"),' in text
    assert 'src=cms.InputTag("standAloneMuons:UpdatedAtVtx")' in text
    # vertices' tracks; the PF candidates' links come from the branch's producer (not from references' keys)
    assert 'name=cms.string("PVTracks")' in text and 'name=cms.string("SVTracks")' in text
    pf = text.split('name=cms.string("PFCandidates"), doc')[1].split("table(")[0]
    assert "trackIdx=ref(" not in pf and "muonIdx=ref(" not in pf and "electronIdx=ref(" in pf
    assert 'ticlCandidates=cms.InputTag("pfTICL")' in text and 'name=cms.string("PFCandidateClustersECAL")' in text
    # jet and tau constituents, CHS b-tags, MTD rechits, the muon system's rechits, chambers and segment matches
    for name in ("JetPFCands", "JetCHSPFCands", "TauPFCands", "RecHitBTL", "RecHitETL", "DTRecHit", "CSCRecHit"):
        assert f'name=cms.string("{name}")' in text or f'name="{name}"' in text
    assert "JetTagTableProducer" in text
    assert "btagDeepCSVB=cms.PSet(src=cms.VInputTag('pfDeepCSVJetTags:probb', 'pfDeepCSVJetTags:probbb')" in text
    assert 'name=cms.string("MuonChamber")' in text and 'name=cms.string("MuonDTSegments")' in text
    assert 'chamberDetId=DetIdVar("chamberId().rawId()"' in text
    # an AOD keeps the segments but not the DT and CSC rechits: the chambers and the muons' segments are still written,
    # and the chamber producer is told which collections there are not
    aod = [b for b in PHASE2 + FULL if "dt1DRecHits" not in b and "csc2DRecHits" not in b]
    text, _ = configuration(s, aod, RELEASE | plugins)
    assert "DTRecHitFlatTableProducer" not in text and 'name=cms.string("MuonChamber")' in text
    assert 'dtRecHitSrc=cms.InputTag("none")' in text and 'dtSegmentSrc=cms.InputTag("dt4DSegments")' in text
    assert 'name=cms.string("MuonDTSegments")' in text
    # an AOD: no hits of tracks, no PF blocks for the PF candidates' clusters
    aod = [b for b in PHASE2 + FULL if "TrackingRecHitsOwned" not in b and "particleFlowBlock" not in b]
    text, notes = configuration(s, aod, RELEASE | plugins)
    assert "TrackHitsTableProducer" not in text and "PFCandidateClustersECAL" not in text
    assert any("the input does not keep them (AOD)" in n for n in notes)
    # without them: the release's tables, and a note per branch naming it and the branch of all of them
    text, notes = configuration(s, PHASE2 + FULL, RELEASE)
    for branch in set(cmsrun.BRANCHES) - {cmsrun.MUON_TRACK_LINKS}:  # that one only with the muon tracks' table
        assert any(f"git cms-merge-topic mmarriot:{branch}, or every table at once" in n for n in notes), branch
    _, notes = configuration(s, PHASE2 + FULL, RELEASE | plugins - cmsrun.BRANCHES[cmsrun.MUON_TRACK_LINKS])
    assert any(f"mmarriot:{cmsrun.MUON_TRACK_LINKS}, or every table" in n for n in notes)
    assert "pfRecHitTable" in text and "trackIdx=ref(" in text and "StandaloneMuonTrack" not in text


def test_the_run3_configuration_remakes_the_pf_rechits_and_has_no_hgcal():
    s = cmsrun.Settings(False, True, "Run3_2025", "", "161X_dataRun3_Prompt_frozen_v1")
    text, notes = configuration(s, RUN3)
    assert "GeometryRecoDB_cff" in text and "TICLGeom" not in text and "recHitTable" not in text
    assert '"particleFlowRecHitPS"' in text and "Reconstruction_Data_cff" in text
    assert "['ECAL', 'HBHE', 'HF', 'HO', 'PS']" in text  # every kind remade: the input keeps only the cleaned ones
    assert "PFClusterPS" in text and "SuperClusterEB" in text and 'InputTag("ak4PFJetsCHS")' in text
    assert any("TICL" in n for n in notes) is False  # nothing to say about HGCal in Run 3
    text, notes = configuration(s, RUN3, RELEASE - {"PFRecHitFlatTableProducer"})
    assert "pfRecHitTable" not in text and "this release has no PFRecHitFlatTableProducer" in notes


FAKE = """#!/bin/bash
# stand-in for edmPluginDump, cmsRun and cmsDriver.py: $0 says which
case $(basename $0) in
  edmPluginDump) printf 'Category CMS EDM Framework Module:\\n  RecHitFlatTableProducer\\n   /lib/x.so\\n' ;;
  edmFileUtil) printf '  Run Lumi Events\\n  392294 1 10\\n' ;;
  cmsDriver.py) echo "cmsDriver $@"; echo "process = 1" > ember_cfg.py ;;
  cmsRun)
    echo "cmsRun $@"
    [ "$FAKE_CMSRUN_FAILS" = 1 ] && { echo "An exception of category ProductNotFound occurred"; exit 8; }
    echo nano > ember_nano.root ;;
esac
"""


@pytest.fixture
def tools(tmp_path, monkeypatch):
    """Stand-ins for the CMSSW commands, a work folder, and a reconstruction file (Phase 2, settings given)."""
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    for name in ("edmPluginDump", "edmFileUtil", "cmsDriver.py", "cmsRun"):
        (bin_ / name).write_text(FAKE)
        os.chmod(bin_ / name, 0o755)
    monkeypatch.setenv("PATH", f"{bin_}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("CMSSW_BASE", "/somewhere")
    work = tmp_path / "work"
    work.mkdir()
    step3 = root_file(tmp_path / "step3.root", ["EventAuxiliary", "HGCRecHits_HGCalRecHit_HGCEERecHits_RECO."])
    return str(work), step3


def test_export_writes_the_configuration_runs_it_in_the_work_directory_and_returns_the_nanoaod(tools, tmp_path):
    work, step3 = tools
    log = io.StringIO()
    kept = str(tmp_path / "mine_cfg.py")
    nano = export.export([step3], work, 5, "D110", "E", "C", log=log, config=kept)
    assert nano == os.path.join(work, "ember_nano.root") and Path(nano).read_text() == "nano\n"
    text = Path(work, "ember_cfg.py").read_text()
    assert text == Path(kept).read_text() and "recHitTable_cfi" in text and "maxEvents.input = 5" in text
    assert f'"file:{step3}"' in text and "GeometryExtendedRun4D110Reco_cff" in text
    assert "left out: this release has no TracksterCollectionTableProducer" not in log.getvalue()  # no tracksters here
    assert "left out: this release has no PFRecHitFlatTableProducer" in log.getvalue()
    assert "running cmsRun ember_cfg.py (kept as" in log.getvalue()
    assert Path(work, "cmsRun.log").read_text() == "cmsRun ember_cfg.py\n"


def test_a_miniaod_file_gets_standard_nanoaod(tools, tmp_path):
    work, _ = tools
    mini = root_file(
        tmp_path / "mini.root",
        ["EventAuxiliary", "patPackedCandidates_packedPFCandidates__PAT.", "edmTriggerResults_TriggerResults__HLT.",
         "edmTriggerResults_TriggerResults__reHLT."],
    )  # fmt: skip
    log = io.StringIO()
    export.export([mini], work, 5, era="Run3_2025", conditions="C", geometry="DB", log=log)
    assert "MiniAOD: standard NanoAOD" in log.getvalue()
    driver = Path(work, "cmsDriver.log").read_text()
    assert "-s NANO --data" in driver and "--era Run3_2025" in driver and "--no_exec" in driver
    # a RelVal that reran the trigger: its trigger objects have the filters of the rerun
    assert 'triggerResults = cms.InputTag("TriggerResults::reHLT")' in driver


def test_export_needs_a_cmssw_environment(tools, monkeypatch):
    work, step3 = tools
    monkeypatch.delenv("CMSSW_BASE")
    with pytest.raises(Problem, match="cmsenv"):
        export.export([step3], work, 5, "D110", "E", "C", log=io.StringIO())


def test_a_cmssw_area_is_set_up_in_a_clean_environment(monkeypatch):
    monkeypatch.setenv("PYTHONPATH", "/lcg/python")
    prefix, env = export._environment("/areas/CMSSW_20_1_0")
    assert prefix[:2] == ["bash", "-c"] and "cd /areas/CMSSW_20_1_0 && eval $(scram runtime -sh)" in prefix[2]
    assert "PYTHONPATH" not in env and env["PATH"] == "/usr/bin:/bin"


def test_a_failure_keeps_the_job_output_where_it_survives(tools, monkeypatch, tmp_path):
    work, step3 = tools
    monkeypatch.setenv("FAKE_CMSRUN_FAILS", "1")
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    import tempfile

    monkeypatch.setattr(tempfile, "tempdir", None)
    with pytest.raises(Problem) as e:
        export.export([step3], work, 5, "D110", "E", "C", log=io.StringIO())
    kept = sorted(f for f in os.listdir(tmp_path) if f.startswith("ember-cmsRun-"))
    log, cfg = kept  # the log, and the configuration beside it
    assert cfg == log[: -len(".log")] + "_cfg.py" and log in str(e.value) and cfg in str(e.value)
    assert "ProductNotFound" in (tmp_path / log).read_text() and "recHitTable_cfi" in (tmp_path / cfg).read_text()
    assert "exit code 8" in str(e.value) and "ProductNotFound" in str(e.value)


def test_products_the_release_cannot_read_are_dropped_on_input_with_nothing_else():
    s = cmsrun.Settings(True, False, "Phase2C22I13M9", "ExtendedRun4D104", "auto:phase2_realistic_T35")
    drop = cmsrun.products(["ticlInterpretationHypotheses_ticlTracksterInterpretations_hypotheses_RECO."])
    text, notes = cmsrun.config(s, ["file:/in.root"], 5, cmsrun.Inventory(cmsrun.products(PHASE2)), RELEASE, drop=drop)
    ast.parse(text)
    assert '"drop ticlInterpretationHypotheses_ticlTracksterInterpretations_hypotheses_RECO",' in text
    assert "dropDescendantsOfDroppedBranches = cms.untracked.bool(False)" in text  # PF and muons descend from TICL
    assert any("no dictionary" in n for n in notes)


def test_a_phase2_input_without_tracksters_still_gets_its_tracks_and_layer_clusters():
    s = cmsrun.Settings(True, False, "Phase2C22I13M9", "ExtendedRun4D104", "auto:phase2_realistic_T35")
    no_ticl = [b for b in PHASE2 if not b.startswith("ticlTracksters_")]
    text, notes = configuration(s, no_ticl, RELEASE | cmsrun.CLUSTER_HITS)
    assert "TICL tracksters and candidates: the input has none" in notes
    assert "ticlCandidateTable" not in text and "hgcalLayerClustersTable" in text  # HGCalNanoAOD for the clusters
    assert "process.emberTables.add(process.generalTracksTable)" in text  # its track table, scheduled
    no_hgcal = [b for b in no_ticl if "hgcalMergeLayerClusters" not in b]
    text, _ = configuration(s, no_hgcal, RELEASE)  # no HGCalNanoAOD at all: the track table made here
    assert "HGCalNanoAOD_cff" not in text and 'table("generalTracksTable", generalTracksTable.clone())' in text
    assert 'cms.EDProducer("CaloClusterHitsTableProducer"' not in text


def test_an_aod_without_the_rechits_to_remake_pf_rechits_gets_a_note():
    s = cmsrun.Settings(False, True, "Run3_2025", "", "161X_dataRun3_Prompt_frozen_v1")
    aod = [b for b in RUN3 if "RecHitsSorted" not in b]
    text, notes = configuration(s, aod)
    assert "pfRecHitTable" not in text and "Reconstruction_Data_cff" not in text
    assert any("PF rechits ECAL, HBHE, HF, HO, PS: the input has neither" in n for n in notes)


def test_a_broken_cmssw_environment_says_to_run_cmsenv(monkeypatch, tmp_path):
    monkeypatch.setenv("CMSSW_BASE", "/somewhere")
    monkeypatch.setenv("PATH", str(tmp_path))  # no edmPluginDump, no python3 of the release
    with pytest.raises(Problem, match="run cmsenv in this shell"):
        cmsrun.plugins()
    with pytest.raises(Problem, match="reading the release's geometries failed .* run cmsenv in this shell"):
        export._release_settings([], [], None)


def test_with_pat_ember_appends_its_tables_but_its_physics_objects_to_the_standard_configuration():
    s = cmsrun.Settings(True, False, "Phase2C22I13M9", "ExtendedRun4D104", "auto:phase2_realistic_T35")
    text, _ = cmsrun.config(
        s, ["file:/in.root"], 5, cmsrun.Inventory(cmsrun.products(PHASE2)), RELEASE | cmsrun.CLUSTER_HITS, pat=True
    )
    ast.parse("import FWCore.ParameterSet.Config as cms\nprocess = None\n" + text)
    assert 'cms.Process("EMBER"' not in text and "process.source =" not in text and "process.output =" not in text
    # the PF rechits it remakes (HF, HO here) come from the reconstruction's configuration without redefining PAT's
    assert 'reco.load("Configuration.StandardSequences.Reconstruction_cff")' in text
    assert 'process.load("Configuration.StandardSequences.Reconstruction' not in text
    assert "jetTable" not in text and "electronTable" not in text and "pvTable" not in text  # standard NanoAOD's
    assert 'name=cms.string("OfflineBeamSpot")' in text  # its BeamSpot table has no x and y
    assert "recHitTable_cfi" in text and "CaloClusterHitsTableProducer" in text and "pfRecHitTable" in text
    assert 'process.NANOAODSIMoutput.outputCommands.append("keep nanoaodFlatTable_*_*_EMBER")' in text
    assert "process.schedule.append(process.emberTablesPath)" in text
    data = cmsrun.Settings(False, True, "Run3_2025", "", "GT")
    text, _ = cmsrun.config(data, ["file:/in.root"], 5, cmsrun.Inventory(cmsrun.products(RUN3)), RELEASE, pat=True)
    assert "process.NANOAODoutput.outputCommands" in text


def test_export_with_pat_runs_cmsdriver_then_appends_the_tables(tools):
    work, step3 = tools
    log = io.StringIO()
    export.export([step3], work, 5, "D110", "E", "C", log=log, pat=True)
    driver = Path(work, "cmsDriver.log").read_text()
    assert (
        "-s PAT,NANO --data" in driver and "--processName EMBER" in driver and "--geometry ExtendedRun4D110" in driver
    )
    text = Path(work, "ember_cfg.py").read_text()
    assert text.startswith("process = 1\n") and "Ember's tables, after the PAT + standard NANO configuration" in text
    assert "recHitTable_cfi" in text and "--pat: PAT and standard NanoAOD" in log.getvalue()


TRUTH = {"TruthGraphFlatTableProducer", "TruthGraphHitFlatTableProducer"}
GRAPH = [
    "truthGraph_truthLogicalGraphProducer__HLT.",
    "truthLogicalGraphHitIndex_truthLogicalGraphHitIndexProducer__HLT.",
]


def test_the_release_truth_maps_are_read_only_for_an_input_with_the_graph(monkeypatch):
    calls = []

    def output(command, env, what, data=None):
        calls.append(command)
        return '{"truthGraphGeneralTracksToTruthTable": ["allTrackToTruthBranchAssociators", "generalTracksRecoToTruthAdaptiveNominal"]}'

    monkeypatch.setattr(export, "cmssw_output", output)
    assert export.truth_maps(cmsrun.Inventory(cmsrun.products(PHASE2))) == {} and not calls
    maps = export.truth_maps(cmsrun.Inventory(cmsrun.products(PHASE2 + GRAPH)), ("prefix",))
    assert maps == {
        "truthGraphGeneralTracksToTruthTable": ("allTrackToTruthBranchAssociators", "generalTracksRecoToTruthAdaptiveNominal")
    }  # fmt: skip
    assert calls[0][:2] == ["prefix", "python3"]


def test_the_truth_tables_are_written_when_the_release_and_the_input_have_them():
    s = cmsrun.Settings(True, False, "Phase2C22I13M9", "ExtendedRun4D104", "auto:phase2_realistic_T35")
    maps = {
        "truthGraphGeneralTracksToTruthTable": ("allTrackToTruthBranchAssociators", "generalTracksRecoToTruthAdaptiveNominal"),
        "truthGraphTiclCandidateToTruthTable": ("truthBranchTracksterAssociators", "ticlCandidateRecoToTruthAdaptiveNominal"),
        "truthGraphOfflinePrimaryVerticesToTruthTable": ("allVertexToTruthBranchAssociators", "offlinePrimaryVerticesRecoToTruthAdaptiveNominal"),
    }  # fmt: skip

    def truth(branches, release=RELEASE | TRUTH, **options):
        text, notes = cmsrun.config(
            s, ["file:/in.root"], 5, cmsrun.Inventory(cmsrun.products(branches)), release, truth_maps=maps, **options
        )
        ast.parse(text)
        return text, notes

    text, notes = truth(PHASE2)
    assert "truth: the input has no truth graph (truthLogicalGraphProducer)" in notes and "truthGraph" not in text
    text, notes = truth(PHASE2 + GRAPH, RELEASE)
    assert "truthGraph" not in text and any("mmarriot:truthgraph-nano-tables" in n for n in notes)
    header = text.replace("\n#     ", " ")  # the notes as one line each: the command is not split at a hyphen
    assert "git cms-merge-topic mmarriot:truthgraph-nano-tables" in header
    text, notes = truth(PHASE2 + GRAPH)
    assert "process.truthGraphTable = process.truthGraphCaloBoundaryTable.clone(" in text
    assert not [n for n in notes[1:] if "git cms-merge-topic mmarriot:nanoaod-" not in n]  # only other branches
    # with every primary vertex written, the vertex associations too, and the truth vertices they match
    assert "process.truthGraphTable = process.truthGraphCaloBoundaryTable.clone()" in text
    assert "'truthGraphOfflinePrimaryVerticesToTruthTable'," in text
    assert 'hitTable="recHitTable", hitIdColumn="rechit_ID", name="TruthHGCalRecHits"' in text
    assert 'hitTable="pfRecHitTable", hitIdColumn="rechit_ID", name="TruthPFRecHits"' in text
    assert "'truthGraphGeneralTracksToTruthTable'," in text and "truthGraphNanoAssociatorsTask" in text
    # with --pat, PV and SV are standard NanoAOD's (not the collections the vertex maps index): no vertex association
    text, _ = truth(PHASE2 + GRAPH, pat=True)
    assert "VerticesToTruthTable" not in text and "keepVerticesMatchedBy=[]" in text
    assert "'truthGraphGeneralTracksToTruthTable'," in text
    text, notes = truth(PHASE2 + GRAPH, associators=False)
    assert "truthGraphNanoAssociatorsTask" not in text and "ToTruthTable" not in text
    assert any("--no-truth-associators" in n for n in notes)
    # an input with maps of its own (a TICL v6 sample): the tables read them, no associator runs, and the tables it
    # has no map for are named
    stored = "ticlAssociationMap_allTrackToTruthBranchAssociators_generalTracksRecoToTruthAdaptiveNominal_RECO."
    text, notes = truth([*PHASE2, *GRAPH, stored])
    assert "'truthGraphGeneralTracksToTruthTable'," in text and "truthGraphNanoAssociatorsTask" not in text
    assert "'truthGraphTiclCandidateToTruthTable'" not in text  # named in a note only
    assert "keepVerticesMatchedBy=[]" in text and "Vertices" not in text.split("own: the tables read them")[1]
    assert any("TiclCandidateToTruth: the input's own maps do not have them" in n for n in notes)
    # a stored map of a class this release cannot read is dropped on input, so not read
    text, notes = cmsrun.config(
        s, ["file:/in.root"], 5, cmsrun.Inventory(cmsrun.products([*PHASE2, *GRAPH, stored])), RELEASE | TRUTH,
        truth_maps=maps, drop=cmsrun.products([stored]),
    )  # fmt: skip
    assert "truthGraphNanoAssociatorsTask" in text
    # a release whose truth tables name no association tables
    text, notes = cmsrun.config(
        s, ["file:/in.root"], 5, cmsrun.Inventory(cmsrun.products([*PHASE2, *GRAPH])), RELEASE | TRUTH, truth_maps={}
    )
    ast.parse(text)
    assert "truthGraphTable" in text and "ToTruthTable" not in text and "truthGraphNanoAssociatorsTask" not in text
    assert any("name no association tables" in n for n in notes)
    run3 = cmsrun.Settings(False, True, "Run3_2025", "", "GT")
    text, notes = configuration(run3, RUN3, RELEASE | TRUTH)  # data: no truth, and nothing to say about it
    assert "truthGraph" not in text and not any("truth" in n for n in notes)
