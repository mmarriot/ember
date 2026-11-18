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
    with uproot.recreate(str(path)) as f:
        f[tree] = {b: np.arange(3) for b in branches}
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
    release(monkeypatch, ["ExtendedRun4D110"], tags=("T_sim", "T_reco"))  # two global tags: which made the reco?
    assert export.settings("f.root", log=log, inv=SIMULATION).conditions == "auto:T33"
    assert "the file names T_sim, T_reco" in log.getvalue()


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
    release(monkeypatch, [], tags=("a", "b"), xml=())
    with pytest.raises(Problem, match="give --conditions"):
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
]
# Run 3 data RECO: PF rechits kept only cleaned away, preshower clusters, no HGCal
RUN3 = [
    "recoPFRecHits_particleFlowRecHitECAL_Cleaned_reRECO.",
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
    assert not notes and "#   (nothing)" in text
    assert 'cms.EDProducer("CaloClusterHitsTableProducer", src=cms.InputTag("hgcalMergeLayerClusters")' in text
    assert 'hitsName=cms.string("PFClusterECALHits")' in text


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
    kept = [f for f in os.listdir(tmp_path) if f.startswith("ember-cmsRun-")]
    assert len(kept) == 1 and kept[0] in str(e.value) and "ProductNotFound" in (tmp_path / kept[0]).read_text()
    assert "exit code 8" in str(e.value) and "ProductNotFound" in str(e.value)


def test_products_the_release_cannot_read_are_dropped_on_input_with_nothing_else():
    s = cmsrun.Settings(True, False, "Phase2C22I13M9", "ExtendedRun4D104", "auto:phase2_realistic_T35")
    drop = cmsrun.products(["ticlInterpretationHypotheses_ticlTracksterInterpretations_hypotheses_RECO."])
    text, notes = cmsrun.config(s, ["file:/in.root"], 5, cmsrun.Inventory(cmsrun.products(PHASE2)), RELEASE, drop=drop)
    ast.parse(text)
    assert '"drop ticlInterpretationHypotheses_ticlTracksterInterpretations_hypotheses_RECO",' in text
    assert "dropDescendantsOfDroppedBranches = cms.untracked.bool(False)" in text  # PF and muons descend from TICL
    assert any("no dictionary" in n for n in notes)
