"""Per-run tables (NanoAOD Runs tree): lookups from event tables, cuts, run records in the bundle; and index
relations whose column is on the target table (each hit names its cluster -> cluster -> hits)."""
import numpy as np

from evdtools.bundle import Bundle, BundleWriter
from evdtools.nano import Converter

F4, I4, U2 = np.dtype("f4"), np.dtype("i4"), np.dtype("u2")
EVENT_META = {"Hit": {"doc": "hits", "columns": {"e": (F4, ""), "dense": (I4, ""), "cluster": (I4, "")}},
              "Cluster": {"doc": "clusters", "columns": {"e": (F4, "")}}}
RUN_META = {"Channel": {"doc": "channels", "columns": {"size": (F4, "[cm]"), "fed": (U2, ""), "detid": (I4, "")}}}

EVENT = {"Hit": {"e": [5, 1, 7, 2], "dense": [2, 0, 3, 9], "cluster": [1, -1, 1, 0]}, "Cluster": {"e": [2, 12]}}
CHANNELS = {"size": [0.5, 0.6, 0.7, 0.0], "fed": [10, 10, 11, 11], "detid": [1, 2, 3, 0]}  # 4 channels: dense 0..3

PROFILE = {
    "derive": [{"table": "Hit", "lookup": "Channel", "index": "dense", "columns": {"cellSize": "size", "fed": "fed"}}],
    "relations": [{"name": "clusterHits", "kind": "index", "from": "Cluster", "to": "Hit", "index": "Hit.cluster"}],
    "cuts": {"Channel": [["detid", "!=", 0]]},
    "view": {"start": "side", "minRadius": 12},
    "summaries": [{"title": "Energy", "table": "Hit", "groupBy": "dense", "value": "e", "op": "sum"}],
    "display": [{"table": "Channel", "repr": "cells", "group": "Detector", "label": "Channels",
                 "position": ["size", "size", "size"], "context": True, "visible": True}],
}


def entry(meta, tables, run=1):
    """One entry of an uproot library="np" chunk."""
    out = {"run": np.array([run], np.uint32), "luminosityBlock": np.ones(1, np.uint32), "event": np.zeros(1, np.uint64)}
    for t, cols in tables.items():
        out[f"n{t}"] = np.array([len(next(iter(cols.values())))])
        for c, v in cols.items():
            out[f"{t}_{c}"] = np.array([np.asarray(v, meta[t]["columns"][c][0]), None], dtype=object)[:-1]
    return out


def converter():
    copy = lambda meta: {t: {"doc": m["doc"], "columns": dict(m["columns"])} for t, m in meta.items()}
    return Converter(copy(EVENT_META), PROFILE, copy(RUN_META))


def test_lookup_copies_run_table_columns_by_row():
    conv = converter()
    runs = conv.run_tables(entry(RUN_META, {"Channel": CHANNELS}), 0)
    _, tables, _ = conv.event(entry(EVENT_META, EVENT), 0, runs)
    hits = tables["Hit"][1]
    assert np.allclose(hits["cellSize"][:3], [0.7, 0.5, 0.0]) and np.isnan(hits["cellSize"][3])  # dense 9: no channel
    assert list(hits["fed"]) == [11, 10, 11, -1]
    assert "Channel" not in tables  # per-run tables are written once per run, not per event


def test_index_column_on_target_table_is_inverted():
    conv = converter()
    _, _, relations = conv.event(entry(EVENT_META, EVENT), 0, conv.run_tables(entry(RUN_META, {"Channel": CHANNELS}), 0))
    rel = relations["clusterHits"]  # cluster 0 <- hit 3; cluster 1 <- hits 0, 2; hit 1 has no cluster
    assert list(rel["offsets"]) == [0, 1, 3] and list(rel["indices"]) == [3, 0, 2]


def test_run_record_is_cut_and_round_trips(tmp_path):
    conv = converter()
    runs = conv.run_tables(entry(RUN_META, {"Channel": CHANNELS}), 0)
    header = conv.header(["f.root"], "test")
    assert header["tables"]["Channel"]["scope"] == "run" and "scope" not in header["tables"]["Hit"]
    assert header["view"] == PROFILE["view"] and header["summaries"] == PROFILE["summaries"]
    path = tmp_path / "b.evdb"
    with BundleWriter(str(path), header) as out:
        out.add_run(*conv.run_record(1, runs))
        out.add(*conv.event(entry(EVENT_META, EVENT), 0, runs))
    b = Bundle(str(path))
    n, cols = b.run(1)["Channel"]
    assert n == 3 and list(cols["detid"]) == [1, 2, 3]  # the unconnected channel is cut
    assert b.run(2) == {} and b.events[0]["run"] == 1


def test_run_info_is_stored_in_the_index(tmp_path):
    import json
    from evdtools.runinfo import load
    src = tmp_path / "runs.json"
    src.write_text(json.dumps([{"Run": 1, "Beam": "e-", "Energy": 150.0, "Comments": "nan", "Start": None}]))
    info = load(str(src), {1, 2})
    assert info == {1: {"Beam": "e-", "Energy": 150}}  # empty values dropped, whole floats as integers
    conv = converter()
    path = tmp_path / "b.evdb"
    with BundleWriter(str(path), conv.header(["f.root"], "test")) as out:
        out.add(*conv.event(entry(EVENT_META, EVENT), 0, None))
        out.set_run_info(info)
    b = Bundle(str(path))
    assert b.run_info(1) == {"Beam": "e-", "Energy": 150} and b.run(1) == {}  # info only, no per-run tables
