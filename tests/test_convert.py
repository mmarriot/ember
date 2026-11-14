"""convert() on small NanoAOD files: preselection, --events, --max-events, --sorted, per-run tables from the file or another."""

import io
import json

import pytest
from nanoaod import write_nano

from evdtools.__main__ import validate
from evdtools.bundle import Bundle
from evdtools.nano import convert

pytest.importorskip("awkward")  # writes the input files

PROFILE = {
    "name": "test",
    "derive": [{"table": "Hit", "lookup": "Channel", "index": "dense", "columns": {"cellSize": "size"}}],
    "relations": [{"name": "clusterHits", "kind": "index", "from": "Cl", "to": "Hit", "index": "Hit.cluster"}],
    "cuts": {"Hit": [["e", ">", 1]], "Cl": [["e", ">", 1]], "Channel": [["size", ">", 0]]},
    "select": [{"table": "Hit", "where": [["e", ">", 5]], "min": 1}],
    "display": [{"table": "Hit", "label": "Hits", "position": ["e", "e", "e"]}],
}
CHANNELS = {"Channel": {"size": [0.5, 0.0, 0.7]}}


def event(*energies):
    return {
        "Hit": {"e": list(energies), "dense": [k % 4 for k in range(len(energies))], "cluster": [0] * len(energies)},
        "Cl": {"e": [2.0]},
    }


EVENTS = [event(6, 0.5, 2), event(2, 3), event(9), event(1, 7, 8)]  # all but event 1 have a hit above 5


@pytest.fixture
def files(tmp_path):
    profile = tmp_path / "test.json"
    profile.write_text(json.dumps(PROFILE))
    write_nano(str(tmp_path / "with_runs.root"), EVENTS, {1: CHANNELS})
    write_nano(str(tmp_path / "events_only.root"), EVENTS, first_event=10)
    return str(profile), str(tmp_path / "with_runs.root"), str(tmp_path / "events_only.root"), tmp_path


def run(inputs, output, profile, **kw):
    log = io.StringIO()
    n = convert(inputs, str(output), profile, log=log, **kw)
    b = Bundle(str(output))
    assert validate(str(output)) == [] and len(b) == n
    return b, log.getvalue()


def test_selection_and_per_run_tables(files):
    profile, with_runs, _, tmp = files
    b, log = run([with_runs], tmp / "a.evdb", profile)
    assert [e["event"] for e in b.events] == [0, 2, 3] and "scanned 4, selected 3" in log
    n, hits = b.event(0)["tables"]["Hit"]
    assert n == 2 and hits["e"].tolist() == [6, 2] and hits["cellSize"][0] == pytest.approx(0.5)
    assert hits["cellSize"][1] == pytest.approx(0.7)  # dense 2
    assert b.run(1)["Channel"][0] == 2 and b.header["tables"]["Channel"]["scope"] == "run"
    b, _ = run([with_runs, with_runs], tmp / "b.evdb", profile, max_events=4)
    assert [e["event"] for e in b.events] == [0, 2, 3, 0] and len(b.runs) == 1  # one run record


def test_chosen_events_in_event_order(files):
    profile, with_runs, _, tmp = files
    b, log = run([with_runs], tmp / "a.evdb", profile, events={3, 1, 0, 99})
    assert [e["event"] for e in b.events] == [0, 3]  # event 1 fails the selection
    assert "3 of the requested events" in log


def test_per_run_tables_from_another_file(files):
    profile, with_runs, events_only, tmp = files
    b, _ = run([events_only], tmp / "a.evdb", profile)
    assert "cellSize" not in b.header["tables"]["Hit"]["columns"] and not b.runs  # nothing to look up
    b, log = run([events_only], tmp / "b.evdb", profile, run_tables=with_runs)
    assert "per-run tables of run(s) [1] from with_runs.root" in log
    assert b.event(0)["tables"]["Hit"][1]["cellSize"][0] == pytest.approx(0.5) and b.run(1)["Channel"][0] == 2


def test_sorted_writes_events_in_event_order(tmp_path):
    """--sorted: the bundle lists the events in (run, event) order, whatever order the export wrote them in (a
    multi-threaded export writes them as they finish), with the selection still applied; only the index is sorted."""
    profile = tmp_path / "test.json"
    profile.write_text(json.dumps(PROFILE))
    write_nano(str(tmp_path / "shuffled.root"), EVENTS, event_numbers=[7, 3, 9, 5])
    b, _ = run([str(tmp_path / "shuffled.root")], tmp_path / "a.evdb", str(profile))
    assert [e["event"] for e in b.events] == [7, 9, 5]  # file order; event 3 (the second) fails the selection
    b, _ = run([str(tmp_path / "shuffled.root")], tmp_path / "b.evdb", str(profile), sort=True)
    assert [e["event"] for e in b.events] == [5, 7, 9]
    assert [int(b.event(i)["event"][2]) for i in range(len(b))] == [5, 7, 9]  # each index entry finds its own record
