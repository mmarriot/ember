"""Site sync: one bundle per input, skipping done / settling / failed files, the lock, and the index."""

import datetime
import json
import os
import time
from pathlib import Path

import numpy as np
import pytest

from embertools.bundle import BundleWriter
from embertools.service import sync


def fake_convert(events_per_file):
    """Stands in for nano.convert: writes a real bundle with the given number of events (0: empty)."""
    calls = []

    def convert(files, output, profile, max_events, data_time=None):
        calls.append(files[0])
        n = events_per_file.get(os.path.basename(files[0]), 1)
        if n < 0:
            raise RuntimeError("broken file")
        header = {
            "schema": "evd/1",
            "profile": profile,
            "tables": {"Hit": {"doc": "", "columns": {"e": {"type": "f32", "doc": ""}}}},
            "relations": {},
            "display": [],
            "source": {
                "files": files,
                "created": "2026-11-09T00:00:00+00:00",
                "data_time": data_time.isoformat(timespec="seconds"),
            },
        }
        with BundleWriter(output, header) as out:
            for i in range(n):
                out.add((1, 1, i), {"Hit": (1, {"e": np.ones(1, np.float32)})}, {})
        return n

    return convert, calls


def setup(tmp_path, names, age=3600):
    inputs = tmp_path / "eos"
    inputs.mkdir()
    for k, name in enumerate(names):
        (inputs / name).write_bytes(b"")
        t = time.time() - age + k  # later names are newer data
        os.utime(inputs / name, (t, t))
    return {
        "site": str(tmp_path / "site"),
        "state": str(tmp_path / "state"),
        "campaigns": [
            {
                "name": "mct",
                "title": "MCT",
                "profile": "mct",
                "inputs": str(inputs / "NANO_*.root"),
                "xrootd": "root://host/",
            }
        ],
    }


def index(config):
    return json.loads(Path(config["site"], "index.json").read_text())["bundles"]


def stale_lock(config):
    """The lock of a run that died hours ago."""
    lock = os.path.join(config["state"], "lock")
    os.makedirs(lock, exist_ok=True)
    old = time.time() - 4 * 3600
    os.utime(lock, (old, old))


def test_converts_new_files_once_and_lists_newest_first(tmp_path):
    config = setup(tmp_path, ["NANO_1.root", "NANO_2.root", "NANO_10.root", "NANO_3.root"])
    convert, calls = fake_convert({"NANO_3.root": 0})
    assert sync(config, convert=convert) == 4
    assert all(c.startswith("root://host/") for c in calls)  # read through XRootD
    files = [b["file"] for b in index(config)]
    assert files == ["data/mct/NANO_10.ember", "data/mct/NANO_2.ember", "data/mct/NANO_1.ember"]  # NANO_3 is empty
    assert index(config)[0]["title"] == "MCT · file 10 · 1 events"
    assert sync(config, convert=convert) == 0 and len(calls) == 4  # nothing converted twice


def test_waits_for_files_still_being_written_and_gives_up_on_broken_ones(tmp_path):
    config = setup(tmp_path, ["NANO_1.root"], age=60)  # modified a minute ago: may still be copied
    convert, calls = fake_convert({"NANO_1.root": -1})
    assert sync(config, convert=convert) == 0 and not calls
    config["settle"] = 0
    for _ in range(4):
        sync(config, convert=convert)
    assert len(calls) == 3  # max_failures
    assert json.loads(Path(config["state"], "failures.json").read_text()) == {"mct/NANO_1": 3}


def test_a_fresh_lock_blocks_and_a_stale_one_is_taken_over(tmp_path):
    config = setup(tmp_path, ["NANO_1.root"])
    convert, calls = fake_convert({})
    os.makedirs(os.path.join(config["state"], "lock"))
    assert sync(config, convert=convert) == 0 and not calls
    stale_lock(config)
    assert sync(config, max_files=1, convert=convert) == 1
    assert not os.path.exists(os.path.join(config["state"], "lock"))


def test_simulate_publishes_parts_newest_first(tmp_path):
    from embertools.service import simulate

    convert, _ = fake_convert({"NANO_1.root": 7})
    source = tmp_path / "source.ember"
    convert(["NANO_1.root"], str(source), "mct", None, data_time=datetime.datetime.now())
    naps = []
    assert simulate(str(source), str(tmp_path / "site"), events=3, interval=5, sleep=naps.append) == 3
    assert naps == [5, 5]  # no wait after the last part
    parts = json.loads((tmp_path / "site" / "index.json").read_text())["bundles"]
    assert [b["events"] for b in parts] == [1, 3, 3] and parts[0]["file"] == "data/live_demo/part_0003.ember"


def test_simulated_parts_carry_the_per_run_tables_and_run_info_of_their_runs(tmp_path):
    from embertools.bundle import Bundle, validate
    from embertools.service import simulate

    columns = {"e": {"type": "f32", "doc": ""}}
    tables = {"Hit": {"doc": "", "columns": columns}, "Channel": {"doc": "", "scope": "run", "columns": columns}}
    header = {
        "schema": "evd/1",
        "profile": "mct",
        "tables": tables,
        "relations": {},
        "display": [],
        "source": {"files": ["x.root"], "created": "2026-11-09T00:00:00+00:00", "data_time": "2026-11-09"},
    }
    source = str(tmp_path / "source.ember")
    with BundleWriter(source, header) as out:
        for run in (1, 2):
            out.add_run((run, 0, 0), {"Channel": (2, {"e": np.full(2, run, np.float32)})}, {})
        for i in range(5):
            out.add((1 if i < 2 else 2, 1, i), {"Hit": (1, {"e": np.ones(1, np.float32)})}, {})
        out.set_run_info({1: {"Beam": "e-"}, 2: {"Beam": "pi+"}})
    simulate(source, str(tmp_path / "site"), events=3, sleep=lambda _: None)
    parts = [Bundle(str(tmp_path / "site" / "data" / "live_demo" / f"part_000{k}.ember")) for k in (1, 2)]
    assert [sorted(r["run"] for r in b.runs) for b in parts] == [[1, 2], [2]]
    assert parts[0].run(2)["Channel"][1]["e"][0] == 2 and parts[1].run_info(2) == {"Beam": "pi+"}
    assert all(validate(b._file.name) == [] for b in parts)


def test_taking_over_a_stale_lock_removes_partial_bundles(tmp_path):
    config = setup(tmp_path, ["NANO_1.root"])
    partial = os.path.join(config["site"], "data", "mct", "NANO_1.ember.tmp999")
    os.makedirs(os.path.dirname(partial))
    open(partial, "w").close()
    stale_lock(config)
    assert sync(config, convert=fake_convert({})[0]) == 1
    assert not os.path.exists(partial)


def test_publish_adds_a_titled_bundle_to_the_site(tmp_path):
    from embertools.service import publish

    convert, _ = fake_convert({"x.root": 2})
    source = tmp_path / "ttbar.ember"
    convert(["x.root"], str(source), "hgcal", None, data_time=datetime.datetime(2026, 1, 1))
    site = str(tmp_path / "site")
    publish(str(source), site, "simulation", "Simulation", name="ttbar", file_title="ttbar 14 TeV")
    [entry] = json.loads(Path(site, "index.json").read_text())["bundles"]
    assert entry["file"] == "data/simulation/ttbar.ember" and entry["title"] == "ttbar 14 TeV · 2 events"
    assert entry["campaign_title"] == "Simulation"


def test_wildcard_stems_name_bundles_after_the_matched_path_parts(tmp_path):
    from embertools.service import _stem

    campaign = {"inputs": str(tmp_path / "*" / "v3" / "Events_1.root"), "stem": "wildcards"}
    assert _stem(campaign, str(tmp_path / "117135" / "v3" / "Events_1.root")) == "117135"
    assert _stem({"inputs": campaign["inputs"]}, str(tmp_path / "117135" / "v3" / "Events_1.root")) == "Events_1"


def test_the_site_and_the_state_default_to_the_configured_site(tmp_path, monkeypatch):
    config = setup(tmp_path, ["NANO_1.root"])
    monkeypatch.setenv("EMBER_SITE_DIR", config.pop("site"))
    monkeypatch.setenv("EMBER_SERVICE_DIR", str(tmp_path / "service"))
    del config["state"]
    assert sync(config, convert=fake_convert({})[0]) == 1
    assert os.path.exists(tmp_path / "site" / "data" / "mct" / "NANO_1.ember") and os.path.isdir(
        tmp_path / "service" / "state"
    )


def test_the_users_areas_are_not_a_campaign(tmp_path):
    from embertools.service import build_index

    config = setup(tmp_path, ["NANO_1.root"])
    convert, _ = fake_convert({})
    sync(config, convert=convert)
    area = tmp_path / "site" / "data" / "u" / "alice"
    area.mkdir(parents=True)
    convert(["mine.root"], str(area / "mine.ember"), "cms", None, data_time=datetime.datetime(2026, 1, 1))
    assert [b["file"] for b in build_index(config["site"])["bundles"]] == ["data/mct/NANO_1.ember"]
    config["campaigns"][0]["name"] = "u"
    with pytest.raises(ValueError, match="cannot be named u"):
        sync(config, convert=convert)


def relval(tmp_path, files):
    """A campaign of reconstruction files laid out as RelVals are: <sample>/GEN-SIM-RECO/<conditions>/<block>/<file>."""
    store = tmp_path / "relval"
    for k, f in enumerate(files):
        (store / f).parent.mkdir(parents=True, exist_ok=True)
        (store / f).write_bytes(b"")
        os.utime(store / f, (time.time() - 3600 + k,) * 2)
    return {
        "site": str(tmp_path / "site"),
        "state": str(tmp_path / "state"),
        "campaigns": [
            {
                "name": "relval_20_1_0",
                "title": "RelVal CMSSW_20_1_0",
                "profile": "cms",
                "max_events": 5,
                "inputs": str(store / "RelVal*" / "GEN-SIM-RECO" / "*_D110_*" / "*" / "*.root"),
                "stem": "wildcards",
                "stem_parts": [0, 1, 2],
                "export": {"cmssw": "/areas/CMSSW_20_1_0", "geometry": "D110"},
            }
        ],
    }


def test_a_campaign_of_reconstruction_files_is_exported_then_converted_once_per_sample(tmp_path):
    config = relval(
        tmp_path,
        [
            "RelValTTbar_14TeV/GEN-SIM-RECO/PU_201X_D110_PU-v1/2580000/aaa.root",
            "RelValTTbar_14TeV/GEN-SIM-RECO/PU_201X_D110_PU-v1/2580000/bbb.root",
            "RelValTTbar_14TeV/GEN-SIM-RECO/PU_201X_D110_PU-v1/2580001/ccc.root",
            "RelValZMM_14/GEN-SIM-RECO/201X_D110_noPU-v2/2580000/ddd.root",
        ],
    )
    exported = []

    def export(inputs, work, events, log, **settings):
        exported.append((os.path.basename(inputs[0]), events, settings))
        print("running cmsDriver.py", file=log)
        assert os.path.isdir(work)
        return os.path.join(work, os.path.basename(inputs[0]))

    convert, converted = fake_convert({})
    assert sync(config, convert=convert, export=export) == 2
    assert exported == [
        ("aaa.root", 5, {"cmssw": "/areas/CMSSW_20_1_0", "geometry": "D110"}),
        ("ddd.root", 5, {"cmssw": "/areas/CMSSW_20_1_0", "geometry": "D110"}),
    ]
    assert [os.path.basename(c) for c in converted] == ["aaa.root", "ddd.root"]  # the NanoAOD the export made
    listed = index(config)
    assert [b["file"] for b in listed] == [
        "data/relval_20_1_0/ZMM_14_201X_noPU-v2.ember",
        "data/relval_20_1_0/TTbar_14TeV_PU_201X_PU-v1.ember",
    ]
    assert (
        listed[0]["campaign_title"] == "RelVal CMSSW_20_1_0"
        and listed[0]["title"] == "RelVal CMSSW_20_1_0 · ZMM_14_201X_noPU-v2 · 1 events"
    )
    assert (
        sync(config, convert=convert, export=export) == 0 and len(exported) == 2
    )  # the other files of a sample: never


def test_a_failed_export_counts_as_a_failure_of_the_file(tmp_path):
    from embertools import Problem

    config = relval(tmp_path, ["RelValTTbar_14TeV/GEN-SIM-RECO/PU_201X_D110_PU-v1/2580000/aaa.root"])

    def export(inputs, work, events, log, **settings):
        raise Problem("the export job failed (exit code 1)")

    assert sync(config, convert=fake_convert({})[0], export=export) == 0
    assert json.loads(Path(config["state"], "failures.json").read_text()) == {
        "relval_20_1_0/TTbar_14TeV_PU_201X_PU-v1": 1
    }


def test_files_directly_in_the_users_folder_neither_show_in_the_site_index_nor_break_it(tmp_path):
    from embertools.service import build_index

    config = setup(tmp_path, ["NANO_1.root"])
    convert, _ = fake_convert({})
    sync(config, convert=convert)
    users = tmp_path / "site" / "data" / "u"
    users.mkdir()
    convert(["leak.root"], str(users / "leak.ember"), "cms", None, data_time=datetime.datetime(2026, 1, 1))
    (users / "campaign.json").write_text('{"title": "Users"}')
    (users / "empty.ember").write_bytes(b"")
    assert [b["file"] for b in build_index(config["site"])["bundles"]] == ["data/mct/NANO_1.ember"]


def test_a_broken_file_in_a_campaign_does_not_stop_the_index(tmp_path):
    from embertools.service import build_index

    config = setup(tmp_path, ["NANO_1.root"])
    sync(config, convert=fake_convert({})[0])
    other = tmp_path / "site" / "data" / "other"
    other.mkdir()
    (other / "empty.ember").write_bytes(b"")
    (other / "short.ember").write_bytes(b"EVDB\x01")
    (other / "campaign.json").write_text("{not json")
    assert [b["file"] for b in build_index(config["site"])["bundles"]] == ["data/mct/NANO_1.ember"]
    assert sync(config, convert=fake_convert({})[0]) == 0  # and the pass still ends with an index


def test_campaign_bundles_named_evdb_from_before_the_rename_are_still_bundles(tmp_path):
    """Bundles converted before the project was called Ember end in .evdb: their inputs are not converted again, they
    are listed, a stale lock's partial .evdb files are removed, and a publish of the same name replaces them."""
    from embertools.service import publish

    config = setup(tmp_path, ["NANO_1.root", "NANO_2.root"])
    convert, calls = fake_convert({"NANO_2.root": 4})
    folder = Path(config["site"], "data", "mct")
    folder.mkdir(parents=True)
    convert(["NANO_1.root"], str(folder / "NANO_1.evdb"), "mct", None, data_time=datetime.datetime(2026, 1, 1))
    (folder / "NANO_2.evdb.tmp7").write_bytes(b"")
    stale_lock(config)
    calls.clear()

    assert sync(config, convert=convert) == 1 and [os.path.basename(c) for c in calls] == ["NANO_2.root"]
    assert [b["file"] for b in index(config)] == ["data/mct/NANO_2.ember", "data/mct/NANO_1.evdb"]
    assert not (folder / "NANO_2.evdb.tmp7").exists()

    publish(str(folder / "NANO_2.ember"), config["site"], "mct", "MCT", name="NANO_1")
    assert sorted(os.listdir(folder)) == ["NANO_1.ember", "NANO_2.ember", "campaign.json"]
    assert sorted(b["file"] for b in index(config)) == ["data/mct/NANO_1.ember", "data/mct/NANO_2.ember"]
