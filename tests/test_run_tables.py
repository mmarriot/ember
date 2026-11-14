"""Per-run tables (NanoAOD Runs tree): lookups from event tables, cuts, run records and run info in the bundle."""

import json

import numpy as np
from nanoaod import chunk, converter

from embertools.bundle import Bundle, BundleWriter
from embertools.derive import lookup_dtype
from embertools.runinfo import load

F4, I4, U2 = np.dtype("f4"), np.dtype("i4"), np.dtype("u2")
EVENT_TYPES = {"Hit": {"e": F4, "dense": I4}}
RUN_TYPES = {"Channel": {"size": F4, "fed": U2, "detid": I4}}
EVENT = {"Hit": {"e": [5, 1, 7, 2], "dense": [2, 0, 3, 9]}}
CHANNELS = {"Channel": {"size": [0.5, 0.6, 0.7, 0.0], "fed": [10, 10, 11, 11], "detid": [1, 2, 3, 0]}}  # dense 0..3
PROFILE = {
    "derive": [
        {"table": "Hit", "column": "cellSize", "neighbourDistance": ["e", "e"]},  # an estimate, overridden
        {"table": "Hit", "lookup": "Channel", "index": "dense", "columns": {"cellSize": "size", "fed": "fed"}},
    ],
    "cuts": {"Channel": [["detid", "!=", 0]]},
    "display": [
        {
            "table": "Channel",
            "repr": "cells",
            "group": "Detector",
            "label": "Channels",
            "position": ["size", "size", "size"],
            "context": True,
            "visible": True,
        }
    ],
}


def converter_and_runs():
    conv = converter(EVENT_TYPES, PROFILE, RUN_TYPES)
    return conv, conv.run_tables(chunk(conv, CHANNELS), 0)


def test_lookup_copies_run_table_columns_by_row():
    conv, runs = converter_and_runs()
    assert conv.tables["Hit"]["columns"]["fed"][0] == np.int32  # u16 -> i32, for the -1 of no channel
    assert conv.branches("run") == ["nChannel", "Channel_size", "Channel_fed", "Channel_detid", "run"]
    _, tables, _ = conv.event(chunk(conv, EVENT), 0, runs)
    hits = tables["Hit"][1]
    assert np.allclose(hits["cellSize"][:3], [0.7, 0.5, 0.0]) and np.isnan(hits["cellSize"][3])  # dense 9: no channel
    assert list(hits["fed"]) == [11, 10, 11, -1]
    assert "Channel" not in tables  # per-run tables are written once per run, not per event


def test_lookup_columns_take_the_narrowest_signed_type_that_holds_minus_one():
    widened = {
        np.bool_: np.int8,
        np.uint8: np.int16,
        np.uint16: np.int32,
        np.uint32: np.int64,
        np.uint64: np.int64,
        np.int16: np.int16,
        np.float32: np.float32,
    }
    assert {t: lookup_dtype(t) for t in widened} == widened


def test_run_record_is_cut_and_round_trips(tmp_path):
    conv, runs = converter_and_runs()
    header = conv.header(["f.root"], "test")
    assert header["tables"]["Channel"]["scope"] == "run" and "scope" not in header["tables"]["Hit"]
    path = tmp_path / "b.evdb"
    with BundleWriter(str(path), header) as out:
        out.add_run(*conv.run_record(1, runs))
        out.add(*conv.event(chunk(conv, EVENT), 0, runs))
    b = Bundle(str(path))
    n, cols = b.run(1)["Channel"]
    assert n == 3 and list(cols["detid"]) == [1, 2, 3]  # the unconnected channel is cut
    assert b.run(2) == {} and b.events[0]["run"] == 1
    assert runs["Channel"][0] == 4  # lookups still see every row


def test_run_info_is_stored_in_the_index(tmp_path):
    src = tmp_path / "runs.json"
    src.write_text(json.dumps([{"Run": 1, "Beam": "e-", "Energy": 150.0, "Comments": "nan", "Start": None}]))
    info = load(str(src), {1, 2})
    assert info == {1: {"Beam": "e-", "Energy": 150}}  # empty values dropped, whole floats as integers
    conv, _ = converter_and_runs()
    path = tmp_path / "b.evdb"
    with BundleWriter(str(path), conv.header(["f.root"], "test")) as out:
        out.add(*conv.event(chunk(conv, EVENT), 0, None))
        out.set_run_info(info)
    b = Bundle(str(path))
    assert b.run_info(1) == {"Beam": "e-", "Energy": 150} and b.run(1) == {}  # info only, no per-run tables
