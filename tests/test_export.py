"""From a reconstruction file to NanoAOD: telling the kinds of file apart, what a file records of how it was made,
the cmsDriver command line, and running it (with a stand-in for cmsDriver.py)."""

import io
import json
import os
import subprocess

import numpy as np
import pytest
import uproot

from evdtools import Problem, export

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


def test_the_cmsdriver_command_line(tmp_path):
    command = export.cmsdriver(
        ["step3.root", "root://eoscms.cern.ch//store/relval/x.root"],
        10,
        "D110",
        "Phase2C17I13M9",
        "auto:phase2_realistic_T33",
        threads=2,
    )
    assert command == [
        "cmsDriver.py",
        "evd",
        "-s",
        "NANO:@EVD",
        "--mc",
        "--filein",
        f"file:{os.path.abspath('step3.root')},root://eoscms.cern.ch//store/relval/x.root",
        "--fileout",
        "file:evd_nano.root",
        "--eventcontent",
        "NANOAODSIM",
        "--datatier",
        "NANOAODSIM",
        "-n",
        "10",
        "--geometry",
        "ExtendedRun4D110",
        "--era",
        "Phase2C17I13M9",
        "--conditions",
        "auto:phase2_realistic_T33",
        "--nThreads",
        "2",
        "--python_filename",
        "evd_nano_cfg.py",
    ]
    assert export.cmsdriver(["a.root"], None, "D110", "E", "C")[13:15] == ["-n", "-1"]  # every event


def release(monkeypatch, matches, known=None, tags=("T_file",)):
    """Stand in for the file's provenance and for what the release says of its Run4 geometries."""
    known = {"ExtendedRun4D110": {"era": "Phase2C17I13M9", "conditions": "auto:T33"}} if known is None else known
    monkeypatch.setenv("CMSSW_BASE", "/somewhere")
    monkeypatch.setattr(export, "provenance", lambda path: (list(tags), [("a.xml",)]))
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **k: subprocess.CompletedProcess(
            a, 0, stdout=json.dumps({"known": known, "matches": matches}), stderr=""
        ),
    )


def test_settings_come_from_the_file_and_the_release_unless_given(monkeypatch):
    release(monkeypatch, ["ExtendedRun4D110"])
    log = io.StringIO()
    assert export.settings("f.root", log=log) == ("ExtendedRun4D110", "Phase2C17I13M9", "T_file")
    assert "from the file's geometry files" in log.getvalue() and "the file's global tag" in log.getvalue()
    assert export.settings("f.root", era="E", conditions="C", log=log) == ("ExtendedRun4D110", "E", "C")
    release(monkeypatch, ["ExtendedRun4D110"], tags=("T_sim", "T_reco"))  # two global tags: which made the reco?
    assert export.settings("f.root", log=log)[2] == "auto:T33" and "the file names T_sim, T_reco" in log.getvalue()


def test_settings_that_cannot_be_found_are_asked_for(monkeypatch):
    release(monkeypatch, [])
    with pytest.raises(Problem, match="give --geometry"):
        export.settings("f.root", log=io.StringIO())
    release(monkeypatch, ["ExtendedRun4D110", "ExtendedRun4D114"])
    with pytest.raises(Problem, match="matches ExtendedRun4D110 and ExtendedRun4D114"):
        export.settings("f.root", log=io.StringIO())
    release(monkeypatch, [], known={}, tags=())
    with pytest.raises(Problem, match="give --era and --conditions"):
        export.settings("f.root", geometry="D200", log=io.StringIO())
    assert export.settings("f.root", "D200", "E", "C") == ("ExtendedRun4D200", "E", "C")  # all given: nothing looked up


DRIVER = """#!/bin/bash
echo "cmsDriver $@"
[ "$FAKE_DRIVER_FAILS" = 1 ] && { echo "Exception: Impossible to map EVD from {...}"; exit 1; }
[ "$FAKE_DRIVER_FAILS" = other ] && { echo "An exception of category ProductNotFound occurred"; exit 8; }
out=""; while [ $# -gt 0 ]; do [ "$1" = "--fileout" ] && out=${2#file:}; shift; done
echo nano > "$out"
"""


@pytest.fixture
def driver(tmp_path, monkeypatch):
    tools = tmp_path / "bin"
    tools.mkdir()
    (tools / "cmsDriver.py").write_text(DRIVER)
    os.chmod(tools / "cmsDriver.py", 0o755)
    monkeypatch.setenv("PATH", f"{tools}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("CMSSW_BASE", "/somewhere")
    work = tmp_path / "work"
    work.mkdir()
    return str(work)


def test_export_runs_cmsdriver_in_the_work_directory_and_returns_the_nanoaod(driver):
    log = io.StringIO()
    nano = export.export(["step3.root"], driver, 5, "D110", "E", "C", log=log)
    assert nano == os.path.join(driver, "evd_nano.root") and open(nano).read() == "nano\n"
    assert "running cmsDriver.py evd -s NANO:@EVD" in log.getvalue()
    assert "-n 5 --geometry ExtendedRun4D110 --era E --conditions C" in open(os.path.join(driver, "cmsRun.log")).read()


def test_export_needs_a_cmssw_environment(driver, monkeypatch):
    monkeypatch.delenv("CMSSW_BASE")
    with pytest.raises(Problem, match="cmsenv"):
        export.export(["step3.root"], driver, 5, "D110", "E", "C", log=io.StringIO())


def test_a_cmssw_area_is_set_up_in_a_clean_environment(monkeypatch):
    monkeypatch.setenv("PYTHONPATH", "/lcg/python")
    prefix, env = export._environment("/areas/CMSSW_20_1_0")
    assert prefix[:2] == ["bash", "-c"] and "cd /areas/CMSSW_20_1_0 && eval $(scram runtime -sh)" in prefix[2]
    assert "PYTHONPATH" not in env and env["PATH"] == "/usr/bin:/bin"


def test_a_release_without_the_flavour_gets_the_hint_and_not_the_whole_job_output(driver, monkeypatch):
    monkeypatch.setenv("FAKE_DRIVER_FAILS", "1")
    with pytest.raises(Problem) as e:
        export.export(["step3.root"], driver, 5, "D110", "E", "C", log=io.StringIO())
    assert "DPGAnalysis/EventDisplayNanoAOD" in str(e.value) and "Impossible to map" not in str(e.value)
    assert len(str(e.value)) < 500


def test_another_failure_keeps_the_job_output_where_it_survives(driver, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_DRIVER_FAILS", "other")
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    import tempfile

    monkeypatch.setattr(tempfile, "tempdir", None)
    with pytest.raises(Problem) as e:
        export.export(["step3.root"], driver, 5, "D110", "E", "C", log=io.StringIO())
    kept = [f for f in os.listdir(tmp_path) if f.startswith("evd-cmsRun-")]
    assert len(kept) == 1 and kept[0] in str(e.value) and "ProductNotFound" in open(tmp_path / kept[0]).read()
    assert "exit code 8" in str(e.value) and "ProductNotFound" in str(e.value)
