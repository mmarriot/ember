"""Site sync: one bundle per input, skipping done / settling / failed files, the lock, and the index."""
import json
import os
import time

import numpy as np

from evdtools.bundle import BundleWriter
from evdtools.service import sync


def fake_convert(events_per_file):
    """Stands in for nano.convert: writes a real bundle with the given number of events (0: empty)."""
    calls = []

    def convert(files, output, profile, max_events, data_time=None):
        calls.append(files[0])
        n = events_per_file.get(os.path.basename(files[0]), 1)
        if n < 0:
            raise RuntimeError("broken file")
        header = {"schema": "evd/1", "profile": profile, "tables": {"Hit": {"doc": "", "columns": {"e": {"type": "f32", "doc": ""}}}},
                  "relations": {}, "display": [], "source": {"files": files, "created": "2026-11-09T00:00:00+00:00",
                                                             "data_time": data_time.isoformat(timespec="seconds")}}
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
    return {"site": str(tmp_path / "site"), "state": str(tmp_path / "state"),
            "campaigns": [{"name": "mct", "title": "MCT", "profile": "mct", "inputs": str(inputs / "NANO_*.root"),
                           "xrootd": "root://host/"}]}


def index(config):
    return json.load(open(os.path.join(config["site"], "index.json")))["bundles"]


def test_converts_new_files_once_and_lists_newest_first(tmp_path):
    config = setup(tmp_path, ["NANO_1.root", "NANO_2.root", "NANO_10.root", "NANO_3.root"])
    convert, calls = fake_convert({"NANO_3.root": 0})
    assert sync(config, convert=convert) == 4
    assert all(c.startswith("root://host/") for c in calls)  # read through XRootD
    files = [b["file"] for b in index(config)]
    assert files == ["data/mct/NANO_10.evdb", "data/mct/NANO_2.evdb", "data/mct/NANO_1.evdb"]  # NANO_3 is empty
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
    assert json.load(open(os.path.join(config["state"], "failures.json"))) == {"mct/NANO_1": 3}


def test_a_fresh_lock_blocks_and_a_stale_one_is_taken_over(tmp_path):
    config = setup(tmp_path, ["NANO_1.root"])
    convert, calls = fake_convert({})
    os.makedirs(os.path.join(config["state"], "lock"))
    assert sync(config, convert=convert) == 0 and not calls
    old = time.time() - 4 * 3600
    os.utime(os.path.join(config["state"], "lock"), (old, old))
    assert sync(config, max_files=1, convert=convert) == 1
    assert not os.path.exists(os.path.join(config["state"], "lock"))


def test_simulate_publishes_parts_newest_first(tmp_path):
    from evdtools.service import simulate
    convert, _ = fake_convert({"NANO_1.root": 7})
    source = tmp_path / "source.evdb"
    convert(["NANO_1.root"], str(source), "mct", None, data_time=__import__("datetime").datetime.now())
    naps = []
    assert simulate(str(source), str(tmp_path / "site"), events=3, interval=5, sleep=naps.append) == 3
    assert naps == [5, 5]  # no wait after the last part
    parts = json.load(open(tmp_path / "site" / "index.json"))["bundles"]
    assert [b["events"] for b in parts] == [1, 3, 3] and parts[0]["file"] == "data/live_demo/part_0003.evdb"


def test_taking_over_a_stale_lock_removes_partial_bundles(tmp_path):
    config = setup(tmp_path, ["NANO_1.root"])
    partial = os.path.join(config["site"], "data", "mct", "NANO_1.evdb.tmp999")
    os.makedirs(os.path.dirname(partial))
    open(partial, "w").close()
    os.makedirs(os.path.join(config["state"], "lock"))
    old = time.time() - 4 * 3600
    os.utime(os.path.join(config["state"], "lock"), (old, old))
    assert sync(config, convert=fake_convert({})[0]) == 1
    assert not os.path.exists(partial)


def test_publish_adds_a_titled_bundle_to_the_site(tmp_path):
    from evdtools.service import publish
    convert, _ = fake_convert({"x.root": 2})
    source = tmp_path / "ttbar.evdb"
    convert(["x.root"], str(source), "hgcal", None, data_time=__import__("datetime").datetime(2026, 1, 1))
    site = str(tmp_path / "site")
    publish(str(source), site, "simulation", "Simulation", name="ttbar", file_title="ttbar 14 TeV")
    [entry] = json.load(open(os.path.join(site, "index.json")))["bundles"]
    assert entry["file"] == "data/simulation/ttbar.evdb" and entry["title"] == "ttbar 14 TeV · 2 events"
    assert entry["campaign_title"] == "Simulation"


def test_wildcard_stems_name_bundles_after_the_matched_path_parts(tmp_path):
    from evdtools.service import _stem
    campaign = {"inputs": str(tmp_path / "*" / "v3" / "Events_1.root"), "stem": "wildcards"}
    assert _stem(campaign, str(tmp_path / "117135" / "v3" / "Events_1.root")) == "117135"
    assert _stem({"inputs": campaign["inputs"]}, str(tmp_path / "117135" / "v3" / "Events_1.root")) == "Events_1"
