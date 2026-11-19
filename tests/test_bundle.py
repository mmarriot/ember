"""Round trip of the bundle format and of relation normalisation (no ROOT file needed)."""

import json
import struct

import numpy as np
import pytest

from embertools.bundle import Bundle, BundleWriter, encode_record, validate
from embertools.relations import build_relation

HEADER = {
    "schema": "evd/1",
    "source": {"files": []},
    "profile": "test",
    "tables": {
        "Hits": {"doc": "", "columns": {"x": {"type": "f32", "doc": ""}, "flag": {"type": "u8", "doc": ""}}},
        "Clusters": {"doc": "", "columns": {"e": {"type": "f64", "doc": ""}}},
    },
    "relations": {"clusterHits": {"from": "Clusters", "to": "Hits", "weights": ["fraction"]}},
    "display": [],
}


def event(seed):
    rng = np.random.default_rng(seed)
    hits = {"x": rng.random(7, dtype=np.float32), "flag": rng.integers(0, 2, 7).astype(bool)}
    clusters = {"e": rng.random(3)}
    rel = {
        "offsets": np.array([0, 2, 2, 5]),
        "indices": np.array([0, 6, 1, 2, 3]),
        "weights": {"fraction": np.array([1, 0.5, 0.5, 1, 1])},
    }
    eid = (np.uint32(1), np.uint32(1), np.uint64(seed))  # as read from ROOT
    return eid, {"Hits": (7, hits), "Clusters": (3, clusters)}, {"clusterHits": rel}


def test_round_trip(tmp_path):
    path = str(tmp_path / "t.ember")
    with BundleWriter(path, HEADER) as w:
        for seed in (11, 12):
            w.add(*event(seed))
    b = Bundle(path)
    assert len(b) == 2 and b.header["profile"] == "test"
    for i, seed in enumerate((11, 12)):
        eid, tables, rels = event(seed)
        got = b.event(i)
        assert got["event"] == list(eid)
        np.testing.assert_array_equal(got["tables"]["Hits"][1]["x"], tables["Hits"][1]["x"])
        np.testing.assert_array_equal(got["tables"]["Hits"][1]["flag"], tables["Hits"][1]["flag"].astype(np.uint8))
        np.testing.assert_array_equal(got["relations"]["clusterHits"]["indices"], rels["clusterHits"]["indices"])
    assert validate(path) == []


def test_columns_are_8_byte_aligned():
    data = encode_record((1, 1, 1), {"T": (3, {"a": np.zeros(3, np.uint8), "b": np.zeros(3, np.float64)})}, {})
    hlen = struct.unpack("<I", data[4:8])[0]
    assert (8 + hlen) % 8 == 0
    meta = json.loads(data[8 : 8 + hlen])
    assert all(loc[0] % 8 == 0 for loc in meta["tables"]["T"]["columns"].values())


@pytest.mark.parametrize(
    "rel, cols, expected",
    [
        (
            {"kind": "offsets", "offsets": "L.o", "indices": "L.i"},
            {"A": {}, "L": {"o": np.array([0, 1, 1, 3]), "i": np.array([2, 0, 4])}},
            ([0, 1, 1, 3], [2, 0, 4]),
        ),
        (
            {"kind": "counts", "counts": "A.n", "indices": "L.i"},
            {"A": {"n": np.array([2, 0, 1])}, "L": {"i": np.array([4, 1, 3])}},
            ([0, 2, 2, 3], [4, 1, 3]),
        ),
        (  # without a list: B holds A's children in A's order (the hits of tracks)
            {"kind": "counts", "counts": "A.n"},
            {"A": {"n": np.array([2, 0, 3])}, "L": {}},
            ([0, 2, 2, 5], [0, 1, 2, 3, 4]),
        ),
        (
            {"kind": "links", "fromIndex": "L.f", "toIndex": "L.t"},
            {"A": {}, "L": {"f": np.array([0, 0, 2]), "t": np.array([1, -1, 4])}},
            ([0, 1, 1, 2], [1, 4]),
        ),
        ({"kind": "index", "index": "A.k"}, {"A": {"k": np.array([3, -1, 0])}, "L": {}}, ([0, 1, 1, 2], [3, 0])),
    ],
)
def test_relation_normalisation(rel, cols, expected):
    tables = {"A": (3, cols["A"]), "B": (5, {}), "L": (3, cols["L"])}
    out = build_relation(dict(rel, name="r", **{"from": "A", "to": "B"}), tables)
    np.testing.assert_array_equal(out["offsets"], expected[0])
    np.testing.assert_array_equal(out["indices"], expected[1])


def test_children_counted_but_not_in_the_child_table_are_rejected():
    tables = {"A": (2, {"n": np.array([2, 2])}), "B": (5, {})}
    with pytest.raises(ValueError, match="4 children counted, table B has 5"):
        build_relation({"name": "r", "kind": "counts", "from": "A", "to": "B", "counts": "A.n"}, tables)


def test_relation_out_of_range_is_rejected():
    tables = {"A": (1, {"k": np.array([9])}), "B": (5, {})}
    with pytest.raises(ValueError):
        build_relation({"name": "r", "kind": "index", "from": "A", "to": "B", "index": "A.k"}, tables)


def _write(path, threads, events=7, **kw):
    rng = np.random.default_rng(1)
    with BundleWriter(str(path), HEADER, threads=threads, **kw) as w:
        w.add_run((1, 0, 0), {"Hits": (2, {"x": np.ones(2, np.float32), "flag": np.zeros(2, bool)})}, {})
        for i in range(events):
            n = int(rng.integers(0, 2000))
            w.add((1, 1, events - i), {"Hits": (n, {"x": rng.random(n, np.float32), "flag": rng.random(n) > 0.5})}, {})
    return path.read_bytes()


def test_records_compressed_on_threads_are_written_in_the_order_added(tmp_path):
    one = _write(tmp_path / "one.ember", 1)
    assert _write(tmp_path / "three.ember", 3) == one and _write(tmp_path / "many.ember", 16) == one
    b = Bundle(str(tmp_path / "three.ember"))
    assert [e["event"] for e in b.events] == [7, 6, 5, 4, 3, 2, 1] and validate(str(tmp_path / "three.ember")) == []
    assert all(b.event(i)["event"] == [1, 1, 7 - i] for i in range(7))
    _write(tmp_path / "sorted.ember", 3, sort=True)
    assert [e["event"] for e in Bundle(str(tmp_path / "sorted.ember")).events] == list(range(1, 8))


def test_a_record_that_cannot_be_written_leaves_no_file(tmp_path):
    """A record that fails to encode on a compression thread: the error comes out of the writer, and no file stays."""
    path = tmp_path / "broken.ember"
    bad = {"clusterHits": {"offsets": np.array(["not a number"]), "indices": np.zeros(0, np.uint32)}}
    with pytest.raises(ValueError), BundleWriter(str(path), HEADER, threads=2) as w:
        w.add((1, 1, 1), {"Hits": (1, {"x": np.ones(1, np.float32)})}, {})
        w.add((1, 1, 2), {"Hits": (1, {"x": np.ones(1, np.float32)})}, bad)
        w.add((1, 1, 3), {"Hits": (1, {"x": np.ones(1, np.float32)})}, {})
    assert not path.exists() and not list(tmp_path.glob("broken.ember.tmp*"))


def test_a_column_of_another_type_than_the_header_says_is_refused(tmp_path):
    """A reader views the bytes as the header's type: float32 bytes under an f64 header would read as other numbers."""
    eid, tables, rels = event(1)
    tables["Clusters"][1]["e"] = tables["Clusters"][1]["e"].astype(np.float32)
    with (
        pytest.raises(ValueError, match=r"Clusters\.e is float32, but the header says f64"),
        BundleWriter(str(tmp_path / "t.ember"), HEADER) as w,
    ):
        w.add(eid, tables, rels)
    assert not list(tmp_path.iterdir())  # nothing left behind

    complex_column = event(1)
    complex_column[1]["Clusters"][1]["e"] = np.zeros(3, np.complex64)  # a type no bundle can store
    extra_column = event(1)
    extra_column[1]["Hits"][1]["y"] = np.zeros(7, np.float32)
    for record, message in ((complex_column, r"Clusters\.e is complex64"), (extra_column, r"Hits\.y is not in the")):
        with pytest.raises(ValueError, match=message), BundleWriter(str(tmp_path / "t.ember"), HEADER) as w:
            w.add(*record)


def test_validate_reports_damage_and_goes_on(tmp_path):
    path = str(tmp_path / "t.ember")
    with BundleWriter(path, HEADER) as w:
        eid, tables, rels = event(1)
        w.add(eid, tables, rels)
        eid, tables, rels = event(2)
        rels["clusterHits"]["indices"] = np.array([0, 6, 1, 2, 7])  # Hits has 7 rows
        w.add(eid, tables, rels)
        eid, tables, rels = event(3)
        rels["clusterHits"]["offsets"] = np.array([0, 3, 2, 5])  # not increasing
        w.add(eid, tables, rels)
        eid, tables, rels = event(4)
        rels["unknown"] = rels["clusterHits"]
        w.add(eid, tables, rels)
    b = Bundle(path)
    first = b.events[0]
    with open(path, "r+b") as f:  # damage event 0's compressed data
        f.seek(first["offset"] + first["length"] // 2)
        f.write(b"\xff" * 16)
    problems = validate(path)
    assert problems[0].startswith("event 0: cannot be read")
    assert problems[1:] == [
        "event 1: relation clusterHits points past Hits (7 rows)",
        "event 2: relation clusterHits has bad offsets",
        "event 3: relation unknown is not in the header",
    ]
